package restapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/serevox/serevox/internal/auth"
	"github.com/serevox/serevox/internal/core"
	"github.com/serevox/serevox/internal/db"
	"github.com/serevox/serevox/internal/imageproc"
	"github.com/serevox/serevox/internal/storage"
)

type Handler struct {
	svc  *core.Service
	auth *auth.Service
}

func NewHandler(svc *core.Service, authSvc *auth.Service) *Handler {
	return &Handler{svc: svc, auth: authSvc}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1")

	if r.Method == http.MethodOptions {
		h.svc.ApplyBucketCORS(w, r, nil)
		w.WriteHeader(http.StatusOK)
		return
	}

	switch {
	case strings.HasPrefix(path, "/public/") && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		h.handlePublicGet(w, r, strings.TrimPrefix(path, "/public/"))
	case strings.HasPrefix(path, "/authenticated/") && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		h.handleAuthenticatedGet(w, r, strings.TrimPrefix(path, "/authenticated/"))
	case strings.HasPrefix(path, "/upload/signed/") && r.Method == http.MethodPut:
		token := strings.TrimPrefix(path, "/upload/signed/")
		h.handleSignedUpload(w, r, token)
	case strings.HasPrefix(path, "/buckets/"):
		h.handleBucketREST(w, r, strings.TrimPrefix(path, "/buckets/"))
	default:
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "endpoint not found"})
	}
}

func (h *Handler) authenticateRESTKey(r *http.Request) (*db.APIKey, error) {
	raw := strings.TrimSpace(r.Header.Get("X-Api-Key"))
	if raw == "" {
		authHdr := r.Header.Get("Authorization")
		if strings.HasPrefix(authHdr, "Bearer ") {
			raw = strings.TrimSpace(strings.TrimPrefix(authHdr, "Bearer "))
		}
	}
	if raw == "" {
		return nil, auth.ErrUnauthorized
	}
	k, err := h.svc.Store.GetAPIKeyByHash(auth.HashToken(raw))
	if err != nil {
		return nil, auth.ErrUnauthorized
	}
	h.svc.Store.TouchAPIKeyUsed(k.ID)
	return k, nil
}

func (h *Handler) handlePublicGet(w http.ResponseWriter, r *http.Request, rest string) {
	bucketName, key, ok := splitBucketAndKey(rest)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing bucket or object key"})
		return
	}
	bucket, err := h.svc.Store.GetBucketByName(bucketName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "bucket not found"})
		return
	}
	if bucket.Visibility != "public" {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "bucket is private"})
		return
	}
	// Referer Hotlinking Protection (if CORS origins configured strictly without *)
	if len(bucket.CORSRules) > 0 && len(bucket.CORSRules[0].AllowedOrigins) > 0 {
		allowed := bucket.CORSRules[0].AllowedOrigins
		isWildcard := false
		for _, o := range allowed {
			if o == "*" {
				isWildcard = true
				break
			}
		}
		if !isWildcard {
			ref := r.Header.Get("Referer")
			if ref != "" {
				matched := false
				for _, o := range allowed {
					if strings.HasPrefix(ref, o) {
						matched = true
						break
					}
				}
				if !matched {
					writeJSON(w, http.StatusForbidden, map[string]any{"error": "hotlinking forbidden by bucket referer policy"})
					return
				}
			}
		}
	}
	h.serveObject(w, r, bucket, key)
}

func (h *Handler) handleAuthenticatedGet(w http.ResponseWriter, r *http.Request, rest string) {
	bucketName, key, ok := splitBucketAndKey(rest)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing bucket or object key"})
		return
	}
	bucket, err := h.svc.Store.GetBucketByName(bucketName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "bucket not found"})
		return
	}

	if token := r.URL.Query().Get("token"); token != "" {
		claims, err := h.auth.VerifySignedObjectToken(token)
		if err != nil || claims.Operation != "download" || claims.BucketID != bucket.ID || claims.ObjectKey != key {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "invalid or expired signed URL token"})
			return
		}
		h.serveObject(w, r, bucket, key)
		return
	}

	apiKey, err := h.authenticateRESTKey(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if apiKey.ProjectID != bucket.ProjectID || (apiKey.BucketID != "" && apiKey.BucketID != bucket.ID) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
		return
	}
	if apiKey.KeyType == "anon" && bucket.Visibility != "public" {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "anon key cannot read private buckets without signed URL"})
		return
	}
	h.serveObject(w, r, bucket, key)
}

func (h *Handler) serveObject(w http.ResponseWriter, r *http.Request, bucket *db.Bucket, rawKey string) {
	cleanKey, err := storage.SanitizeKey(rawKey)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	obj, err := h.svc.Store.GetObject(bucket.ID, cleanKey)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "object not found"})
		return
	}

	if opts, wantTransform := imageproc.ParseOptions(r); wantTransform && strings.HasPrefix(obj.MimeType, "image/") && obj.MimeType != "image/svg+xml" {
		srcAbs := h.svc.Storage.AbsBlobPath(obj.StoragePath)
		if cachePath, outMIME, err := imageproc.TransformOrCached(h.svc.Storage.CacheDir(), srcAbs, obj.ETag, obj.MimeType, opts); err == nil {
			cf, err := os.Open(cachePath)
			if err == nil {
				defer cf.Close()
				h.svc.ServeBlob(w, r, bucket, obj, cf, outMIME, obj.ETag+"-t")
				return
			}
		}
	}

	f, err := h.svc.Storage.OpenBlob(obj.StoragePath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "blob missing"})
		return
	}
	defer f.Close()
	h.svc.ServeBlob(w, r, bucket, obj, f, obj.MimeType, obj.ETag)
}

func (h *Handler) handleSignedUpload(w http.ResponseWriter, r *http.Request, token string) {
	claims, err := h.auth.VerifySignedObjectToken(token)
	if err != nil || claims.Operation != "upload" {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "invalid or expired upload token"})
		return
	}
	bucket, err := h.svc.Store.GetBucketByID(claims.BucketID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "bucket not found"})
		return
	}
	h.svc.ApplyBucketCORS(w, r, bucket)

	obj, err := h.svc.PutObject(bucket, claims.ObjectKey, r.Body, r.Header.Get("Content-Type"), nil, claims.Upsert)
	if err != nil {
		h.writePutError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"bucket": bucket.Name,
		"object": obj,
	})
}

func (h *Handler) handleBucketREST(w http.ResponseWriter, r *http.Request, rest string) {
	// Expected: :bucket/objects/...
	parts := strings.SplitN(rest, "/", 3)
	if len(parts) < 2 || parts[1] != "objects" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "invalid REST storage route"})
		return
	}
	bucketName := parts[0]
	action := ""
	if len(parts) == 3 {
		action = parts[2]
	}

	bucket, err := h.svc.Store.GetBucketByName(bucketName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "bucket not found"})
		return
	}
	h.svc.ApplyBucketCORS(w, r, bucket)

	apiKey, err := h.authenticateRESTKey(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if apiKey.ProjectID != bucket.ProjectID || (apiKey.BucketID != "" && apiKey.BucketID != bucket.ID) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
		return
	}
	if apiKey.KeyType == "anon" {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "service_role key required for management/write operations"})
		return
	}

	switch {
	case action == "upload" && r.Method == http.MethodPost:
		h.handleUpload(w, r, bucket)
	case action == "sign-upload" && r.Method == http.MethodPost:
		h.handleCreateSignedUpload(w, r, bucket)
	case action == "sign" && r.Method == http.MethodPost:
		h.handleCreateSignedDownload(w, r, bucket)
	case action == "list" && r.Method == http.MethodPost:
		h.handleListObjects(w, r, bucket)
	case action == "move" && r.Method == http.MethodPost:
		h.handleMoveOrCopy(w, r, bucket, true)
	case action == "copy" && r.Method == http.MethodPost:
		h.handleMoveOrCopy(w, r, bucket, false)
	case action == "" && r.Method == http.MethodDelete:
		h.handleBatchDelete(w, r, bucket)
	default:
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "unknown action"})
	}
}

func (h *Handler) handleUpload(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	upsert := strings.EqualFold(r.Header.Get("X-Upsert"), "true") || r.URL.Query().Get("upsert") == "true"
	ct := r.Header.Get("Content-Type")

	if strings.HasPrefix(ct, "multipart/form-data") {
		mr, err := r.MultipartReader()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		key := r.URL.Query().Get("path")
		declaredMIME := ""
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
				return
			}
			if part.FormName() == "path" || part.FormName() == "key" {
				b, _ := io.ReadAll(io.LimitReader(part, 4096))
				if len(b) > 0 {
					key = string(b)
				}
				_ = part.Close()
				continue
			}
			if part.FormName() == "file" {
				if key == "" {
					key = part.FileName()
				}
				declaredMIME = part.Header.Get("Content-Type")
				obj, err := h.svc.PutObject(bucket, key, part, declaredMIME, nil, upsert)
				_ = part.Close()
				if err != nil {
					h.writePutError(w, err)
					return
				}
				writeJSON(w, http.StatusOK, map[string]any{
					"bucket":     bucket.Name,
					"object":     obj,
					"public_url": h.publicURLIfPublic(bucket, obj.Key),
				})
				return
			}
			_ = part.Close()
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing file part in multipart request"})
		return
	}

	key := r.URL.Query().Get("path")
	if key == "" {
		key = r.Header.Get("X-Object-Key")
	}
	if key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing path query param or X-Object-Key header"})
		return
	}
	obj, err := h.svc.PutObject(bucket, key, r.Body, ct, nil, upsert)
	if err != nil {
		h.writePutError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"bucket":     bucket.Name,
		"object":     obj,
		"public_url": h.publicURLIfPublic(bucket, obj.Key),
	})
}

func (h *Handler) handleCreateSignedUpload(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	var body struct {
		Path      string `json:"path"`
		ExpiresIn int    `json:"expiresIn"`
		Upsert    bool   `json:"upsert"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}
	cleanKey, err := storage.SanitizeKey(body.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	ttl := 15 * time.Minute
	if body.ExpiresIn > 0 {
		ttl = time.Duration(body.ExpiresIn) * time.Second
	}
	token, err := h.auth.IssueSignedObjectToken(bucket.ID, bucket.Name, cleanKey, "upload", body.Upsert, ttl)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"signedUrl": fmt.Sprintf("%s/v1/upload/signed/%s", h.svc.Cfg.PublicURL, url.PathEscape(token)),
		"token":     token,
		"path":      cleanKey,
		"expiresIn": int(ttl.Seconds()),
	})
}

func (h *Handler) handleCreateSignedDownload(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	var body struct {
		Path      string   `json:"path"`
		Paths     []string `json:"paths"`
		ExpiresIn int      `json:"expiresIn"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}
	ttl := time.Hour
	if body.ExpiresIn > 0 {
		ttl = time.Duration(body.ExpiresIn) * time.Second
	}

	if body.Path != "" {
		cleanKey, err := storage.SanitizeKey(body.Path)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		tok, err := h.auth.IssueSignedObjectToken(bucket.ID, bucket.Name, cleanKey, "download", false, ttl)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"signedUrl": fmt.Sprintf("%s/v1/authenticated/%s/%s?token=%s", h.svc.Cfg.PublicURL, url.PathEscape(bucket.Name), cleanKey, url.QueryEscape(tok)),
			"expiresIn": int(ttl.Seconds()),
		})
		return
	}

	type signedEntry struct {
		Path      string `json:"path"`
		SignedURL string `json:"signedUrl"`
		Error     string `json:"error,omitempty"`
	}
	var out []signedEntry
	for _, p := range body.Paths {
		cleanKey, err := storage.SanitizeKey(p)
		if err != nil {
			out = append(out, signedEntry{Path: p, Error: err.Error()})
			continue
		}
		tok, err := h.auth.IssueSignedObjectToken(bucket.ID, bucket.Name, cleanKey, "download", false, ttl)
		if err != nil {
			out = append(out, signedEntry{Path: p, Error: err.Error()})
			continue
		}
		out = append(out, signedEntry{
			Path:      cleanKey,
			SignedURL: fmt.Sprintf("%s/v1/authenticated/%s/%s?token=%s", h.svc.Cfg.PublicURL, url.PathEscape(bucket.Name), cleanKey, url.QueryEscape(tok)),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": out})
}

func (h *Handler) handleListObjects(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	var body struct {
		Prefix    string `json:"prefix"`
		Delimiter string `json:"delimiter"`
		Cursor    string `json:"cursor"`
		Limit     int    `json:"limit"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&body)
	res, err := h.svc.ListObjectsWithDelimiter(bucket.ID, body.Prefix, body.Delimiter, body.Cursor, body.Limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *Handler) handleMoveOrCopy(w http.ResponseWriter, r *http.Request, bucket *db.Bucket, isMove bool) {
	var body struct {
		SourceKey      string `json:"sourceKey"`
		DestinationKey string `json:"destinationKey"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}
	obj, err := h.svc.CopyObject(bucket, body.SourceKey, bucket, body.DestinationKey)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "source object not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if isMove && body.SourceKey != body.DestinationKey {
		_ = h.svc.DeleteObject(bucket, body.SourceKey)
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": obj})
}

func (h *Handler) handleBatchDelete(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}
	var deleted []string
	for _, p := range body.Paths {
		if err := h.svc.DeleteObject(bucket, p); err == nil {
			deleted = append(deleted, p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}

func (h *Handler) writePutError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": err.Error()})
	case errors.Is(err, core.ErrMIMEForbidden):
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": err.Error()})
	case errors.Is(err, core.ErrAlreadyExists):
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error()})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
	}
}

func (h *Handler) publicURLIfPublic(bucket *db.Bucket, key string) string {
	if bucket.Visibility != "public" {
		return ""
	}
	return fmt.Sprintf("%s/v1/public/%s/%s", h.svc.Cfg.PublicURL, url.PathEscape(bucket.Name), key)
}

func splitBucketAndKey(rest string) (string, string, bool) {
	rest = strings.TrimLeft(rest, "/")
	idx := strings.IndexByte(rest, '/')
	if idx <= 0 || idx >= len(rest)-1 {
		return "", "", false
	}
	return rest[:idx], rest[idx+1:], true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

