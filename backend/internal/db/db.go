package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Store wraps the SQLite database connection and provides domain queries.
type Store struct {
	db *sql.DB
}

// Open opens (or creates) the SQLite database at dbPath and runs schema migrations.
func Open(dbPath string) (*Store, error) {
	if dbPath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
			return nil, fmt.Errorf("create db dir: %w", err)
		}
	}

	dsn := dbPath
	if dbPath != ":memory:" {
		dsn = fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)", dbPath)
	}

	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	if dbPath == ":memory:" {
		// In-memory SQLite requires a single shared connection to retain schema/data.
		conn.SetMaxOpenConns(1)
		if _, err := conn.Exec("PRAGMA foreign_keys = ON;"); err != nil {
			_ = conn.Close()
			return nil, err
		}
	} else {
		conn.SetMaxOpenConns(8)
	}

	s := &Store{db: conn}
	if err := s.migrate(); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'admin',
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	slug TEXT NOT NULL UNIQUE,
	owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	slug TEXT NOT NULL UNIQUE,
	storage_quota_bytes INTEGER NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS buckets (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	name TEXT NOT NULL UNIQUE,
	visibility TEXT NOT NULL DEFAULT 'private',
	max_file_size INTEGER NOT NULL DEFAULT 0,
	allowed_mime_types_json TEXT NOT NULL DEFAULT '[]',
	cors_rules_json TEXT NOT NULL DEFAULT '[]',
	lifecycle_days INTEGER NOT NULL DEFAULT 0,
	custom_domain TEXT NOT NULL DEFAULT '',
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
	id TEXT PRIMARY KEY,
	bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
	key TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	mime_type TEXT NOT NULL,
	etag TEXT NOT NULL,
	sha256 TEXT NOT NULL,
	storage_path TEXT NOT NULL,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	expires_at DATETIME,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	UNIQUE(bucket_id, key)
);

CREATE INDEX IF NOT EXISTS idx_objects_bucket_key ON objects(bucket_id, key);
CREATE INDEX IF NOT EXISTS idx_objects_expires_at ON objects(expires_at);

CREATE TABLE IF NOT EXISTS multipart_uploads (
	id TEXT PRIMARY KEY,
	bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
	object_key TEXT NOT NULL,
	mime_type TEXT NOT NULL,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	status TEXT NOT NULL DEFAULT 'pending',
	expires_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_parts (
	id TEXT PRIMARY KEY,
	upload_id TEXT NOT NULL REFERENCES multipart_uploads(id) ON DELETE CASCADE,
	part_number INTEGER NOT NULL,
	size_bytes INTEGER NOT NULL,
	etag TEXT NOT NULL,
	storage_path TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	UNIQUE(upload_id, part_number)
);

CREATE TABLE IF NOT EXISTS api_keys (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	key_type TEXT NOT NULL,
	key_prefix TEXT NOT NULL,
	key_hash TEXT NOT NULL DEFAULT '',
	access_key_id TEXT NOT NULL DEFAULT '',
	secret_ciphertext TEXT NOT NULL DEFAULT '',
	bucket_id TEXT NOT NULL DEFAULT '',
	permission TEXT NOT NULL DEFAULT 'read_write',
	last_used_at DATETIME,
	created_at DATETIME NOT NULL,
	revoked_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_access_key ON api_keys(access_key_id);

CREATE TABLE IF NOT EXISTS webhooks (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	url TEXT NOT NULL,
	secret TEXT NOT NULL,
	events_json TEXT NOT NULL DEFAULT '[]',
	active INTEGER NOT NULL DEFAULT 1,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
	id TEXT PRIMARY KEY,
	webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
	event_type TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	status_code INTEGER NOT NULL DEFAULT 0,
	response_body TEXT NOT NULL DEFAULT '',
	attempt INTEGER NOT NULL DEFAULT 1,
	success INTEGER NOT NULL DEFAULT 0,
	error_message TEXT NOT NULL DEFAULT '',
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id TEXT NOT NULL,
	bucket_id TEXT NOT NULL DEFAULT '',
	event_type TEXT NOT NULL,
	bytes INTEGER NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_project ON usage_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	actor_email TEXT NOT NULL DEFAULT 'system',
	action TEXT NOT NULL,
	target TEXT NOT NULL,
	details TEXT NOT NULL DEFAULT '',
	ip_address TEXT NOT NULL DEFAULT '',
	created_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_proj ON audit_logs(project_id, created_at);
`
	_, err := s.db.Exec(schema)
	return err
}

