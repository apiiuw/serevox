package core

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/serevox/serevox/internal/config"
	"github.com/serevox/serevox/internal/db"
	"github.com/serevox/serevox/internal/storage"
	"github.com/serevox/serevox/internal/webhook"
)

var (
	ErrInvalidBucketName = errors.New("bucket name must be 3-63 chars, lowercase alphanumeric or hyphens")
	ErrMIMEForbidden     = errors.New("file MIME type is not allowed in this bucket")
	ErrAlreadyExists     = errors.New("object already exists and upsert is disabled")
)

var bucketNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`)

// Service coordinates database, blob storage, image processing, and webhooks across API layers.
type Service struct {
	Cfg      *config.Config
	Store    *db.Store
	Storage  *storage.LocalDriver
	Webhooks *webhook.Dispatcher
}

func NewService(cfg *config.Config, store *db.Store, st *storage.LocalDriver, wh *webhook.Dispatcher) *Service {
	return &Service{
		Cfg:      cfg,
		Store:    store,
		Storage:  st,
		Webhooks: wh,
	}
}

func ValidateBucketName(name string) error {
	if !bucketNameRe.MatchString(name) || strings.Contains(name, "..") {
		return ErrInvalidBucketName
	}
	return nil
}

func CheckMIMEAllowed(allowed []string, actual string) bool {
	if len(allowed) == 0 {
		return true
	}
	actual = strings.ToLower(strings.TrimSpace(actual))
	for _, pat := range allowed {
		pat = strings.ToLower(strings.TrimSpace(pat))
		if pat == "" || pat == "*" || pat == "*/*" {
			return true
		}
		if strings.HasSuffix(pat, "/*") {
			prefix := strings.TrimSuffix(pat, "*")
			if strings.HasPrefix(actual, prefix) {
				return true
			}
		} else if pat == actual {
			return true
		}
	}
	return false
}

// PutObject streams an upload to disk, enforces bucket constraints, saves metadata, and emits webhook.
func (s *Service) PutObject(bucket *db.Bucket, key string, r io.Reader, declaredMIME string, meta map[string]string, upsert bool) (*db.Object, error) {
	cleanKey, err := storage.SanitizeKey(key)
	if err != nil {
		return nil, err
	}

	if !upsert {
		if _, err := s.Store.GetObject(bucket.ID, cleanKey); err == nil {
			return nil, ErrAlreadyExists
		}
	}

	maxBytes := bucket.MaxFileSize
	if maxBytes <= 0 || maxBytes > s.Cfg.MaxUploadBytes {
		maxBytes = s.Cfg.MaxUploadBytes
	}

	blob, err := s.Storage.WriteStream(bucket.ID, r, maxBytes, cleanKey)
	if err != nil {
		return nil, err
	}

	finalMIME := blob.SniffedMIME
	if declaredMIME != "" && declaredMIME != "application/octet-stream" {
		// Trust declared MIME only if magic bytes look generic (e.g. text/plain for CSS/JSON/CSV)
		if blob.SniffedMIME == "application/octet-stream" || strings.HasPrefix(blob.SniffedMIME, "text/plain") {
			finalMIME = strings.Split(declaredMIME, ";")[0]
		}
	}

	if !CheckMIMEAllowed(bucket.AllowedMimeTypes, finalMIME) {
		_ = s.Storage.DeleteBlob(blob.StoragePath)
		return nil, fmt.Errorf("%w: %s", ErrMIMEForbidden, finalMIME)
	}

	now := time.Now().UTC()
	var expiresAt *time.Time
	if bucket.LifecycleDays > 0 {
		t := now.Add(time.Duration(bucket.LifecycleDays) * 24 * time.Hour)
		expiresAt = &t
	}

	if meta == nil {
		meta = map[string]string{}
	}

	obj := &db.Object{
		ID:          uuid.NewString(),
		BucketID:    bucket.ID,
		Key:         cleanKey,
		SizeBytes:   blob.SizeBytes,
		MimeType:    finalMIME,
		ETag:        blob.ETag,
		SHA256:      blob.SHA256,
		StoragePath: blob.StoragePath,
		Metadata:    meta,
		ExpiresAt:   expiresAt,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	oldPath, err := s.Store.UpsertObject(obj)
	if err != nil {
		_ = s.Storage.DeleteBlob(blob.StoragePath)
		return nil, err
	}
	if oldPath != "" && oldPath != blob.StoragePath {
		_ = s.Storage.DeleteBlob(oldPath)
	}

	s.Store.RecordUsage(bucket.ProjectID, bucket.ID, "ingress", obj.SizeBytes)
	s.Webhooks.Emit(bucket.ProjectID, "object.uploaded", map[string]any{
		"bucket":    bucket.Name,
		"key":       obj.Key,
		"size":      obj.SizeBytes,
		"mime_type": obj.MimeType,
		"etag":      obj.ETag,
	})

	return obj, nil
}

// DeleteObject removes object metadata, deletes underlying blob, and fires webhook.
func (s *Service) DeleteObject(bucket *db.Bucket, key string) error {
	cleanKey, err := storage.SanitizeKey(key)
	if err != nil {
		return err
	}
	oldPath, err := s.Store.DeleteObject(bucket.ID, cleanKey)
	if err != nil {
		return err
	}
	_ = s.Storage.DeleteBlob(oldPath)
	s.Webhooks.Emit(bucket.ProjectID, "object.deleted", map[string]any{
		"bucket": bucket.Name,
		"key":    cleanKey,
	})
	return nil
}

// CopyObject copies an object between buckets or keys.
func (s *Service) CopyObject(srcBucket *db.Bucket, srcKey string, dstBucket *db.Bucket, dstKey string) (*db.Object, error) {
	cleanSrc, err := storage.SanitizeKey(srcKey)
	if err != nil {
		return nil, err
	}
	cleanDst, err := storage.SanitizeKey(dstKey)
	if err != nil {
		return nil, err
	}

	srcObj, err := s.Store.GetObject(srcBucket.ID, cleanSrc)
	if err != nil {
		return nil, err
	}
	if dstBucket.MaxFileSize > 0 && srcObj.SizeBytes > dstBucket.MaxFileSize {
		return nil, storage.ErrTooLarge
	}
	if !CheckMIMEAllowed(dstBucket.AllowedMimeTypes, srcObj.MimeType) {
		return nil, ErrMIMEForbidden
	}

	newStoragePath, err := s.Storage.CopyBlob(dstBucket.ID, srcObj.StoragePath)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	var expiresAt *time.Time
	if dstBucket.LifecycleDays > 0 {
		t := now.Add(time.Duration(dstBucket.LifecycleDays) * 24 * time.Hour)
		expiresAt = &t
	}

	copied := &db.Object{
		ID:          uuid.NewString(),
		BucketID:    dstBucket.ID,
		Key:         cleanDst,
		SizeBytes:   srcObj.SizeBytes,
		MimeType:    srcObj.MimeType,
		ETag:        srcObj.ETag,
		SHA256:      srcObj.SHA256,
		StoragePath: newStoragePath,
		Metadata:    srcObj.Metadata,
		ExpiresAt:   expiresAt,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	oldPath, err := s.Store.UpsertObject(copied)
	if err != nil {
		_ = s.Storage.DeleteBlob(newStoragePath)
		return nil, err
	}
	if oldPath != "" && oldPath != newStoragePath {
		_ = s.Storage.DeleteBlob(oldPath)
	}
	return copied, nil
}

// ListResult groups objects and virtual directory prefixes for S3 ListObjectsV2 and REST list.
type ListResult struct {
	Objects        []db.Object `json:"objects"`
	CommonPrefixes []string    `json:"common_prefixes"`
	IsTruncated    bool        `json:"is_truncated"`
	NextToken      string      `json:"next_continuation_token,omitempty"`
}

func (s *Service) ListObjectsWithDelimiter(bucketID, prefix, delimiter, startAfter string, maxKeys int) (*ListResult, error) {
	if maxKeys <= 0 || maxKeys > 1000 {
		maxKeys = 1000
	}
	// Fetch raw objects; with delimiter grouping we may scan more than maxKeys raw entries if folders exist.
	raw, err := s.Store.ListObjects(db.ListObjectsParams{
		BucketID:   bucketID,
		Prefix:     prefix,
		StartAfter: startAfter,
		Limit:      1000,
	})
	if err != nil {
		return nil, err
	}

	res := &ListResult{
		Objects:        []db.Object{},
		CommonPrefixes: []string{},
	}
	if delimiter == "" {
		if len(raw) > maxKeys {
			res.IsTruncated = true
			res.NextToken = raw[maxKeys-1].Key
			raw = raw[:maxKeys]
		}
		res.Objects = raw
		return res, nil
	}

	seenPrefixes := map[string]bool{}
	count := 0
	var lastKey string
	for _, obj := range raw {
		rest := strings.TrimPrefix(obj.Key, prefix)
		if idx := strings.Index(rest, delimiter); idx >= 0 {
			cp := prefix + rest[:idx+len(delimiter)]
			if !seenPrefixes[cp] {
				if count >= maxKeys {
					res.IsTruncated = true
					res.NextToken = lastKey
					break
				}
				seenPrefixes[cp] = true
				res.CommonPrefixes = append(res.CommonPrefixes, cp)
				count++
			}
		} else {
			if count >= maxKeys {
				res.IsTruncated = true
				res.NextToken = lastKey
				break
			}
			res.Objects = append(res.Objects, obj)
			count++
		}
		lastKey = obj.Key
	}
	sort.Strings(res.CommonPrefixes)
	return res, nil
}

// ServeFileWithCORS writes CORS headers from bucket rules (or global fallback), sets ETag/Cache-Control, and streams via http.ServeContent.
func (s *Service) ServeBlob(w http.ResponseWriter, r *http.Request, bucket *db.Bucket, obj *db.Object, file *os.File, mimeType string, etag string) {
	s.ApplyBucketCORS(w, r, bucket)
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("ETag", `"`+etag+`"`)
	w.Header().Set("Accept-Ranges", "bytes")
	if bucket.Visibility == "public" {
		w.Header().Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
	} else {
		w.Header().Set("Cache-Control", "private, no-store")
	}
	// Prevent inline execution of uploaded HTML or SVG scripts for XSS hardening.
	if mimeType == "text/html" || mimeType == "image/svg+xml" {
		w.Header().Set("Content-Security-Policy", "sandbox")
		w.Header().Set("X-Content-Type-Options", "nosniff")
	}

	info, err := file.Stat()
	if err != nil {
		http.Error(w, "failed to stat blob", http.StatusInternalServerError)
		return
	}
	s.Store.RecordUsage(bucket.ProjectID, bucket.ID, "egress", info.Size())
	http.ServeContent(w, r, obj.Key, obj.UpdatedAt, file)
}

func (s *Service) ApplyBucketCORS(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return
	}
	if bucket != nil && len(bucket.CORSRules) > 0 {
		for _, rule := range bucket.CORSRules {
			for _, allowed := range rule.AllowedOrigins {
				if allowed == "*" || strings.EqualFold(allowed, origin) {
					w.Header().Set("Access-Control-Allow-Origin", allowed)
					if len(rule.AllowedMethods) > 0 {
						w.Header().Set("Access-Control-Allow-Methods", strings.Join(rule.AllowedMethods, ", "))
					} else {
						w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE, OPTIONS")
					}
					if len(rule.AllowedHeaders) > 0 {
						w.Header().Set("Access-Control-Allow-Headers", strings.Join(rule.AllowedHeaders, ", "))
					} else {
						w.Header().Set("Access-Control-Allow-Headers", "*")
					}
					if len(rule.ExposeHeaders) > 0 {
						w.Header().Set("Access-Control-Expose-Headers", strings.Join(rule.ExposeHeaders, ", "))
					} else {
						w.Header().Set("Access-Control-Expose-Headers", "ETag, Content-Length, Content-Range")
					}
					if rule.MaxAgeSeconds > 0 {
						w.Header().Set("Access-Control-Max-Age", fmt.Sprintf("%d", rule.MaxAgeSeconds))
					}
					return
				}
			}
		}
		return
	}

	// Fallback to global config CORS origins
	for _, allowed := range s.Cfg.AllowedOrigins {
		if allowed == "*" || strings.EqualFold(allowed, origin) {
			w.Header().Set("Access-Control-Allow-Origin", allowed)
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Api-Key, X-Upsert, X-Amz-Date, X-Amz-Content-Sha256, Range")
			w.Header().Set("Access-Control-Expose-Headers", "ETag, Content-Length, Content-Range")
			return
		}
	}
}

// StartLifecycleWorker runs periodic cleanup for expired objects and bucket TTL rules.
func (s *Service) StartLifecycleWorker(stop <-chan struct{}) {
	ticker := time.NewTicker(5 * time.Minute)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				s.RunLifecycleSweep()
			}
		}
	}()
}

func (s *Service) RunLifecycleSweep() {
	now := time.Now().UTC()
	expired, err := s.Store.ListExpiredObjects(now, 200)
	if err == nil {
		for _, obj := range expired {
			if path, err := s.Store.DeleteObject(obj.BucketID, obj.Key); err == nil {
				_ = s.Storage.DeleteBlob(path)
			}
		}
	}
	buckets, err := s.Store.ListAllBucketsWithLifecycle()
	if err == nil {
		for _, b := range buckets {
			cutoff := now.Add(-time.Duration(b.LifecycleDays) * 24 * time.Hour)
			oldObjs, err := s.Store.ListLifecycleExpiredObjects(b.ID, cutoff, 200)
			if err != nil {
				continue
			}
			for _, obj := range oldObjs {
				if path, err := s.Store.DeleteObject(b.ID, obj.Key); err == nil {
					_ = s.Storage.DeleteBlob(path)
				}
			}
		}
	}
}

