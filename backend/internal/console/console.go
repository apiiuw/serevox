package console

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/serevox/serevox/internal/auth"
	"github.com/serevox/serevox/internal/core"
	"github.com/serevox/serevox/internal/db"
	"github.com/serevox/serevox/internal/storage"
	"github.com/serevox/serevox/internal/webhook"
)

var slugRe = regexp.MustCompile(`[^a-z0-9-]+`)

type Handler struct {
	svc  *core.Service
	auth *auth.Service
}

func NewHandler(svc *core.Service, authSvc *auth.Service) *Handler {
	return &Handler{svc: svc, auth: authSvc}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.svc.ApplyBucketCORS(w, r, nil)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/console/api")

	switch {
	case path == "/setup-status" && r.Method == http.MethodGet:
		h.handleSetupStatus(w)
	case path == "/setup" && r.Method == http.MethodPost:
		h.handleSetup(w, r)
	case path == "/auth/register" && r.Method == http.MethodPost:
		h.handleRegister(w, r)
	case path == "/auth/login" && r.Method == http.MethodPost:
		h.handleLogin(w, r)
	case path == "/billing/midtrans-config" && r.Method == http.MethodGet:
		h.handleMidtransConfig(w)
	case path == "/billing/charge-snap" && r.Method == http.MethodPost:
		h.handleMidtransSnapToken(w, r)
	default:
		claims, err := h.requireUser(r)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		h.routeAuthed(w, r, path, claims)
	}
}

func (h *Handler) requireUser(r *http.Request) (*auth.ConsoleClaims, error) {
	hdr := r.Header.Get("Authorization")
	tok := ""
	if strings.HasPrefix(hdr, "Bearer ") {
		tok = strings.TrimSpace(strings.TrimPrefix(hdr, "Bearer "))
	} else if qTok := r.URL.Query().Get("console_token"); qTok != "" {
		tok = qTok
	}
	if tok == "" {
		return nil, auth.ErrUnauthorized
	}
	return h.auth.VerifyConsoleToken(tok)
}

func (h *Handler) routeAuthed(w http.ResponseWriter, r *http.Request, path string, claims *auth.ConsoleClaims) {
	switch {
	case path == "/auth/me" && r.Method == http.MethodGet:
		h.handleMe(w, claims)
	case path == "/projects" && r.Method == http.MethodGet:
		h.handleListProjects(w, claims)
	case path == "/projects" && r.Method == http.MethodPost:
		h.handleCreateProject(w, r, claims)
	case strings.HasPrefix(path, "/projects/"):
		h.routeProjectSubpaths(w, r, claims, strings.TrimPrefix(path, "/projects/"))
	case strings.HasPrefix(path, "/buckets/"):
		h.routeBucketSubpaths(w, r, claims, strings.TrimPrefix(path, "/buckets/"))
	case path == "/admin" || strings.HasPrefix(path, "/admin/"):
		h.routeAdmin(w, r, claims, strings.TrimPrefix(path, "/admin"))
	case strings.HasPrefix(path, "/webhooks/") && strings.HasSuffix(path, "/deliveries") && r.Method == http.MethodGet:
		webhookID := strings.TrimSuffix(strings.TrimPrefix(path, "/webhooks/"), "/deliveries")
		dels, err := h.svc.Store.ListWebhookDeliveries(webhookID, 30)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		if dels == nil {
			dels = []db.WebhookDelivery{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"deliveries": dels})
	default:
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "route not found"})
	}
}

func (h *Handler) handleSetupStatus(w http.ResponseWriter) {
	cnt, err := h.svc.Store.CountUsers()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"needs_setup": cnt == 0,
		"public_url":  h.svc.Cfg.PublicURL,
	})
}

func (h *Handler) handleSetup(w http.ResponseWriter, r *http.Request) {
	cnt, err := h.svc.Store.CountUsers()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if cnt > 0 {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "setup already completed"})
		return
	}
	h.provisionFromRequest(w, r, "admin", true)
}

func (h *Handler) handleRegister(w http.ResponseWriter, r *http.Request) {
	cnt, err := h.svc.Store.CountUsers()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	role := "member"
	isFirst := false
	if cnt == 0 {
		role = "admin"
		isFirst = true
	}
	h.provisionFromRequest(w, r, role, isFirst)
}

func (h *Handler) provisionFromRequest(w http.ResponseWriter, r *http.Request, role string, isFirst bool) {
	var body struct {
		Email       string `json:"email"`
		Name        string `json:"name"`
		Password    string `json:"password"`
		ProjectName string `json:"project_name"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	user, proj, creds, errStatus, errMsg := h.provisionUserAccount(body.Email, body.Name, body.Password, body.ProjectName, role, isFirst)
	if errMsg != "" {
		writeJSON(w, errStatus, map[string]any{"error": errMsg})
		return
	}

	tok, err := h.auth.IssueConsoleToken(user.ID, user.Email, user.Role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"token":               tok,
		"user":                user,
		"project":             proj,
		"initial_credentials": creds,
	})
}

func (h *Handler) provisionUserAccount(rawEmail, rawName, password, rawProjectName, role string, isFirst bool) (*db.User, *db.Project, map[string]any, int, string) {
	email := strings.ToLower(strings.TrimSpace(rawEmail))
	if email == "" || !strings.Contains(email, "@") || len(password) < 6 {
		return nil, nil, nil, http.StatusBadRequest, "valid email and password (>=6 chars) required"
	}
	if _, err := h.svc.Store.GetUserByEmail(email); err == nil {
		return nil, nil, nil, http.StatusConflict, "email is already registered"
	}
	name := strings.TrimSpace(rawName)
	if name == "" {
		name = "Workspace Owner"
	}
	projectName := strings.TrimSpace(rawProjectName)
	if projectName == "" {
		projectName = "primary-web-app"
	}

	hash, err := h.auth.HashPassword(password)
	if err != nil {
		return nil, nil, nil, http.StatusInternalServerError, err.Error()
	}

	now := time.Now().UTC()
	shortID := uuid.NewString()[:6]
	user := &db.User{
		ID:           uuid.NewString(),
		Email:        email,
		Name:         name,
		PasswordHash: hash,
		Role:         role,
		CreatedAt:    now,
	}
	if err := h.svc.Store.CreateUser(user); err != nil {
		return nil, nil, nil, http.StatusConflict, "email already exists"
	}

	wsSlug := "ws-" + shortID
	wsName := user.Name + "'s Workspace"
	if isFirst {
		wsSlug = "default"
		wsName = "Default Workspace"
	}
	ws := &db.Workspace{
		ID:        uuid.NewString(),
		Name:      wsName,
		Slug:      wsSlug,
		OwnerID:   user.ID,
		CreatedAt: now,
	}
	if err := h.svc.Store.CreateWorkspace(ws); err != nil {
		return nil, nil, nil, http.StatusInternalServerError, err.Error()
	}

	projSlug := toSlug(projectName) + "-" + shortID
	if isFirst {
		projSlug = toSlug(projectName)
	}
	proj := &db.Project{
		ID:          uuid.NewString(),
		WorkspaceID: ws.ID,
		Name:        projectName,
		Slug:        projSlug,
		CreatedAt:   now,
	}
	if err := h.svc.Store.CreateProject(proj); err != nil {
		return nil, nil, nil, http.StatusInternalServerError, err.Error()
	}

	bucketName := "serevox-" + shortID
	if isFirst {
		if _, err := h.svc.Store.GetBucketByName("serevox-public"); errors.Is(err, db.ErrNotFound) {
			bucketName = "serevox-public"
		}
	}
	b := &db.Bucket{
		ID:               uuid.NewString(),
		ProjectID:        proj.ID,
		Name:             bucketName,
		Visibility:       "public",
		AllowedMimeTypes: []string{},
		CORSRules: []db.CORSRule{{
			AllowedOrigins: []string{"*"},
			AllowedMethods: []string{"GET", "HEAD", "PUT", "POST", "DELETE"},
			AllowedHeaders: []string{"*"},
			MaxAgeSeconds:  3600,
		}},
		CreatedAt: now,
		UpdatedAt: now,
	}
	_ = h.svc.Store.CreateBucket(b)

	srvPlain, srvPrefix, srvHash, _ := auth.GenerateRESTKey("service_role")
	srvCt, _ := h.auth.EncryptSecret(srvPlain)
	_ = h.svc.Store.CreateAPIKey(&db.APIKey{
		ID:               uuid.NewString(),
		ProjectID:        proj.ID,
		Name:             "Default Service Role Key",
		KeyType:          "service_role",
		KeyPrefix:        srvPrefix,
		KeyHash:          srvHash,
		SecretCiphertext: srvCt,
		Permission:       "admin",
		CreatedAt:        now,
	})

	ak, sk, _ := auth.GenerateS3KeyPair()
	ct, _ := h.auth.EncryptSecret(sk)
	_ = h.svc.Store.CreateAPIKey(&db.APIKey{
		ID:               uuid.NewString(),
		ProjectID:        proj.ID,
		Name:             "Default S3 Access Key",
		KeyType:          "s3",
		KeyPrefix:        ak,
		AccessKeyID:      ak,
		SecretCiphertext: ct,
		Permission:       "read_write",
		CreatedAt:        now,
	})

	creds := map[string]any{
		"service_role_key": srvPlain,
		"s3_access_key_id": ak,
		"s3_secret_key":    sk,
		"s3_endpoint":      h.svc.Cfg.PublicURL,
		"starter_bucket":   b.Name,
	}
	return user, proj, creds, 0, ""
}

func (h *Handler) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	u, err := h.svc.Store.GetUserByEmail(body.Email)
	if err != nil || !h.auth.VerifyPassword(u.PasswordHash, body.Password) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid email or password"})
		return
	}
	tok, err := h.auth.IssueConsoleToken(u.ID, u.Email, u.Role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": tok, "user": u})
}

func (h *Handler) handleMe(w http.ResponseWriter, claims *auth.ConsoleClaims) {
	u, err := h.svc.Store.GetUserByID(claims.UserID)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "user not found"})
		return
	}
	wss, _ := h.svc.Store.ListWorkspacesByOwner(u.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":       u,
		"workspaces": wss,
		"public_url": h.svc.Cfg.PublicURL,
	})
}

func (h *Handler) handleListProjects(w http.ResponseWriter, claims *auth.ConsoleClaims) {
	list, err := h.svc.Store.ListProjectsByUser(claims.UserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if list == nil {
		list = []db.Project{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": list})
}

func (h *Handler) handleCreateProject(w http.ResponseWriter, r *http.Request, claims *auth.ConsoleClaims) {
	var body struct {
		Name              string `json:"name"`
		StorageQuotaBytes int64  `json:"storage_quota_bytes"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "project name is required"})
		return
	}
	wss, err := h.svc.Store.ListWorkspacesByOwner(claims.UserID)
	if err != nil || len(wss) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "workspace not found"})
		return
	}
	proj := &db.Project{
		ID:                uuid.NewString(),
		WorkspaceID:       wss[0].ID,
		Name:              strings.TrimSpace(body.Name),
		Slug:              toSlug(body.Name) + "-" + uuid.NewString()[:4],
		StorageQuotaBytes: body.StorageQuotaBytes,
		CreatedAt:         time.Now().UTC(),
	}
	if err := h.svc.Store.CreateProject(proj); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"project": proj})
}

func (h *Handler) routeProjectSubpaths(w http.ResponseWriter, r *http.Request, claims *auth.ConsoleClaims, rest string) {
	parts := strings.Split(rest, "/")
	projectID := parts[0]
	owns, err := h.svc.Store.UserOwnsProject(claims.UserID, projectID)
	if err != nil || !owns {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "project not found"})
		return
	}

	if len(parts) == 1 && r.Method == http.MethodPatch {
		h.handleUpdateProject(w, r, projectID)
		return
	}
	if len(parts) == 1 && r.Method == http.MethodDelete {
		if err := h.svc.Store.DeleteProject(projectID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
		return
	}
	if len(parts) < 2 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		return
	}

	switch parts[1] {
	case "metrics":
		m, err := h.svc.Store.GetProjectMetrics(projectID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"metrics": m})
		return
	case "buckets":
		if r.Method == http.MethodGet {
			buckets, err := h.svc.Store.ListBucketsByProject(projectID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
				return
			}
			if buckets == nil {
				buckets = []db.Bucket{}
			}
			writeJSON(w, http.StatusOK, map[string]any{"buckets": buckets})
			return
		}
		if r.Method == http.MethodPost {
			h.handleCreateBucket(w, r, projectID)
			return
		}
	case "keys":
		if r.Method == http.MethodGet && len(parts) == 4 && parts[3] == "reveal" {
			h.handleRevealKey(w, projectID, parts[2])
			return
		}
		if r.Method == http.MethodGet && len(parts) == 2 {
			keys, err := h.svc.Store.ListAPIKeysByProject(projectID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
				return
			}
			if keys == nil {
				keys = []db.APIKey{}
			}
			writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
			return
		}
		if r.Method == http.MethodPost && len(parts) == 2 {
			h.handleCreateKey(w, r, projectID)
			return
		}
		if r.Method == http.MethodDelete && len(parts) == 3 {
			if err := h.svc.Store.RevokeAPIKey(parts[2], projectID); err != nil {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": "key not found"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"revoked": true})
			return
		}
	case "audit-logs":
		if r.Method == http.MethodGet {
			logs, err := h.svc.Store.ListAuditLogs(projectID, 50)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
				return
			}
			if logs == nil {
				logs = []db.AuditLog{}
			}
			writeJSON(w, http.StatusOK, map[string]any{"audit_logs": logs})
			return
		}
	case "webhooks":
		if r.Method == http.MethodGet {
			whs, err := h.svc.Store.ListWebhooksByProject(projectID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
				return
			}
			if whs == nil {
				whs = []db.Webhook{}
			}
			writeJSON(w, http.StatusOK, map[string]any{"webhooks": whs})
			return
		}
		if r.Method == http.MethodPost && len(parts) == 2 {
			h.handleCreateWebhook(w, r, projectID)
			return
		}
		if r.Method == http.MethodPost && len(parts) == 4 && parts[3] == "test" {
			h.handleTestWebhook(w, projectID, parts[2])
			return
		}
		if r.Method == http.MethodGet && len(parts) == 4 && parts[3] == "reveal" {
			h.handleRevealKey(w, projectID, parts[2])
			return
		}
		if r.Method == http.MethodDelete && len(parts) == 3 {
			if err := h.svc.Store.DeleteWebhook(parts[2], projectID); err != nil {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": "webhook not found"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
}

func (h *Handler) handleCreateBucket(w http.ResponseWriter, r *http.Request, projectID string) {
	var body struct {
		Name             string        `json:"name"`
		Visibility       string        `json:"visibility"`
		MaxFileSize      int64         `json:"max_file_size"`
		AllowedMimeTypes []string      `json:"allowed_mime_types"`
		CORSRules        []db.CORSRule `json:"cors_rules"`
		LifecycleDays    int           `json:"lifecycle_days"`
		CustomDomain     string        `json:"custom_domain"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 128*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	name := strings.TrimSpace(strings.ToLower(body.Name))
	if err := core.ValidateBucketName(name); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	vis := "private"
	if body.Visibility == "public" {
		vis = "public"
	}
	if body.AllowedMimeTypes == nil {
		body.AllowedMimeTypes = []string{}
	}
	if body.CORSRules == nil {
		body.CORSRules = []db.CORSRule{{
			AllowedOrigins: []string{"*"},
			AllowedMethods: []string{"GET", "HEAD", "PUT", "POST", "DELETE"},
			AllowedHeaders: []string{"*"},
			MaxAgeSeconds:  3600,
		}}
	}
	now := time.Now().UTC()
	b := &db.Bucket{
		ID:               uuid.NewString(),
		ProjectID:        projectID,
		Name:             name,
		Visibility:       vis,
		MaxFileSize:      body.MaxFileSize,
		AllowedMimeTypes: body.AllowedMimeTypes,
		CORSRules:        body.CORSRules,
		LifecycleDays:    body.LifecycleDays,
		CustomDomain:     strings.TrimSpace(body.CustomDomain),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := h.svc.Store.CreateBucket(b); err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "bucket name already exists"})
		return
	}
	_ = h.svc.Store.RecordAuditLog(&db.AuditLog{
		ID:         uuid.NewString(),
		ProjectID:  projectID,
		ActorEmail: "console_user",
		Action:     "bucket.create",
		Target:     b.Name,
		Details:    fmt.Sprintf("Created bucket %s (%s)", b.Name, b.Visibility),
		IPAddress:  r.RemoteAddr,
		CreatedAt:  now,
	})
	h.svc.Webhooks.Emit(projectID, "bucket.created", map[string]any{"bucket": b.Name})
	writeJSON(w, http.StatusCreated, map[string]any{"bucket": b})
}

func (h *Handler) handleCreateKey(w http.ResponseWriter, r *http.Request, projectID string) {
	var body struct {
		Name       string `json:"name"`
		KeyType    string `json:"key_type"` // "s3", "anon", "service_role"
		BucketID   string `json:"bucket_id"`
		Permission string `json:"permission"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "key name is required"})
		return
	}
	perm := body.Permission
	if perm == "" {
		perm = "read_write"
	}

	now := time.Now().UTC()
	if body.KeyType == "s3" {
		ak, sk, err := auth.GenerateS3KeyPair()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		ct, err := h.auth.EncryptSecret(sk)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		k := &db.APIKey{
			ID:               uuid.NewString(),
			ProjectID:        projectID,
			Name:             strings.TrimSpace(body.Name),
			KeyType:          "s3",
			KeyPrefix:        ak,
			AccessKeyID:      ak,
			SecretCiphertext: ct,
			BucketID:         body.BucketID,
			Permission:       perm,
			CreatedAt:        now,
		}
		if err := h.svc.Store.CreateAPIKey(k); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"key":               k,
			"access_key_id":     ak,
			"secret_access_key": sk,
		})
		return
	}

	if body.KeyType != "anon" {
		body.KeyType = "service_role"
		if body.Permission == "" {
			perm = "admin"
		}
	} else {
		perm = "read_only"
	}
	plain, prefix, hash, err := auth.GenerateRESTKey(body.KeyType)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	ct, err := h.auth.EncryptSecret(plain)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	k := &db.APIKey{
		ID:               uuid.NewString(),
		ProjectID:        projectID,
		Name:             strings.TrimSpace(body.Name),
		KeyType:          body.KeyType,
		KeyPrefix:        prefix,
		KeyHash:          hash,
		SecretCiphertext: ct,
		BucketID:         body.BucketID,
		Permission:       perm,
		CreatedAt:        now,
	}
	if err := h.svc.Store.CreateAPIKey(k); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"key":       k,
		"plain_key": plain,
	})
}

func (h *Handler) handleRevealKey(w http.ResponseWriter, projectID, keyID string) {
	k, err := h.svc.Store.GetAPIKeyByID(keyID, projectID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "API key not found"})
		return
	}
	if k.SecretCiphertext == "" {
		// Fallback for keys generated before full encryption (return visible prefix)
		if k.KeyType == "s3" {
			writeJSON(w, http.StatusOK, map[string]any{
				"key_type":          "s3",
				"access_key_id":     k.AccessKeyID,
				"secret_access_key": "(Key hash only — secret unavailable)",
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"key_type":  k.KeyType,
			"plain_key": k.KeyPrefix,
		})
		return
	}
	secret, err := h.auth.DecryptSecret(k.SecretCiphertext)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to decrypt key"})
		return
	}
	if k.KeyType == "s3" {
		writeJSON(w, http.StatusOK, map[string]any{
			"key_type":          "s3",
			"access_key_id":     k.AccessKeyID,
			"secret_access_key": secret,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"key_type":  k.KeyType,
		"plain_key": secret,
	})
}

func (h *Handler) handleCreateWebhook(w http.ResponseWriter, r *http.Request, projectID string) {
	var body struct {
		URL    string   `json:"url"`
		Events []string `json:"events"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	if err := webhook.ValidateWebhookURL(body.URL); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if len(body.Events) == 0 {
		body.Events = []string{"object.uploaded", "object.deleted"}
	}
	secRaw := make([]byte, 20)
	_, _ = rand.Read(secRaw)
	wh := &db.Webhook{
		ID:        uuid.NewString(),
		ProjectID: projectID,
		URL:       strings.TrimSpace(body.URL),
		Secret:    "whsec_" + hex.EncodeToString(secRaw),
		Events:    body.Events,
		Active:    true,
		CreatedAt: time.Now().UTC(),
	}
	if err := h.svc.Store.CreateWebhook(wh); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"webhook": wh})
}

func (h *Handler) handleTestWebhook(w http.ResponseWriter, projectID, webhookID string) {
	hooks, err := h.svc.Store.ListWebhooksByProject(projectID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	for _, wh := range hooks {
		if wh.ID == webhookID {
			del, err := h.svc.Webhooks.DeliverSync(wh, "serevox.ping", map[string]any{
				"message": "Serevox blade-scale webhook test ping",
			})
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"delivery": del})
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "webhook not found"})
}

func (h *Handler) routeBucketSubpaths(w http.ResponseWriter, r *http.Request, claims *auth.ConsoleClaims, rest string) {
	parts := strings.Split(rest, "/")
	bucketID := parts[0]
	owns, err := h.svc.Store.UserOwnsBucket(claims.UserID, bucketID)
	if err != nil || !owns {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "bucket not found"})
		return
	}
	bucket, err := h.svc.Store.GetBucketByID(bucketID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "bucket not found"})
		return
	}

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodPatch:
			h.handleUpdateBucket(w, r, bucket)
			return
		case http.MethodDelete:
			paths, _ := h.svc.Store.ListStoragePathsByBucket(bucket.ID)
			if err := h.svc.Store.DeleteBucket(bucket.ID); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
				return
			}
			for _, p := range paths {
				_ = h.svc.Storage.DeleteBlob(p)
			}
			h.svc.Webhooks.Emit(bucket.ProjectID, "bucket.deleted", map[string]any{"bucket": bucket.Name})
			writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
			return
		}
	}

	if len(parts) >= 2 && parts[1] == "objects" {
		if len(parts) == 2 && r.Method == http.MethodGet {
			prefix := r.URL.Query().Get("prefix")
			delimiter := r.URL.Query().Get("delimiter")
			res, err := h.svc.ListObjectsWithDelimiter(bucket.ID, prefix, delimiter, "", 1000)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, res)
			return
		}
		if len(parts) == 2 && r.Method == http.MethodDelete {
			key := r.URL.Query().Get("key")
			if key != "" {
				if err := h.svc.DeleteObject(bucket, key); err != nil {
					writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
					return
				}
				writeJSON(w, http.StatusOK, map[string]any{"deleted": key})
				return
			}
			// Batch delete via JSON body {"keys": ["a", "b"]}
			var bBody struct {
				Keys []string `json:"keys"`
			}
			_ = json.NewDecoder(io.LimitReader(r.Body, 128*1024)).Decode(&bBody)
			deleted := make([]string, 0, len(bBody.Keys))
			for _, k := range bBody.Keys {
				if err := h.svc.DeleteObject(bucket, k); err == nil {
					deleted = append(deleted, k)
				}
			}
			writeJSON(w, http.StatusOK, map[string]any{"deleted_count": len(deleted), "keys": deleted})
			return
		}
		if len(parts) == 3 && parts[2] == "upload" && r.Method == http.MethodPost {
			h.handleConsoleUpload(w, r, bucket)
			return
		}
		if len(parts) == 3 && parts[2] == "preview" && r.Method == http.MethodGet {
			key := r.URL.Query().Get("key")
			cleanKey, err := storage.SanitizeKey(key)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
				return
			}
			obj, err := h.svc.Store.GetObject(bucket.ID, cleanKey)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": "object not found"})
				return
			}
			f, err := h.svc.Storage.OpenBlob(obj.StoragePath)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": "blob missing"})
				return
			}
			defer f.Close()
			h.svc.ServeBlob(w, r, bucket, obj, f, obj.MimeType, obj.ETag)
			return
		}
		if len(parts) == 3 && parts[2] == "sign" && r.Method == http.MethodPost {
			var body struct {
				Key       string `json:"key"`
				ExpiresIn int    `json:"expires_in"`
			}
			_ = json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&body)
			cleanKey, err := storage.SanitizeKey(body.Key)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
				return
			}
			ttl := time.Hour
			if body.ExpiresIn > 0 {
				ttl = time.Duration(body.ExpiresIn) * time.Second
			}
			tok, err := h.auth.IssueSignedObjectToken(bucket.ID, bucket.Name, cleanKey, "download", false, ttl)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"signed_url": fmt.Sprintf("%s/v1/authenticated/%s/%s?token=%s", h.svc.Cfg.PublicURL, url.PathEscape(bucket.Name), cleanKey, url.QueryEscape(tok)),
			})
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
}

func (h *Handler) handleUpdateProject(w http.ResponseWriter, r *http.Request, projectID string) {
	proj, err := h.svc.Store.GetProjectByID(projectID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "project not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	var body struct {
		Name              *string `json:"name"`
		StorageQuotaBytes *int64  `json:"storage_quota_bytes"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	if body.Name != nil {
		trimmed := strings.TrimSpace(*body.Name)
		if len(trimmed) < 2 || len(trimmed) > 80 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "project name must be 2..80 characters"})
			return
		}
		proj.Name = trimmed
		proj.Slug = toSlug(trimmed) + "-" + uuid.NewString()[:4]
	}
	if body.StorageQuotaBytes != nil && *body.StorageQuotaBytes >= 0 {
		proj.StorageQuotaBytes = *body.StorageQuotaBytes
	}
	if err := h.svc.Store.UpdateProject(proj); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": proj})
}

func (h *Handler) handleUpdateBucket(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	var body struct {
		Name             *string       `json:"name"`
		Visibility       *string       `json:"visibility"`
		MaxFileSize      *int64        `json:"max_file_size"`
		AllowedMimeTypes *[]string     `json:"allowed_mime_types"`
		CORSRules        *[]db.CORSRule `json:"cors_rules"`
		LifecycleDays    *int          `json:"lifecycle_days"`
		CustomDomain     *string       `json:"custom_domain"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 128*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	if body.Name != nil {
		newName := strings.TrimSpace(strings.ToLower(*body.Name))
		if err := core.ValidateBucketName(newName); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		if newName != bucket.Name {
			if existing, err := h.svc.Store.GetBucketByName(newName); err == nil && existing.ID != bucket.ID {
				writeJSON(w, http.StatusConflict, map[string]any{"error": "bucket name already exists"})
				return
			}
			bucket.Name = newName
		}
	}
	if body.Visibility != nil && (*body.Visibility == "public" || *body.Visibility == "private") {
		bucket.Visibility = *body.Visibility
	}
	if body.MaxFileSize != nil {
		bucket.MaxFileSize = *body.MaxFileSize
	}
	if body.AllowedMimeTypes != nil {
		bucket.AllowedMimeTypes = *body.AllowedMimeTypes
	}
	if body.CORSRules != nil {
		bucket.CORSRules = *body.CORSRules
	}
	if body.LifecycleDays != nil {
		bucket.LifecycleDays = *body.LifecycleDays
	}
	if body.CustomDomain != nil {
		bucket.CustomDomain = strings.TrimSpace(*body.CustomDomain)
	}
	if err := h.svc.Store.UpdateBucket(bucket); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"bucket": bucket})
}

func (h *Handler) handleConsoleUpload(w http.ResponseWriter, r *http.Request, bucket *db.Bucket) {
	mr, err := r.MultipartReader()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "multipart/form-data required"})
		return
	}
	prefix := strings.Trim(r.URL.Query().Get("prefix"), "/")
	var uploaded []db.Object
	customKey := ""
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		if part.FormName() == "key" || part.FormName() == "path" {
			b, _ := io.ReadAll(io.LimitReader(part, 4096))
			customKey = string(b)
			_ = part.Close()
			continue
		}
		if part.FormName() == "file" {
			key := customKey
			if key == "" {
				key = part.FileName()
				if prefix != "" {
					key = prefix + "/" + key
				}
			}
			customKey = ""
			obj, err := h.svc.PutObject(bucket, key, part, part.Header.Get("Content-Type"), nil, true)
			_ = part.Close()
			if err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, storage.ErrTooLarge) {
					status = http.StatusRequestEntityTooLarge
				}
				writeJSON(w, status, map[string]any{"error": err.Error()})
				return
			}
			uploaded = append(uploaded, *obj)
			continue
		}
		_ = part.Close()
	}
	writeJSON(w, http.StatusOK, map[string]any{"uploaded": uploaded})
}

func (h *Handler) requireAdmin(w http.ResponseWriter, claims *auth.ConsoleClaims) (*db.User, bool) {
	u, err := h.svc.Store.GetUserByID(claims.UserID)
	if err != nil || u.Role != "admin" {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin access required"})
		return nil, false
	}
	return u, true
}

func (h *Handler) routeAdmin(w http.ResponseWriter, r *http.Request, claims *auth.ConsoleClaims, sub string) {
	adminUser, ok := h.requireAdmin(w, claims)
	if !ok {
		return
	}

	switch {
	case sub == "/overview" && r.Method == http.MethodGet:
		h.handleAdminOverview(w)
	case sub == "/users" && r.Method == http.MethodPost:
		h.handleAdminCreateUser(w, r)
	case strings.HasPrefix(sub, "/users/") && strings.HasSuffix(sub, "/role") && r.Method == http.MethodPatch:
		targetID := strings.TrimSuffix(strings.TrimPrefix(sub, "/users/"), "/role")
		h.handleAdminUpdateUserRole(w, r, adminUser.ID, targetID)
	case strings.HasPrefix(sub, "/users/") && !strings.Contains(strings.TrimPrefix(sub, "/users/"), "/") && r.Method == http.MethodDelete:
		targetID := strings.TrimPrefix(sub, "/users/")
		h.handleAdminDeleteUser(w, adminUser.ID, targetID)
	case strings.HasPrefix(sub, "/projects/") && !strings.Contains(strings.TrimPrefix(sub, "/projects/"), "/") && r.Method == http.MethodPatch:
		projID := strings.TrimPrefix(sub, "/projects/")
		h.handleUpdateProject(w, r, projID)
	case strings.HasPrefix(sub, "/projects/") && !strings.Contains(strings.TrimPrefix(sub, "/projects/"), "/") && r.Method == http.MethodDelete:
		projID := strings.TrimPrefix(sub, "/projects/")
		if err := h.svc.Store.DeleteProject(projID); err != nil {
			if errors.Is(err, db.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": "project not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	case strings.HasPrefix(sub, "/buckets/") && !strings.Contains(strings.TrimPrefix(sub, "/buckets/"), "/") && r.Method == http.MethodPatch:
		bucketID := strings.TrimPrefix(sub, "/buckets/")
		b, err := h.svc.Store.GetBucketByID(bucketID)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "bucket not found"})
			return
		}
		h.handleUpdateBucket(w, r, b)
	case strings.HasPrefix(sub, "/buckets/") && !strings.Contains(strings.TrimPrefix(sub, "/buckets/"), "/") && r.Method == http.MethodDelete:
		bucketID := strings.TrimPrefix(sub, "/buckets/")
		if err := h.svc.Store.DeleteBucket(bucketID); err != nil {
			if errors.Is(err, db.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": "bucket not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	default:
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "admin route not found"})
	}
}

func (h *Handler) handleAdminOverview(w http.ResponseWriter) {
	stats, err := h.svc.Store.GetPlatformStats()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	users, err := h.svc.Store.ListAllUsersAdmin()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if users == nil {
		users = []db.AdminUserSummary{}
	}
	buckets, err := h.svc.Store.ListAllBucketsAdmin()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if buckets == nil {
		buckets = []db.AdminBucketSummary{}
	}
	projects, err := h.svc.Store.ListAllProjectsAdmin()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if projects == nil {
		projects = []db.AdminProjectSummary{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"stats":    stats,
		"users":    users,
		"projects": projects,
		"buckets":  buckets,
	})
}

func (h *Handler) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email       string `json:"email"`
		Name        string `json:"name"`
		Password    string `json:"password"`
		ProjectName string `json:"project_name"`
		Role        string `json:"role"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	role := "member"
	if body.Role == "admin" {
		role = "admin"
	}
	user, proj, _, errStatus, errMsg := h.provisionUserAccount(body.Email, body.Name, body.Password, body.ProjectName, role, false)
	if errMsg != "" {
		writeJSON(w, errStatus, map[string]any{"error": errMsg})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"user":    user,
		"project": proj,
	})
}

func (h *Handler) handleAdminUpdateUserRole(w http.ResponseWriter, r *http.Request, actorID, targetID string) {
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	if body.Role != "admin" && body.Role != "member" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "role must be 'admin' or 'member'"})
		return
	}
	if targetID == actorID && body.Role != "admin" {
		admins, err := h.svc.Store.CountAdmins()
		if err == nil && admins <= 1 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cannot demote the last remaining admin"})
			return
		}
	}
	if err := h.svc.Store.UpdateUserRole(targetID, body.Role); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "user not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": true, "role": body.Role})
}

func (h *Handler) handleAdminDeleteUser(w http.ResponseWriter, actorID, targetID string) {
	if targetID == actorID {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cannot delete your own admin account"})
		return
	}
	if err := h.svc.Store.DeleteUser(targetID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "user not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (h *Handler) handleMidtransConfig(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]any{
		"client_key": h.svc.Cfg.MidtransClientKey,
		"is_prod":    h.svc.Cfg.MidtransIsProd,
		"snap_url": func() string {
			if h.svc.Cfg.MidtransIsProd {
				return "https://app.midtrans.com/snap/snap.js"
			}
			return "https://app.sandbox.midtrans.com/snap/snap.js"
		}(),
	})
}

func (h *Handler) handleMidtransSnapToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PlanID      string `json:"plan_id"`
		GrossAmount int64  `json:"gross_amount"`
		CustomerName  string `json:"customer_name"`
		CustomerEmail string `json:"customer_email"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}

	orderID := fmt.Sprintf("SRX-%s-%d", strings.ToUpper(body.PlanID), time.Now().Unix())
	if body.GrossAmount <= 0 {
		switch body.PlanID {
		case "edge":
			body.GrossAmount = 149000 // Rp 149.000 / month
		case "enterprise":
			body.GrossAmount = 799000 // Rp 799.000 / month
		default:
			body.GrossAmount = 99000  // Rp 99.000 starter
		}
	}

	snapEndpoint := "https://app.sandbox.midtrans.com/snap/v1/transactions"
	if h.svc.Cfg.MidtransIsProd {
		snapEndpoint = "https://app.midtrans.com/snap/v1/transactions"
	}

	payload := map[string]any{
		"transaction_details": map[string]any{
			"order_id":     orderID,
			"gross_amount": body.GrossAmount,
		},
		"item_details": []map[string]any{
			{
				"id":       body.PlanID,
				"price":    body.GrossAmount,
				"quantity": 1,
				"name":     fmt.Sprintf("Serevox Cloud %s Plan", strings.Title(body.PlanID)),
			},
		},
		"customer_details": map[string]any{
			"first_name": body.CustomerName,
			"email":      body.CustomerEmail,
		},
	}

	b, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, snapEndpoint, strings.NewReader(string(b)))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.SetBasicAuth(h.svc.Cfg.MidtransServerKey, "")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("Midtrans request failed: %v", err)})
		return
	}
	defer resp.Body.Close()

	var snapRes map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&snapRes)

	writeJSON(w, resp.StatusCode, snapRes)
}

func toSlug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "project"
	}
	return s
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

