package db

import "time"

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
}

type Workspace struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	OwnerID   string    `json:"owner_id"`
	CreatedAt time.Time `json:"created_at"`
}

type Project struct {
	ID                string    `json:"id"`
	WorkspaceID       string    `json:"workspace_id"`
	Name              string    `json:"name"`
	Slug              string    `json:"slug"`
	StorageQuotaBytes int64     `json:"storage_quota_bytes"`
	CreatedAt         time.Time `json:"created_at"`
}

type AuditLog struct {
	ID         string    `json:"id"`
	ProjectID  string    `json:"project_id"`
	ActorEmail string    `json:"actor_email"`
	Action     string    `json:"action"`
	Target     string    `json:"target"`
	Details    string    `json:"details"`
	IPAddress  string    `json:"ip_address"`
	CreatedAt  time.Time `json:"created_at"`
}

type CORSRule struct {
	AllowedOrigins []string `json:"allowed_origins"`
	AllowedMethods []string `json:"allowed_methods"`
	AllowedHeaders []string `json:"allowed_headers"`
	ExposeHeaders  []string `json:"expose_headers"`
	MaxAgeSeconds  int      `json:"max_age_seconds"`
}

type Bucket struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"project_id"`
	Name             string     `json:"name"`
	Visibility       string     `json:"visibility"` // "public" or "private"
	MaxFileSize      int64      `json:"max_file_size"`
	AllowedMimeTypes []string   `json:"allowed_mime_types"`
	CORSRules        []CORSRule `json:"cors_rules"`
	LifecycleDays    int        `json:"lifecycle_days"`
	CustomDomain     string     `json:"custom_domain"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	ObjectCount      int64      `json:"object_count,omitempty"`
	TotalBytes       int64      `json:"total_bytes,omitempty"`
}

type Object struct {
	ID          string            `json:"id"`
	BucketID    string            `json:"bucket_id"`
	Key         string            `json:"key"`
	SizeBytes   int64             `json:"size_bytes"`
	MimeType    string            `json:"mime_type"`
	ETag        string            `json:"etag"`
	SHA256      string            `json:"sha256"`
	StoragePath string            `json:"-"`
	Metadata    map[string]string `json:"metadata"`
	ExpiresAt   *time.Time        `json:"expires_at,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

type MultipartUpload struct {
	ID        string            `json:"id"`
	BucketID  string            `json:"bucket_id"`
	ObjectKey string            `json:"object_key"`
	MimeType  string            `json:"mime_type"`
	Metadata  map[string]string `json:"metadata"`
	Status    string            `json:"status"` // "pending", "completed", "aborted"
	ExpiresAt time.Time         `json:"expires_at"`
	CreatedAt time.Time         `json:"created_at"`
}

type UploadPart struct {
	ID          string    `json:"id"`
	UploadID    string    `json:"upload_id"`
	PartNumber  int       `json:"part_number"`
	SizeBytes   int64     `json:"size_bytes"`
	ETag        string    `json:"etag"`
	StoragePath string    `json:"-"`
	CreatedAt   time.Time `json:"created_at"`
}

type APIKey struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"project_id"`
	Name             string     `json:"name"`
	KeyType          string     `json:"key_type"`   // "s3", "anon", "service_role"
	KeyPrefix        string     `json:"key_prefix"` // visible prefix e.g. srx_srv_abcd...
	KeyHash          string     `json:"-"`
	AccessKeyID      string     `json:"access_key_id,omitempty"` // for S3 keys
	SecretCiphertext string     `json:"-"`                       // encrypted S3 secret
	BucketID         string     `json:"bucket_id,omitempty"`     // optional bucket scope
	Permission       string     `json:"permission"`              // "read_only", "write_only", "read_write", "admin"
	LastUsedAt       *time.Time `json:"last_used_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	RevokedAt        *time.Time `json:"revoked_at,omitempty"`
}

type Webhook struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	URL       string    `json:"url"`
	Secret    string    `json:"secret,omitempty"`
	Events    []string  `json:"events"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

type WebhookDelivery struct {
	ID           string    `json:"id"`
	WebhookID    string    `json:"webhook_id"`
	EventType    string    `json:"event_type"`
	PayloadJSON  string    `json:"payload_json"`
	StatusCode   int       `json:"status_code"`
	ResponseBody string    `json:"response_body"`
	Attempt      int       `json:"attempt"`
	Success      bool      `json:"success"`
	ErrorMessage string    `json:"error_message"`
	CreatedAt    time.Time `json:"created_at"`
}

type DailyUsagePoint struct {
	Date         string `json:"date"`
	IngressBytes int64  `json:"ingress_bytes"`
	EgressBytes  int64  `json:"egress_bytes"`
	Requests     int64  `json:"requests"`
}

type MimeCategoryStat struct {
	Category string `json:"category"`
	Count    int64  `json:"count"`
	Bytes    int64  `json:"bytes"`
}

type RecentObjectItem struct {
	Key        string    `json:"key"`
	BucketName string    `json:"bucket_name"`
	MimeType   string    `json:"mime_type"`
	SizeBytes  int64     `json:"size_bytes"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type ProjectMetrics struct {
	TotalBuckets  int64              `json:"total_buckets"`
	TotalObjects  int64              `json:"total_objects"`
	TotalBytes    int64              `json:"total_bytes"`
	IngressBytes  int64              `json:"ingress_bytes"`
	EgressBytes   int64              `json:"egress_bytes"`
	RequestCount  int64              `json:"request_count"`
	DailyUsage    []DailyUsagePoint  `json:"daily_usage"`
	MimeBreakdown []MimeCategoryStat `json:"mime_breakdown"`
	RecentObjects []RecentObjectItem `json:"recent_objects"`
}

type PlatformStats struct {
	TotalUsers    int64 `json:"total_users"`
	TotalAdmins   int64 `json:"total_admins"`
	TotalProjects int64 `json:"total_projects"`
	TotalBuckets  int64 `json:"total_buckets"`
	TotalObjects  int64 `json:"total_objects"`
	TotalBytes    int64 `json:"total_bytes"`
}

type AdminUserSummary struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	Role         string    `json:"role"`
	ProjectCount int64     `json:"project_count"`
	BucketCount  int64     `json:"bucket_count"`
	ObjectCount  int64     `json:"object_count"`
	TotalBytes   int64     `json:"total_bytes"`
	CreatedAt    time.Time `json:"created_at"`
}

type AdminBucketSummary struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Visibility  string    `json:"visibility"`
	ProjectName string    `json:"project_name"`
	OwnerEmail  string    `json:"owner_email"`
	ObjectCount int64     `json:"object_count"`
	TotalBytes  int64     `json:"total_bytes"`
	CreatedAt   time.Time `json:"created_at"`
}

type AdminProjectSummary struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Slug              string    `json:"slug"`
	WorkspaceName     string    `json:"workspace_name"`
	OwnerEmail        string    `json:"owner_email"`
	OwnerName         string    `json:"owner_name"`
	StorageQuotaBytes int64     `json:"storage_quota_bytes"`
	BucketCount       int64     `json:"bucket_count"`
	ObjectCount       int64     `json:"object_count"`
	TotalBytes        int64     `json:"total_bytes"`
	CreatedAt         time.Time `json:"created_at"`
}

