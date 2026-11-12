package s3api

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/serevox/serevox/internal/auth"
	"github.com/serevox/serevox/internal/core"
	"github.com/serevox/serevox/internal/db"
	"github.com/serevox/serevox/internal/storage"
)

const s3TimeFormat = "2006-01-02T15:04:05.000Z"

type Handler struct {
	svc  *core.Service
	auth *auth.Service
}

func NewHandler(svc *core.Service, authSvc *auth.Service) *Handler {
	return &Handler{svc: svc, auth: authSvc}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request, stripPrefix string) {
	if r.Method == http.MethodOptions {
		// Handle CORS preflight on S3 paths using bucket if resolvable
		bName, _ := parseBucketKey(r.URL.Path, stripPrefix)
		var b *db.Bucket
		if bName != "" {
			b, _ = h.svc.Store.GetBucketByName(bName)
		}
		h.svc.ApplyBucketCORS(w, r, b)
		w.WriteHeader(http.StatusOK)
		return
	}

	parsedSig, err := auth.ParseSigV4(r)
	if err != nil {
		writeS3Error(w, http.StatusForbidden, "AccessDenied", "Missing or malformed AWS SigV4 credentials")
		return
	}

	apiKey, err := h.svc.Store.GetAPIKeyByAccessKeyID(parsedSig.AccessKeyID)
	if err != nil {
		writeS3Error(w, http.StatusForbidden, "InvalidAccessKeyId", "The AWS Access Key Id you provided does not exist in our records.")
		return
	}
	secret, err := h.auth.DecryptSecret(apiKey.SecretCiphertext)
	if err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", "Failed to decrypt access key secret")
		return
	}
	if err := auth.VerifySigV4(r, parsedSig, secret); err != nil {
		writeS3Error(w, http.StatusForbidden, "SignatureDoesNotMatch", err.Error())
		return
	}
	h.svc.Store.TouchAPIKeyUsed(apiKey.ID)

	bucketName, key := parseBucketKey(r.URL.Path, stripPrefix)
	if bucketName == "" {
		if r.Method == http.MethodGet {
			h.handleListBuckets(w, apiKey)
			return
		}
		writeS3Error(w, http.StatusMethodNotAllowed, "MethodNotAllowed", "Method not allowed on service root")
		return
	}

	// Bucket creation doesn't require an existing bucket row
	if key == "" && r.Method == http.MethodPut && !r.URL.Query().Has("cors") {
		h.handleCreateBucket(w, apiKey, bucketName)
		return
	}

	bucket, err := h.svc.Store.GetBucketByName(bucketName)
	if err != nil {
		writeS3Error(w, http.StatusNotFound, "NoSuchBucket", "The specified bucket does not exist")
		return
	}
	if bucket.ProjectID != apiKey.ProjectID || (apiKey.BucketID != "" && apiKey.BucketID != bucket.ID) {
		writeS3Error(w, http.StatusForbidden, "AccessDenied", "Access denied for this bucket")
		return
	}

	isWrite := r.Method == http.MethodPut || r.Method == http.MethodPost || r.Method == http.MethodDelete
	if !checkPermission(apiKey.Permission, isWrite) {
		writeS3Error(w, http.StatusForbidden, "AccessDenied", "Insufficient key permissions")
		return
	}

	h.svc.ApplyBucketCORS(w, r, bucket)
	q := r.URL.Query()

	if key == "" {
		switch {
		case q.Has("cors") && r.Method == http.MethodGet:
			h.handleGetBucketCORS(w, bucket)
		case q.Has("cors") && r.Method == http.MethodPut:
			h.handlePutBucketCORS(w, r, bucket)
		case q.Has("delete") && r.Method == http.MethodPost:
			h.handleDeleteObjects(w, r, bucket)
		case r.Method == http.MethodHead:
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodGet:
			h.handleListObjects(w, r, bucket)
		case r.Method == http.MethodDelete:
			h.handleDeleteBucket(w, bucket)
		default:
			writeS3Error(w, http.StatusMethodNotAllowed, "MethodNotAllowed", "Unsupported bucket operation")
		}
		return
	}

	// Object-level operations
	switch {
	case r.Method == http.MethodPost && q.Has("uploads"):
		h.handleCreateMultipartUpload(w, r, bucket, key)
	case r.Method == http.MethodPut && q.Get("uploadId") != "" && q.Get("partNumber") != "":
		h.handleUploadPart(w, r, bucket, key, q.Get("uploadId"), q.Get("partNumber"))
	case r.Method == http.MethodPost && q.Get("uploadId") != "":
		h.handleCompleteMultipartUpload(w, r, bucket, key, q.Get("uploadId"))
	case r.Method == http.MethodDelete && q.Get("uploadId") != "":
		h.handleAbortMultipartUpload(w, bucket, q.Get("uploadId"))
	case r.Method == http.MethodGet && q.Get("uploadId") != "":
		h.handleListParts(w, bucket, q.Get("uploadId"))
	case r.Method == http.MethodHead:
		h.handleHeadObject(w, bucket, key)
	case r.Method == http.MethodGet:
		h.handleGetObject(w, r, bucket, key)
	case r.Method == http.MethodPut:
		if copySource := r.Header.Get("X-Amz-Copy-Source"); copySource != "" {
			h.handleCopyObject(w, apiKey, bucket, key, copySource)
		} else {
			h.handlePutObject(w, r, bucket, key)
		}
	case r.Method == http.MethodDelete:
		h.handleDeleteObject(w, bucket, key)
	default:
		writeS3Error(w, http.StatusMethodNotAllowed, "MethodNotAllowed", "Unsupported object operation")
	}
}

func checkPermission(perm string, isWrite bool) bool {
	switch perm {
	case "admin", "read_write":
		return true
	case "read_only":
		return !isWrite
	case "write_only":
		return isWrite
	default:
		return false
	}
}

func parseBucketKey(rawPath, stripPrefix string) (bucket string, key string) {
	p := rawPath
	if stripPrefix != "" && strings.HasPrefix(p, stripPrefix) {
		p = strings.TrimPrefix(p, stripPrefix)
	}
	p = strings.TrimLeft(p, "/")
	if p == "" {
		return "", ""
	}
	idx := strings.IndexByte(p, '/')
	if idx < 0 {
		return p, ""
	}
	return p[:idx], p[idx+1:]
}

func (h *Handler) handleListBuckets(w http.ResponseWriter, key *db.APIKey) {
	buckets, err := h.svc.Store.ListBucketsByProject(key.ProjectID)
	if err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	type s3Bucket struct {
		Name         string `xml:"Name"`
		CreationDate string `xml:"CreationDate"`
	}
	type result struct {
		XMLName xml.Name   `xml:"ListAllMyBucketsResult"`
		Xmlns   string     `xml:"xmlns,attr"`
		Owner   struct {
			ID          string `xml:"ID"`
			DisplayName string `xml:"DisplayName"`
		} `xml:"Owner"`
		Buckets struct {
			Bucket []s3Bucket `xml:"Bucket"`
		} `xml:"Buckets"`
	}
	res := result{Xmlns: "http://s3.amazonaws.com/doc/2006-03-01/"}
	res.Owner.ID = key.ProjectID
	res.Owner.DisplayName = "serevox"
	for _, b := range buckets {
		if key.BucketID != "" && key.BucketID != b.ID {
			continue
		}
		res.Buckets.Bucket = append(res.Buckets.Bucket, s3Bucket{
			Name:         b.Name,
			CreationDate: b.CreatedAt.UTC().Format(s3TimeFormat),
		})
	}
	writeXML(w, http.StatusOK, res)
}

func (h *Handler) handleCreateBucket(w http.ResponseWriter, key *db.APIKey, name string) {
	if key.Permission != "admin" && key.Permission != "read_write" {
		writeS3Error(w, http.StatusForbidden, "AccessDenied", "Insufficient permission to create bucket")
		return
	}
	if err := core.ValidateBucketName(name); err != nil {
		writeS3Error(w, http.StatusBadRequest, "InvalidBucketName", err.Error())
		return
	}
	if existing, err := h.svc.Store.GetBucketByName(name); err == nil {
		if existing.ProjectID == key.ProjectID {
			w.WriteHeader(http.StatusOK)
			return
		}
		writeS3Error(w, http.StatusConflict, "BucketAlreadyExists", "The requested bucket name is not available")
		return
	}
	now := time.Now().UTC()
	b := &db.Bucket{
		ID:               uuid.NewString(),
		ProjectID:        key.ProjectID,
		Name:             name,
		Visibility:       "private",
		AllowedMimeTypes: []string{},
		CORSRules:        []db.CORSRule{},
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := h.svc.Store.CreateBucket(b); err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	h.svc.Webhooks.Emit(key.ProjectID, "bucket.created", map[string]any{"bucket": b.Name})
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleDeleteBucket(w http.ResponseWriter, bucket *db.Bucket) {
	objs, err := h.svc.Store.ListObjects(db.ListObjectsParams{BucketID: bucket.ID, Limit: 1})
	if err == nil && len(objs) > 0 {
		writeS3Error(w, http.StatusConflict, "BucketNotEmpty", "The bucket you tried to delete is not empty")
		return
	}
	if err := h.svc.Store.DeleteBucket(bucket.ID); err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	h.svc.Webhooks.Emit(bucket.ProjectID, "bucket.deleted", map[string]any{"bucket": bucket.Name})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleListObjects(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	q := r.URL.Query()
	prefix := q.Get("prefix")
	delimiter := q.Get("delimiter")
	startAfter := q.Get("start-after")
	if token := q.Get("continuation-token"); token != "" {
		startAfter = token
	}
	maxKeys := 1000
	if mk := q.Get("max-keys"); mk != "" {
		if v, err := strconv.Atoi(mk); err == nil && v > 0 && v <= 1000 {
			maxKeys = v
		}
	}

	res, err := h.svc.ListObjectsWithDelimiter(bucket.ID, prefix, delimiter, startAfter, maxKeys)
	if err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}

	type s3Content struct {
		Key          string `xml:"Key"`
		LastModified string `xml:"LastModified"`
		ETag         string `xml:"ETag"`
		Size         int64  `xml:"Size"`
		StorageClass string `xml:"StorageClass"`
	}
	type s3Prefix struct {
		Prefix string `xml:"Prefix"`
	}
	type listBucketResult struct {
		XMLName               xml.Name    `xml:"ListBucketResult"`
		Xmlns                 string      `xml:"xmlns,attr"`
		Name                  string      `xml:"Name"`
		Prefix                string      `xml:"Prefix"`
		Delimiter             string      `xml:"Delimiter,omitempty"`
		KeyCount              int         `xml:"KeyCount"`
		MaxKeys               int         `xml:"MaxKeys"`
		IsTruncated           bool        `xml:"IsTruncated"`
		NextContinuationToken string      `xml:"NextContinuationToken,omitempty"`
		Contents              []s3Content `xml:"Contents"`
		CommonPrefixes        []s3Prefix  `xml:"CommonPrefixes"`
	}

	out := listBucketResult{
		Xmlns:                 "http://s3.amazonaws.com/doc/2006-03-01/",
		Name:                  bucket.Name,
		Prefix:                prefix,
		Delimiter:             delimiter,
		KeyCount:              len(res.Objects) + len(res.CommonPrefixes),
		MaxKeys:               maxKeys,
		IsTruncated:           res.IsTruncated,
		NextContinuationToken: res.NextToken,
	}
	for _, o := range res.Objects {
		out.Contents = append(out.Contents, s3Content{
			Key:          o.Key,
			LastModified: o.UpdatedAt.UTC().Format(s3TimeFormat),
			ETag:         `"` + o.ETag + `"`,
			Size:         o.SizeBytes,
			StorageClass: "STANDARD",
		})
	}
	for _, p := range res.CommonPrefixes {
		out.CommonPrefixes = append(out.CommonPrefixes, s3Prefix{Prefix: p})
	}
	writeXML(w, http.StatusOK, out)
}

func (h *Handler) handleHeadObject(w http.ResponseWriter, bucket *db.Bucket, key string) {
	cleanKey, err := storage.SanitizeKey(key)
	if err != nil {
		writeS3Error(w, http.StatusBadRequest, "InvalidArgument", err.Error())
		return
	}
	obj, err := h.svc.Store.GetObject(bucket.ID, cleanKey)
	if err != nil {
		writeS3Error(w, http.StatusNotFound, "NoSuchKey", "The specified key does not exist.")
		return
	}
	w.Header().Set("Content-Type", obj.MimeType)
	w.Header().Set("Content-Length", strconv.FormatInt(obj.SizeBytes, 10))
	w.Header().Set("ETag", `"`+obj.ETag+`"`)
	w.Header().Set("Last-Modified", obj.UpdatedAt.UTC().Format(http.TimeFormat))
	w.Header().Set("Accept-Ranges", "bytes")
	for k, v := range obj.Metadata {
		w.Header().Set("X-Amz-Meta-"+k, v)
	}
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleGetObject(w http.ResponseWriter, r *http.Request, bucket *db.Bucket, key string) {
	cleanKey, err := storage.SanitizeKey(key)
	if err != nil {
		writeS3Error(w, http.StatusBadRequest, "InvalidArgument", err.Error())
		return
	}
	obj, err := h.svc.Store.GetObject(bucket.ID, cleanKey)
	if err != nil {
		writeS3Error(w, http.StatusNotFound, "NoSuchKey", "The specified key does not exist.")
		return
	}
	for k, v := range obj.Metadata {
		w.Header().Set("X-Amz-Meta-"+k, v)
	}
	f, err := h.svc.Storage.OpenBlob(obj.StoragePath)
	if err != nil {
		writeS3Error(w, http.StatusNotFound, "NoSuchKey", "Blob file missing")
		return
	}
	defer f.Close()
	h.svc.ServeBlob(w, r, bucket, obj, f, obj.MimeType, obj.ETag)
}

func (h *Handler) handlePutObject(w http.ResponseWriter, r *http.Request, bucket *db.Bucket, key string) {
	meta := map[string]string{}
	for hk, hv := range r.Header {
		if strings.HasPrefix(strings.ToLower(hk), "x-amz-meta-") && len(hv) > 0 {
			metaKey := strings.ToLower(strings.TrimPrefix(strings.ToLower(hk), "x-amz-meta-"))
			meta[metaKey] = hv[0]
		}
	}
	obj, err := h.svc.PutObject(bucket, key, r.Body, r.Header.Get("Content-Type"), meta, true)
	if err != nil {
		switch {
		case errors.Is(err, storage.ErrTooLarge):
			writeS3Error(w, http.StatusRequestEntityTooLarge, "EntityTooLarge", err.Error())
		case errors.Is(err, core.ErrMIMEForbidden):
			writeS3Error(w, http.StatusForbidden, "AccessDenied", err.Error())
		default:
			writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		}
		return
	}
	w.Header().Set("ETag", `"`+obj.ETag+`"`)
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleCopyObject(w http.ResponseWriter, apiKey *db.APIKey, dstBucket *db.Bucket, dstKey, copySource string) {
	decoded, err := url.PathUnescape(strings.TrimLeft(copySource, "/"))
	if err != nil {
		writeS3Error(w, http.StatusBadRequest, "InvalidArgument", "Invalid x-amz-copy-source")
		return
	}
	slash := strings.IndexByte(decoded, '/')
	if slash <= 0 {
		writeS3Error(w, http.StatusBadRequest, "InvalidArgument", "Invalid x-amz-copy-source")
		return
	}
	srcBucketName := decoded[:slash]
	srcKey := decoded[slash+1:]
	srcBucket, err := h.svc.Store.GetBucketByName(srcBucketName)
	if err != nil || srcBucket.ProjectID != apiKey.ProjectID {
		writeS3Error(w, http.StatusNotFound, "NoSuchBucket", "Source bucket not found")
		return
	}
	copied, err := h.svc.CopyObject(srcBucket, srcKey, dstBucket, dstKey)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeS3Error(w, http.StatusNotFound, "NoSuchKey", "Source key not found")
			return
		}
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	type copyResult struct {
		XMLName      xml.Name `xml:"CopyObjectResult"`
		LastModified string   `xml:"LastModified"`
		ETag         string   `xml:"ETag"`
	}
	writeXML(w, http.StatusOK, copyResult{
		LastModified: copied.UpdatedAt.UTC().Format(s3TimeFormat),
		ETag:         `"` + copied.ETag + `"`,
	})
}

func (h *Handler) handleDeleteObject(w http.ResponseWriter, bucket *db.Bucket, key string) {
	err := h.svc.DeleteObject(bucket, key)
	if err != nil && !errors.Is(err, db.ErrNotFound) {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleDeleteObjects(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	type deleteReq struct {
		Objects []struct {
			Key string `xml:"Key"`
		} `xml:"Object"`
	}
	var req deleteReq
	if err := xml.NewDecoder(io.LimitReader(r.Body, 2*1024*1024)).Decode(&req); err != nil {
		writeS3Error(w, http.StatusBadRequest, "MalformedXML", err.Error())
		return
	}
	type deletedItem struct {
		Key string `xml:"Key"`
	}
	type deleteRes struct {
		XMLName xml.Name      `xml:"DeleteResult"`
		Xmlns   string        `xml:"xmlns,attr"`
		Deleted []deletedItem `xml:"Deleted"`
	}
	res := deleteRes{Xmlns: "http://s3.amazonaws.com/doc/2006-03-01/"}
	for _, item := range req.Objects {
		_ = h.svc.DeleteObject(bucket, item.Key)
		res.Deleted = append(res.Deleted, deletedItem{Key: item.Key})
	}
	writeXML(w, http.StatusOK, res)
}

// --- Multipart Uploads ---

func (h *Handler) handleCreateMultipartUpload(w http.ResponseWriter, r *http.Request, bucket *db.Bucket, key string) {
	cleanKey, err := storage.SanitizeKey(key)
	if err != nil {
		writeS3Error(w, http.StatusBadRequest, "InvalidArgument", err.Error())
		return
	}
	mimeType := r.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	now := time.Now().UTC()
	mu := &db.MultipartUpload{
		ID:        uuid.NewString(),
		BucketID:  bucket.ID,
		ObjectKey: cleanKey,
		MimeType:  mimeType,
		Metadata:  map[string]string{},
		Status:    "pending",
		ExpiresAt: now.Add(24 * time.Hour),
		CreatedAt: now,
	}
	if err := h.svc.Store.CreateMultipartUpload(mu); err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	type initRes struct {
		XMLName  xml.Name `xml:"InitiateMultipartUploadResult"`
		Xmlns    string   `xml:"xmlns,attr"`
		Bucket   string   `xml:"Bucket"`
		Key      string   `xml:"Key"`
		UploadID string   `xml:"UploadId"`
	}
	writeXML(w, http.StatusOK, initRes{
		Xmlns:    "http://s3.amazonaws.com/doc/2006-03-01/",
		Bucket:   bucket.Name,
		Key:      cleanKey,
		UploadID: mu.ID,
	})
}

func (h *Handler) handleUploadPart(w http.ResponseWriter, r *http.Request, bucket *db.Bucket, key, uploadID, partNumStr string) {
	mu, err := h.svc.Store.GetMultipartUpload(uploadID)
	if err != nil || mu.BucketID != bucket.ID || mu.Status != "pending" {
		writeS3Error(w, http.StatusNotFound, "NoSuchUpload", "The specified upload does not exist.")
		return
	}
	partNum, err := strconv.Atoi(partNumStr)
	if err != nil || partNum < 1 || partNum > 10000 {
		writeS3Error(w, http.StatusBadRequest, "InvalidArgument", "Invalid partNumber")
		return
	}
	relPath, size, etag, err := h.svc.Storage.WritePart(uploadID, partNum, r.Body)
	if err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	part := &db.UploadPart{
		ID:          uuid.NewString(),
		UploadID:    uploadID,
		PartNumber:  partNum,
		SizeBytes:   size,
		ETag:        etag,
		StoragePath: relPath,
		CreatedAt:   time.Now().UTC(),
	}
	if err := h.svc.Store.UpsertUploadPart(part); err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	w.Header().Set("ETag", `"`+etag+`"`)
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleCompleteMultipartUpload(w http.ResponseWriter, r *http.Request, bucket *db.Bucket, key, uploadID string) {
	mu, err := h.svc.Store.GetMultipartUpload(uploadID)
	if err != nil || mu.BucketID != bucket.ID || mu.Status != "pending" {
		writeS3Error(w, http.StatusNotFound, "NoSuchUpload", "The specified upload does not exist.")
		return
	}

	type reqPart struct {
		PartNumber int    `xml:"PartNumber"`
		ETag       string `xml:"ETag"`
	}
	var req struct {
		Parts []reqPart `xml:"Part"`
	}
	_ = xml.NewDecoder(io.LimitReader(r.Body, 2*1024*1024)).Decode(&req)

	parts, err := h.svc.Store.ListUploadParts(uploadID)
	if err != nil || len(parts) == 0 {
		writeS3Error(w, http.StatusBadRequest, "InvalidPart", "No uploaded parts found")
		return
	}

	partByNum := map[int]db.UploadPart{}
	for _, p := range parts {
		partByNum[p.PartNumber] = p
	}

	var orderedPaths []string
	if len(req.Parts) > 0 {
		for _, rp := range req.Parts {
			p, ok := partByNum[rp.PartNumber]
			if !ok {
				writeS3Error(w, http.StatusBadRequest, "InvalidPart", fmt.Sprintf("Missing part %d", rp.PartNumber))
				return
			}
			orderedPaths = append(orderedPaths, p.StoragePath)
		}
	} else {
		for _, p := range parts {
			orderedPaths = append(orderedPaths, p.StoragePath)
		}
	}

	maxBytes := bucket.MaxFileSize
	if maxBytes <= 0 || maxBytes > h.svc.Cfg.MaxUploadBytes {
		maxBytes = h.svc.Cfg.MaxUploadBytes
	}
	blob, err := h.svc.Storage.AssembleParts(bucket.ID, orderedPaths, maxBytes, mu.ObjectKey)
	if err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}

	finalMIME := blob.SniffedMIME
	if mu.MimeType != "" && mu.MimeType != "application/octet-stream" && (finalMIME == "application/octet-stream" || strings.HasPrefix(finalMIME, "text/plain")) {
		finalMIME = mu.MimeType
	}
	if !core.CheckMIMEAllowed(bucket.AllowedMimeTypes, finalMIME) {
		_ = h.svc.Storage.DeleteBlob(blob.StoragePath)
		writeS3Error(w, http.StatusForbidden, "AccessDenied", core.ErrMIMEForbidden.Error())
		return
	}

	now := time.Now().UTC()
	obj := &db.Object{
		ID:          uuid.NewString(),
		BucketID:    bucket.ID,
		Key:         mu.ObjectKey,
		SizeBytes:   blob.SizeBytes,
		MimeType:    finalMIME,
		ETag:        blob.ETag,
		SHA256:      blob.SHA256,
		StoragePath: blob.StoragePath,
		Metadata:    mu.Metadata,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	oldPath, err := h.svc.Store.UpsertObject(obj)
	if err != nil {
		_ = h.svc.Storage.DeleteBlob(blob.StoragePath)
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	if oldPath != "" && oldPath != blob.StoragePath {
		_ = h.svc.Storage.DeleteBlob(oldPath)
	}

	_ = h.svc.Store.UpdateMultipartStatus(uploadID, "completed")
	_ = h.svc.Store.DeleteUploadParts(uploadID)
	h.svc.Storage.DeletePartsDir(uploadID)

	h.svc.Store.RecordUsage(bucket.ProjectID, bucket.ID, "ingress", obj.SizeBytes)
	h.svc.Webhooks.Emit(bucket.ProjectID, "multipart.completed", map[string]any{
		"bucket":    bucket.Name,
		"key":       obj.Key,
		"size":      obj.SizeBytes,
		"mime_type": obj.MimeType,
		"etag":      obj.ETag,
	})

	type completeRes struct {
		XMLName  xml.Name `xml:"CompleteMultipartUploadResult"`
		Xmlns    string   `xml:"xmlns,attr"`
		Location string   `xml:"Location"`
		Bucket   string   `xml:"Bucket"`
		Key      string   `xml:"Key"`
		ETag     string   `xml:"ETag"`
	}
	writeXML(w, http.StatusOK, completeRes{
		Xmlns:    "http://s3.amazonaws.com/doc/2006-03-01/",
		Location: fmt.Sprintf("%s/%s/%s", h.svc.Cfg.PublicURL, bucket.Name, obj.Key),
		Bucket:   bucket.Name,
		Key:      obj.Key,
		ETag:     `"` + obj.ETag + `"`,
	})
}

func (h *Handler) handleAbortMultipartUpload(w http.ResponseWriter, bucket *db.Bucket, uploadID string) {
	mu, err := h.svc.Store.GetMultipartUpload(uploadID)
	if err != nil || mu.BucketID != bucket.ID {
		writeS3Error(w, http.StatusNotFound, "NoSuchUpload", "The specified upload does not exist.")
		return
	}
	_ = h.svc.Store.UpdateMultipartStatus(uploadID, "aborted")
	_ = h.svc.Store.DeleteUploadParts(uploadID)
	h.svc.Storage.DeletePartsDir(uploadID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleListParts(w http.ResponseWriter, bucket *db.Bucket, uploadID string) {
	mu, err := h.svc.Store.GetMultipartUpload(uploadID)
	if err != nil || mu.BucketID != bucket.ID {
		writeS3Error(w, http.StatusNotFound, "NoSuchUpload", "The specified upload does not exist.")
		return
	}
	parts, err := h.svc.Store.ListUploadParts(uploadID)
	if err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	type partItem struct {
		PartNumber   int    `xml:"PartNumber"`
		LastModified string `xml:"LastModified"`
		ETag         string `xml:"ETag"`
		Size         int64  `xml:"Size"`
	}
	type res struct {
		XMLName  xml.Name   `xml:"ListPartsResult"`
		Xmlns    string     `xml:"xmlns,attr"`
		Bucket   string     `xml:"Bucket"`
		Key      string     `xml:"Key"`
		UploadID string     `xml:"UploadId"`
		Parts    []partItem `xml:"Part"`
	}
	out := res{
		Xmlns:    "http://s3.amazonaws.com/doc/2006-03-01/",
		Bucket:   bucket.Name,
		Key:      mu.ObjectKey,
		UploadID: uploadID,
	}
	for _, p := range parts {
		out.Parts = append(out.Parts, partItem{
			PartNumber:   p.PartNumber,
			LastModified: p.CreatedAt.UTC().Format(s3TimeFormat),
			ETag:         `"` + p.ETag + `"`,
			Size:         p.SizeBytes,
		})
	}
	writeXML(w, http.StatusOK, out)
}

func (h *Handler) handleGetBucketCORS(w http.ResponseWriter, bucket *db.Bucket) {
	type corsRuleXML struct {
		AllowedOrigin []string `xml:"AllowedOrigin"`
		AllowedMethod []string `xml:"AllowedMethod"`
		AllowedHeader []string `xml:"AllowedHeader"`
		ExposeHeader  []string `xml:"ExposeHeader"`
		MaxAgeSeconds int      `xml:"MaxAgeSeconds,omitempty"`
	}
	type corsConfig struct {
		XMLName xml.Name      `xml:"CORSConfiguration"`
		Xmlns   string        `xml:"xmlns,attr"`
		Rules   []corsRuleXML `xml:"CORSRule"`
	}
	out := corsConfig{Xmlns: "http://s3.amazonaws.com/doc/2006-03-01/"}
	for _, r := range bucket.CORSRules {
		out.Rules = append(out.Rules, corsRuleXML{
			AllowedOrigin: r.AllowedOrigins,
			AllowedMethod: r.AllowedMethods,
			AllowedHeader: r.AllowedHeaders,
			ExposeHeader:  r.ExposeHeaders,
			MaxAgeSeconds: r.MaxAgeSeconds,
		})
	}
	writeXML(w, http.StatusOK, out)
}

func (h *Handler) handlePutBucketCORS(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	type corsRuleXML struct {
		AllowedOrigin []string `xml:"AllowedOrigin"`
		AllowedMethod []string `xml:"AllowedMethod"`
		AllowedHeader []string `xml:"AllowedHeader"`
		ExposeHeader  []string `xml:"ExposeHeader"`
		MaxAgeSeconds int      `xml:"MaxAgeSeconds"`
	}
	var cfg struct {
		Rules []corsRuleXML `xml:"CORSRule"`
	}
	if err := xml.NewDecoder(io.LimitReader(r.Body, 1024*1024)).Decode(&cfg); err != nil {
		writeS3Error(w, http.StatusBadRequest, "MalformedXML", err.Error())
		return
	}
	var rules []db.CORSRule
	for _, xr := range cfg.Rules {
		rules = append(rules, db.CORSRule{
			AllowedOrigins: xr.AllowedOrigin,
			AllowedMethods: xr.AllowedMethod,
			AllowedHeaders: xr.AllowedHeader,
			ExposeHeaders:  xr.ExposeHeader,
			MaxAgeSeconds:  xr.MaxAgeSeconds,
		})
	}
	bucket.CORSRules = rules
	if err := h.svc.Store.UpdateBucket(bucket); err != nil {
		writeS3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	w.WriteHeader(http.StatusOK)
}

func writeXML(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(xml.Header))
	_ = xml.NewEncoder(w).Encode(payload)
}

func writeS3Error(w http.ResponseWriter, status int, code, msg string) {
	type s3Err struct {
		XMLName xml.Name `xml:"Error"`
		Code    string   `xml:"Code"`
		Message string   `xml:"Message"`
	}
	writeXML(w, status, s3Err{Code: code, Message: msg})
}

