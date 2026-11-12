package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrNotFound = errors.New("not found")

// --- Users, Workspaces, Projects ---

func (s *Store) CountUsers() (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

func (s *Store) CreateUser(u *User) error {
	_, err := s.db.Exec(
		`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		u.ID, strings.ToLower(strings.TrimSpace(u.Email)), u.Name, u.PasswordHash, u.Role, u.CreatedAt.UTC(),
	)
	return err
}

func (s *Store) GetUserByEmail(email string) (*User, error) {
	row := s.db.QueryRow(
		`SELECT id, email, name, password_hash, role, created_at FROM users WHERE email = ?`,
		strings.ToLower(strings.TrimSpace(email)),
	)
	var u User
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Role, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (s *Store) GetUserByID(id string) (*User, error) {
	row := s.db.QueryRow(`SELECT id, email, name, password_hash, role, created_at FROM users WHERE id = ?`, id)
	var u User
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Role, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (s *Store) CreateWorkspace(w *Workspace) error {
	_, err := s.db.Exec(
		`INSERT INTO workspaces (id, name, slug, owner_id, created_at) VALUES (?, ?, ?, ?, ?)`,
		w.ID, w.Name, w.Slug, w.OwnerID, w.CreatedAt.UTC(),
	)
	return err
}

func (s *Store) ListWorkspacesByOwner(ownerID string) ([]Workspace, error) {
	rows, err := s.db.Query(`SELECT id, name, slug, owner_id, created_at FROM workspaces WHERE owner_id = ? ORDER BY created_at ASC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Workspace
	for rows.Next() {
		var w Workspace
		if err := rows.Scan(&w.ID, &w.Name, &w.Slug, &w.OwnerID, &w.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, w)
	}
	return list, rows.Err()
}

func (s *Store) CreateProject(p *Project) error {
	_, err := s.db.Exec(
		`INSERT INTO projects (id, workspace_id, name, slug, storage_quota_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		p.ID, p.WorkspaceID, p.Name, p.Slug, p.StorageQuotaBytes, p.CreatedAt.UTC(),
	)
	return err
}

func (s *Store) ListProjectsByUser(ownerID string) ([]Project, error) {
	rows, err := s.db.Query(
		`SELECT p.id, p.workspace_id, p.name, p.slug, p.storage_quota_bytes, p.created_at
		 FROM projects p
		 JOIN workspaces w ON w.id = p.workspace_id
		 WHERE w.owner_id = ?
		 ORDER BY p.created_at ASC`, ownerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.WorkspaceID, &p.Name, &p.Slug, &p.StorageQuotaBytes, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) UserOwnsProject(ownerID, projectID string) (bool, error) {
	var cnt int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = ? AND w.owner_id = ?`,
		projectID, ownerID,
	).Scan(&cnt)
	return cnt > 0, err
}

func (s *Store) UserOwnsBucket(ownerID, bucketID string) (bool, error) {
	var cnt int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM buckets b
		 JOIN projects p ON p.id = b.project_id
		 JOIN workspaces w ON w.id = p.workspace_id
		 WHERE b.id = ? AND w.owner_id = ?`,
		bucketID, ownerID,
	).Scan(&cnt)
	return cnt > 0, err
}

func (s *Store) GetProjectByID(id string) (*Project, error) {
	row := s.db.QueryRow(`SELECT id, workspace_id, name, slug, storage_quota_bytes, created_at FROM projects WHERE id = ?`, id)
	var p Project
	if err := row.Scan(&p.ID, &p.WorkspaceID, &p.Name, &p.Slug, &p.StorageQuotaBytes, &p.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

func (s *Store) UpdateProject(p *Project) error {
	res, err := s.db.Exec(
		`UPDATE projects SET name = ?, slug = ?, storage_quota_bytes = ? WHERE id = ?`,
		p.Name, p.Slug, p.StorageQuotaBytes, p.ID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteProject(id string) error {
	res, err := s.db.Exec(`DELETE FROM projects WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Buckets ---

func (s *Store) CreateBucket(b *Bucket) error {
	mimesJSON, _ := json.Marshal(b.AllowedMimeTypes)
	corsJSON, _ := json.Marshal(b.CORSRules)
	_, err := s.db.Exec(
		`INSERT INTO buckets (id, project_id, name, visibility, max_file_size, allowed_mime_types_json, cors_rules_json, lifecycle_days, custom_domain, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		b.ID, b.ProjectID, b.Name, b.Visibility, b.MaxFileSize, string(mimesJSON), string(corsJSON), b.LifecycleDays, b.CustomDomain, b.CreatedAt.UTC(), b.UpdatedAt.UTC(),
	)
	return err
}

func (s *Store) UpdateBucket(b *Bucket) error {
	mimesJSON, _ := json.Marshal(b.AllowedMimeTypes)
	corsJSON, _ := json.Marshal(b.CORSRules)
	b.UpdatedAt = time.Now().UTC()
	res, err := s.db.Exec(
		`UPDATE buckets SET name = ?, visibility = ?, max_file_size = ?, allowed_mime_types_json = ?, cors_rules_json = ?, lifecycle_days = ?, custom_domain = ?, updated_at = ?
		 WHERE id = ?`,
		b.Name, b.Visibility, b.MaxFileSize, string(mimesJSON), string(corsJSON), b.LifecycleDays, b.CustomDomain, b.UpdatedAt, b.ID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) scanBucket(scanner interface{ Scan(dest ...any) error }) (*Bucket, error) {
	var b Bucket
	var mimesRaw, corsRaw string
	if err := scanner.Scan(&b.ID, &b.ProjectID, &b.Name, &b.Visibility, &b.MaxFileSize, &mimesRaw, &corsRaw, &b.LifecycleDays, &b.CustomDomain, &b.CreatedAt, &b.UpdatedAt); err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(mimesRaw), &b.AllowedMimeTypes)
	_ = json.Unmarshal([]byte(corsRaw), &b.CORSRules)
	if b.AllowedMimeTypes == nil {
		b.AllowedMimeTypes = []string{}
	}
	if b.CORSRules == nil {
		b.CORSRules = []CORSRule{}
	}
	return &b, nil
}

func (s *Store) GetBucketByName(name string) (*Bucket, error) {
	row := s.db.QueryRow(
		`SELECT id, project_id, name, visibility, max_file_size, allowed_mime_types_json, cors_rules_json, lifecycle_days, custom_domain, created_at, updated_at
		 FROM buckets WHERE name = ?`, name,
	)
	b, err := s.scanBucket(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return b, err
}

func (s *Store) GetBucketByID(id string) (*Bucket, error) {
	row := s.db.QueryRow(
		`SELECT id, project_id, name, visibility, max_file_size, allowed_mime_types_json, cors_rules_json, lifecycle_days, custom_domain, created_at, updated_at
		 FROM buckets WHERE id = ?`, id,
	)
	b, err := s.scanBucket(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return b, err
}

func (s *Store) ListBucketsByProject(projectID string) ([]Bucket, error) {
	rows, err := s.db.Query(
		`SELECT b.id, b.project_id, b.name, b.visibility, b.max_file_size, b.allowed_mime_types_json, b.cors_rules_json,
		        b.lifecycle_days, b.custom_domain, b.created_at, b.updated_at,
		        COUNT(o.id) AS obj_count, COALESCE(SUM(o.size_bytes), 0) AS total_bytes
		 FROM buckets b
		 LEFT JOIN objects o ON o.bucket_id = b.id
		 WHERE b.project_id = ?
		 GROUP BY b.id
		 ORDER BY b.created_at ASC`, projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Bucket
	for rows.Next() {
		var b Bucket
		var mimesRaw, corsRaw string
		if err := rows.Scan(
			&b.ID, &b.ProjectID, &b.Name, &b.Visibility, &b.MaxFileSize, &mimesRaw, &corsRaw,
			&b.LifecycleDays, &b.CustomDomain, &b.CreatedAt, &b.UpdatedAt, &b.ObjectCount, &b.TotalBytes,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(mimesRaw), &b.AllowedMimeTypes)
		_ = json.Unmarshal([]byte(corsRaw), &b.CORSRules)
		if b.AllowedMimeTypes == nil {
			b.AllowedMimeTypes = []string{}
		}
		if b.CORSRules == nil {
			b.CORSRules = []CORSRule{}
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) ListAllBucketsWithLifecycle() ([]Bucket, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, name, visibility, max_file_size, allowed_mime_types_json, cors_rules_json, lifecycle_days, custom_domain, created_at, updated_at
		 FROM buckets WHERE lifecycle_days > 0`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Bucket
	for rows.Next() {
		b, err := s.scanBucket(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

func (s *Store) DeleteBucket(id string) error {
	res, err := s.db.Exec(`DELETE FROM buckets WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Objects ---

// UpsertObject inserts or replaces object metadata for (bucket_id, key), returning any replaced storage_path.
func (s *Store) UpsertObject(o *Object) (oldStoragePath string, err error) {
	var existingPath string
	err = s.db.QueryRow(`SELECT storage_path FROM objects WHERE bucket_id = ? AND key = ?`, o.BucketID, o.Key).Scan(&existingPath)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	metaJSON, _ := json.Marshal(o.Metadata)
	if existingPath != "" {
		_, err = s.db.Exec(
			`UPDATE objects SET size_bytes = ?, mime_type = ?, etag = ?, sha256 = ?, storage_path = ?, metadata_json = ?, expires_at = ?, updated_at = ?
			 WHERE bucket_id = ? AND key = ?`,
			o.SizeBytes, o.MimeType, o.ETag, o.SHA256, o.StoragePath, string(metaJSON), o.ExpiresAt, o.UpdatedAt.UTC(), o.BucketID, o.Key,
		)
		return existingPath, err
	}

	_, err = s.db.Exec(
		`INSERT INTO objects (id, bucket_id, key, size_bytes, mime_type, etag, sha256, storage_path, metadata_json, expires_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		o.ID, o.BucketID, o.Key, o.SizeBytes, o.MimeType, o.ETag, o.SHA256, o.StoragePath, string(metaJSON), o.ExpiresAt, o.CreatedAt.UTC(), o.UpdatedAt.UTC(),
	)
	return "", err
}

func (s *Store) GetObject(bucketID, key string) (*Object, error) {
	row := s.db.QueryRow(
		`SELECT id, bucket_id, key, size_bytes, mime_type, etag, sha256, storage_path, metadata_json, expires_at, created_at, updated_at
		 FROM objects WHERE bucket_id = ? AND key = ?`, bucketID, key,
	)
	var o Object
	var metaRaw string
	var expires sql.NullTime
	if err := row.Scan(&o.ID, &o.BucketID, &o.Key, &o.SizeBytes, &o.MimeType, &o.ETag, &o.SHA256, &o.StoragePath, &metaRaw, &expires, &o.CreatedAt, &o.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if expires.Valid {
		t := expires.Time
		o.ExpiresAt = &t
	}
	_ = json.Unmarshal([]byte(metaRaw), &o.Metadata)
	if o.Metadata == nil {
		o.Metadata = map[string]string{}
	}
	return &o, nil
}

type ListObjectsParams struct {
	BucketID   string
	Prefix     string
	StartAfter string
	Limit      int
}

func (s *Store) ListObjects(p ListObjectsParams) ([]Object, error) {
	if p.Limit <= 0 || p.Limit > 1000 {
		p.Limit = 1000
	}
	query := `SELECT id, bucket_id, key, size_bytes, mime_type, etag, sha256, storage_path, metadata_json, expires_at, created_at, updated_at
	          FROM objects WHERE bucket_id = ?`
	args := []any{p.BucketID}
	if p.Prefix != "" {
		query += ` AND key LIKE ? ESCAPE '\'`
		escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(p.Prefix) + "%"
		args = append(args, escaped)
	}
	if p.StartAfter != "" {
		query += ` AND key > ?`
		args = append(args, p.StartAfter)
	}
	query += ` ORDER BY key ASC LIMIT ?`
	args = append(args, p.Limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Object
	for rows.Next() {
		var o Object
		var metaRaw string
		var expires sql.NullTime
		if err := rows.Scan(&o.ID, &o.BucketID, &o.Key, &o.SizeBytes, &o.MimeType, &o.ETag, &o.SHA256, &o.StoragePath, &metaRaw, &expires, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		if expires.Valid {
			t := expires.Time
			o.ExpiresAt = &t
		}
		_ = json.Unmarshal([]byte(metaRaw), &o.Metadata)
		if o.Metadata == nil {
			o.Metadata = map[string]string{}
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Store) DeleteObject(bucketID, key string) (string, error) {
	var storagePath string
	err := s.db.QueryRow(`SELECT storage_path FROM objects WHERE bucket_id = ? AND key = ?`, bucketID, key).Scan(&storagePath)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(`DELETE FROM objects WHERE bucket_id = ? AND key = ?`, bucketID, key)
	return storagePath, err
}

func (s *Store) ListExpiredObjects(now time.Time, limit int) ([]Object, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.Query(
		`SELECT id, bucket_id, key, size_bytes, mime_type, etag, sha256, storage_path, metadata_json, expires_at, created_at, updated_at
		 FROM objects WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT ?`, now.UTC(), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Object
	for rows.Next() {
		var o Object
		var metaRaw string
		var expires sql.NullTime
		if err := rows.Scan(&o.ID, &o.BucketID, &o.Key, &o.SizeBytes, &o.MimeType, &o.ETag, &o.SHA256, &o.StoragePath, &metaRaw, &expires, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Store) ListLifecycleExpiredObjects(bucketID string, cutoff time.Time, limit int) ([]Object, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.Query(
		`SELECT id, bucket_id, key, size_bytes, mime_type, etag, sha256, storage_path, metadata_json, expires_at, created_at, updated_at
		 FROM objects WHERE bucket_id = ? AND updated_at <= ? LIMIT ?`, bucketID, cutoff.UTC(), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Object
	for rows.Next() {
		var o Object
		var metaRaw string
		var expires sql.NullTime
		if err := rows.Scan(&o.ID, &o.BucketID, &o.Key, &o.SizeBytes, &o.MimeType, &o.ETag, &o.SHA256, &o.StoragePath, &metaRaw, &expires, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Store) ListStoragePathsByBucket(bucketID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT storage_path FROM objects WHERE bucket_id = ?`, bucketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		paths = append(paths, p)
	}
	return paths, rows.Err()
}

// --- Multipart Uploads ---

func (s *Store) CreateMultipartUpload(m *MultipartUpload) error {
	metaJSON, _ := json.Marshal(m.Metadata)
	_, err := s.db.Exec(
		`INSERT INTO multipart_uploads (id, bucket_id, object_key, mime_type, metadata_json, status, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.BucketID, m.ObjectKey, m.MimeType, string(metaJSON), m.Status, m.ExpiresAt.UTC(), m.CreatedAt.UTC(),
	)
	return err
}

func (s *Store) GetMultipartUpload(id string) (*MultipartUpload, error) {
	row := s.db.QueryRow(
		`SELECT id, bucket_id, object_key, mime_type, metadata_json, status, expires_at, created_at
		 FROM multipart_uploads WHERE id = ?`, id,
	)
	var m MultipartUpload
	var metaRaw string
	if err := row.Scan(&m.ID, &m.BucketID, &m.ObjectKey, &m.MimeType, &metaRaw, &m.Status, &m.ExpiresAt, &m.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal([]byte(metaRaw), &m.Metadata)
	if m.Metadata == nil {
		m.Metadata = map[string]string{}
	}
	return &m, nil
}

func (s *Store) UpdateMultipartStatus(id, status string) error {
	_, err := s.db.Exec(`UPDATE multipart_uploads SET status = ? WHERE id = ?`, status, id)
	return err
}

func (s *Store) UpsertUploadPart(p *UploadPart) error {
	_, err := s.db.Exec(
		`INSERT INTO upload_parts (id, upload_id, part_number, size_bytes, etag, storage_path, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(upload_id, part_number) DO UPDATE SET
		 size_bytes = excluded.size_bytes, etag = excluded.etag, storage_path = excluded.storage_path, created_at = excluded.created_at`,
		p.ID, p.UploadID, p.PartNumber, p.SizeBytes, p.ETag, p.StoragePath, p.CreatedAt.UTC(),
	)
	return err
}

func (s *Store) ListUploadParts(uploadID string) ([]UploadPart, error) {
	rows, err := s.db.Query(
		`SELECT id, upload_id, part_number, size_bytes, etag, storage_path, created_at
		 FROM upload_parts WHERE upload_id = ? ORDER BY part_number ASC`, uploadID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UploadPart
	for rows.Next() {
		var p UploadPart
		if err := rows.Scan(&p.ID, &p.UploadID, &p.PartNumber, &p.SizeBytes, &p.ETag, &p.StoragePath, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) DeleteUploadParts(uploadID string) error {
	_, err := s.db.Exec(`DELETE FROM upload_parts WHERE upload_id = ?`, uploadID)
	return err
}

// --- API Keys ---

func (s *Store) CreateAPIKey(k *APIKey) error {
	_, err := s.db.Exec(
		`INSERT INTO api_keys (id, project_id, name, key_type, key_prefix, key_hash, access_key_id, secret_ciphertext, bucket_id, permission, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		k.ID, k.ProjectID, k.Name, k.KeyType, k.KeyPrefix, k.KeyHash, k.AccessKeyID, k.SecretCiphertext, k.BucketID, k.Permission, k.CreatedAt.UTC(),
	)
	return err
}

func (s *Store) ListAPIKeysByProject(projectID string) ([]APIKey, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, name, key_type, key_prefix, access_key_id, bucket_id, permission, last_used_at, created_at, revoked_at
		 FROM api_keys WHERE project_id = ? ORDER BY created_at DESC`, projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []APIKey
	for rows.Next() {
		var k APIKey
		var lastUsed, revoked sql.NullTime
		if err := rows.Scan(&k.ID, &k.ProjectID, &k.Name, &k.KeyType, &k.KeyPrefix, &k.AccessKeyID, &k.BucketID, &k.Permission, &lastUsed, &k.CreatedAt, &revoked); err != nil {
			return nil, err
		}
		if lastUsed.Valid {
			t := lastUsed.Time
			k.LastUsedAt = &t
		}
		if revoked.Valid {
			t := revoked.Time
			k.RevokedAt = &t
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *Store) GetAPIKeyByHash(hash string) (*APIKey, error) {
	row := s.db.QueryRow(
		`SELECT id, project_id, name, key_type, key_prefix, key_hash, access_key_id, secret_ciphertext, bucket_id, permission, last_used_at, created_at, revoked_at
		 FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`, hash,
	)
	return s.scanAPIKey(row)
}

func (s *Store) GetAPIKeyByAccessKeyID(akid string) (*APIKey, error) {
	row := s.db.QueryRow(
		`SELECT id, project_id, name, key_type, key_prefix, key_hash, access_key_id, secret_ciphertext, bucket_id, permission, last_used_at, created_at, revoked_at
		 FROM api_keys WHERE access_key_id = ? AND key_type = 's3' AND revoked_at IS NULL`, akid,
	)
	return s.scanAPIKey(row)
}

func (s *Store) GetAPIKeyByID(id, projectID string) (*APIKey, error) {
	row := s.db.QueryRow(
		`SELECT id, project_id, name, key_type, key_prefix, key_hash, access_key_id, secret_ciphertext, bucket_id, permission, last_used_at, created_at, revoked_at
		 FROM api_keys WHERE id = ? AND project_id = ?`, id, projectID,
	)
	return s.scanAPIKey(row)
}

func (s *Store) scanAPIKey(row *sql.Row) (*APIKey, error) {
	var k APIKey
	var lastUsed, revoked sql.NullTime
	if err := row.Scan(
		&k.ID, &k.ProjectID, &k.Name, &k.KeyType, &k.KeyPrefix, &k.KeyHash,
		&k.AccessKeyID, &k.SecretCiphertext, &k.BucketID, &k.Permission,
		&lastUsed, &k.CreatedAt, &revoked,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if lastUsed.Valid {
		t := lastUsed.Time
		k.LastUsedAt = &t
	}
	if revoked.Valid {
		t := revoked.Time
		k.RevokedAt = &t
	}
	return &k, nil
}

func (s *Store) TouchAPIKeyUsed(id string) {
	_, _ = s.db.Exec(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, time.Now().UTC(), id)
}

func (s *Store) RevokeAPIKey(id, projectID string) error {
	now := time.Now().UTC()
	res, err := s.db.Exec(`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND project_id = ?`, now, id, projectID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Webhooks ---

func (s *Store) CreateWebhook(w *Webhook) error {
	eventsJSON, _ := json.Marshal(w.Events)
	activeInt := 0
	if w.Active {
		activeInt = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO webhooks (id, project_id, url, secret, events_json, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		w.ID, w.ProjectID, w.URL, w.Secret, string(eventsJSON), activeInt, w.CreatedAt.UTC(),
	)
	return err
}

func (s *Store) ListWebhooksByProject(projectID string) ([]Webhook, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, url, secret, events_json, active, created_at FROM webhooks WHERE project_id = ? ORDER BY created_at DESC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Webhook
	for rows.Next() {
		var w Webhook
		var eventsRaw string
		var activeInt int
		if err := rows.Scan(&w.ID, &w.ProjectID, &w.URL, &w.Secret, &eventsRaw, &activeInt, &w.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(eventsRaw), &w.Events)
		w.Active = activeInt == 1
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *Store) ListActiveWebhooksByProjectAndEvent(projectID, eventType string) ([]Webhook, error) {
	all, err := s.ListWebhooksByProject(projectID)
	if err != nil {
		return nil, err
	}
	var matched []Webhook
	for _, w := range all {
		if !w.Active {
			continue
		}
		for _, ev := range w.Events {
			if ev == eventType || ev == "*" {
				matched = append(matched, w)
				break
			}
		}
	}
	return matched, nil
}

func (s *Store) DeleteWebhook(id, projectID string) error {
	res, err := s.db.Exec(`DELETE FROM webhooks WHERE id = ? AND project_id = ?`, id, projectID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RecordWebhookDelivery(d *WebhookDelivery) error {
	successInt := 0
	if d.Success {
		successInt = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload_json, status_code, response_body, attempt, success, error_message, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.ID, d.WebhookID, d.EventType, d.PayloadJSON, d.StatusCode, d.ResponseBody, d.Attempt, successInt, d.ErrorMessage, d.CreatedAt.UTC(),
	)
	return err
}

func (s *Store) ListWebhookDeliveries(webhookID string, limit int) ([]WebhookDelivery, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := s.db.Query(
		`SELECT id, webhook_id, event_type, payload_json, status_code, response_body, attempt, success, error_message, created_at
		 FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?`,
		webhookID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WebhookDelivery
	for rows.Next() {
		var d WebhookDelivery
		var successInt int
		if err := rows.Scan(&d.ID, &d.WebhookID, &d.EventType, &d.PayloadJSON, &d.StatusCode, &d.ResponseBody, &d.Attempt, &successInt, &d.ErrorMessage, &d.CreatedAt); err != nil {
			return nil, err
		}
		d.Success = successInt == 1
		out = append(out, d)
	}
	return out, rows.Err()
}

// --- Usage / Metrics ---

func (s *Store) RecordUsage(projectID, bucketID, eventType string, bytes int64) {
	_, _ = s.db.Exec(
		`INSERT INTO usage_events (project_id, bucket_id, event_type, bytes, created_at) VALUES (?, ?, ?, ?, ?)`,
		projectID, bucketID, eventType, bytes, time.Now().UTC(),
	)
}

func (s *Store) GetProjectMetrics(projectID string) (*ProjectMetrics, error) {
	var m ProjectMetrics
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM buckets WHERE project_id = ?`, projectID).Scan(&m.TotalBuckets); err != nil {
		return nil, fmt.Errorf("count buckets: %w", err)
	}
	if err := s.db.QueryRow(
		`SELECT COUNT(o.id), COALESCE(SUM(o.size_bytes), 0)
		 FROM objects o JOIN buckets b ON o.bucket_id = b.id
		 WHERE b.project_id = ?`, projectID,
	).Scan(&m.TotalObjects, &m.TotalBytes); err != nil {
		return nil, fmt.Errorf("sum objects: %w", err)
	}

	since := time.Now().UTC().AddDate(0, 0, -30)
	_ = s.db.QueryRow(
		`SELECT
		   COALESCE(SUM(CASE WHEN event_type = 'ingress' THEN bytes ELSE 0 END), 0),
		   COALESCE(SUM(CASE WHEN event_type = 'egress' THEN bytes ELSE 0 END), 0),
		   COUNT(*)
		 FROM usage_events WHERE project_id = ? AND created_at >= ?`,
		projectID, since,
	).Scan(&m.IngressBytes, &m.EgressBytes, &m.RequestCount)

	// 14-day daily usage time series
	days := 14
	startDay := time.Now().UTC().AddDate(0, 0, -(days - 1))
	dayMap := make(map[string]*DailyUsagePoint, days)
	m.DailyUsage = make([]DailyUsagePoint, 0, days)
	for i := 0; i < days; i++ {
		d := startDay.AddDate(0, 0, i).Format("2006-01-02")
		pt := DailyUsagePoint{Date: d}
		m.DailyUsage = append(m.DailyUsage, pt)
		dayMap[d] = &m.DailyUsage[i]
	}
	if rows, err := s.db.Query(
		`SELECT
		   substr(created_at, 1, 10) AS day,
		   COALESCE(SUM(CASE WHEN event_type = 'ingress' THEN bytes ELSE 0 END), 0),
		   COALESCE(SUM(CASE WHEN event_type = 'egress' THEN bytes ELSE 0 END), 0),
		   COUNT(*)
		 FROM usage_events
		 WHERE project_id = ? AND created_at >= ?
		 GROUP BY day`,
		projectID, startDay.Format("2006-01-02"),
	); err == nil {
		for rows.Next() {
			var d string
			var inB, outB, reqs int64
			if err := rows.Scan(&d, &inB, &outB, &reqs); err == nil {
				if pt, ok := dayMap[d]; ok {
					pt.IngressBytes = inB
					pt.EgressBytes = outB
					pt.Requests = reqs
				}
			}
		}
		_ = rows.Close()
	}

	// MIME category breakdown
	m.MimeBreakdown = []MimeCategoryStat{}
	if rows, err := s.db.Query(
		`SELECT
		   CASE
		     WHEN o.mime_type LIKE 'image/%' THEN 'Images'
		     WHEN o.mime_type LIKE 'video/%' OR o.mime_type LIKE 'audio/%' THEN 'Media'
		     WHEN o.mime_type = 'application/pdf' OR o.mime_type LIKE 'text/%' OR o.mime_type LIKE 'application/json%' THEN 'Documents'
		     ELSE 'Other'
		   END AS cat,
		   COUNT(o.id),
		   COALESCE(SUM(o.size_bytes), 0)
		 FROM objects o
		 JOIN buckets b ON o.bucket_id = b.id
		 WHERE b.project_id = ?
		 GROUP BY cat
		 ORDER BY SUM(o.size_bytes) DESC`,
		projectID,
	); err == nil {
		for rows.Next() {
			var stat MimeCategoryStat
			if err := rows.Scan(&stat.Category, &stat.Count, &stat.Bytes); err == nil {
				m.MimeBreakdown = append(m.MimeBreakdown, stat)
			}
		}
		_ = rows.Close()
	}

	// Recent objects
	m.RecentObjects = []RecentObjectItem{}
	if rows, err := s.db.Query(
		`SELECT o.key, b.name, o.mime_type, o.size_bytes, o.updated_at
		 FROM objects o
		 JOIN buckets b ON o.bucket_id = b.id
		 WHERE b.project_id = ?
		 ORDER BY o.updated_at DESC
		 LIMIT 6`,
		projectID,
	); err == nil {
		for rows.Next() {
			var ro RecentObjectItem
			if err := rows.Scan(&ro.Key, &ro.BucketName, &ro.MimeType, &ro.SizeBytes, &ro.UpdatedAt); err == nil {
				m.RecentObjects = append(m.RecentObjects, ro)
			}
		}
		_ = rows.Close()
	}

	return &m, nil
}

// --- Admin Queries ---

func (s *Store) CountAdmins() (int64, error) {
	var count int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&count)
	return count, err
}

func (s *Store) UpdateUserRole(userID, role string) error {
	res, err := s.db.Exec(`UPDATE users SET role = ? WHERE id = ?`, role, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteUser(userID string) error {
	res, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) GetPlatformStats() (*PlatformStats, error) {
	var st PlatformStats
	if err := s.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) FROM users`).Scan(&st.TotalUsers, &st.TotalAdmins); err != nil {
		return nil, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM projects`).Scan(&st.TotalProjects); err != nil {
		return nil, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM buckets`).Scan(&st.TotalBuckets); err != nil {
		return nil, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(size_bytes), 0) FROM objects`).Scan(&st.TotalObjects, &st.TotalBytes); err != nil {
		return nil, err
	}
	return &st, nil
}

func (s *Store) ListAllUsersAdmin() ([]AdminUserSummary, error) {
	rows, err := s.db.Query(`
		SELECT
			u.id, u.email, u.name, u.role, u.created_at,
			COUNT(DISTINCT p.id) AS project_count,
			COUNT(DISTINCT b.id) AS bucket_count,
			COUNT(DISTINCT o.id) AS object_count,
			COALESCE(SUM(o.size_bytes), 0) AS total_bytes
		FROM users u
		LEFT JOIN workspaces w ON w.owner_id = u.id
		LEFT JOIN projects p ON p.workspace_id = w.id
		LEFT JOIN buckets b ON b.project_id = p.id
		LEFT JOIN objects o ON o.bucket_id = b.id
		GROUP BY u.id
		ORDER BY u.created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []AdminUserSummary
	for rows.Next() {
		var u AdminUserSummary
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.CreatedAt, &u.ProjectCount, &u.BucketCount, &u.ObjectCount, &u.TotalBytes); err != nil {
			return nil, err
		}
		list = append(list, u)
	}
	return list, rows.Err()
}

func (s *Store) ListAllBucketsAdmin() ([]AdminBucketSummary, error) {
	rows, err := s.db.Query(`
		SELECT
			b.id, b.name, b.visibility, p.name, u.email, b.created_at,
			COUNT(o.id) AS object_count,
			COALESCE(SUM(o.size_bytes), 0) AS total_bytes
		FROM buckets b
		JOIN projects p ON p.id = b.project_id
		JOIN workspaces w ON w.id = p.workspace_id
		JOIN users u ON u.id = w.owner_id
		LEFT JOIN objects o ON o.bucket_id = b.id
		GROUP BY b.id
		ORDER BY b.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []AdminBucketSummary
	for rows.Next() {
		var b AdminBucketSummary
		if err := rows.Scan(&b.ID, &b.Name, &b.Visibility, &b.ProjectName, &b.OwnerEmail, &b.CreatedAt, &b.ObjectCount, &b.TotalBytes); err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, rows.Err()
}

func (s *Store) ListAllProjectsAdmin() ([]AdminProjectSummary, error) {
	rows, err := s.db.Query(`
		SELECT
			p.id, p.name, p.slug, w.name, u.email, u.name, p.storage_quota_bytes, p.created_at,
			COUNT(DISTINCT b.id) AS bucket_count,
			COUNT(DISTINCT o.id) AS object_count,
			COALESCE(SUM(o.size_bytes), 0) AS total_bytes
		FROM projects p
		JOIN workspaces w ON w.id = p.workspace_id
		JOIN users u ON u.id = w.owner_id
		LEFT JOIN buckets b ON b.project_id = p.id
		LEFT JOIN objects o ON o.bucket_id = b.id
		GROUP BY p.id
		ORDER BY p.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []AdminProjectSummary
	for rows.Next() {
		var p AdminProjectSummary
		if err := rows.Scan(&p.ID, &p.Name, &p.Slug, &p.WorkspaceName, &p.OwnerEmail, &p.OwnerName, &p.StorageQuotaBytes, &p.CreatedAt, &p.BucketCount, &p.ObjectCount, &p.TotalBytes); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

// --- Audit Logs ---

func (s *Store) RecordAuditLog(log *AuditLog) error {
	_, err := s.db.Exec(`
		INSERT INTO audit_logs (id, project_id, actor_email, action, target, details, ip_address, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, log.ID, log.ProjectID, log.ActorEmail, log.Action, log.Target, log.Details, log.IPAddress, log.CreatedAt.UTC())
	return err
}

func (s *Store) ListAuditLogs(projectID string, limit int) ([]AuditLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.Query(`
		SELECT id, project_id, actor_email, action, target, details, ip_address, created_at
		FROM audit_logs
		WHERE project_id = ?
		ORDER BY created_at DESC
		LIMIT ?
	`, projectID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []AuditLog
	for rows.Next() {
		var a AuditLog
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.ActorEmail, &a.Action, &a.Target, &a.Details, &a.IPAddress, &a.CreatedAt); err != nil {
			return nil, err
		}
		logs = append(logs, a)
	}
	return logs, rows.Err()
}

