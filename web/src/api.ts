export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  storage_quota_bytes: number;
  created_at: string;
}

export interface Bucket {
  id: string;
  project_id: string;
  name: string;
  visibility: 'public' | 'private';
  max_file_size: number;
  allowed_mime_types: string[];
  lifecycle_days: number;
  custom_domain: string;
  object_count?: number;
  total_bytes?: number;
  created_at: string;
}

export interface StorageObject {
  id: string;
  bucket_id: string;
  key: string;
  size_bytes: number;
  mime_type: string;
  etag: string;
  sha256: string;
  created_at: string;
  updated_at: string;
}

export interface APIKey {
  id: string;
  project_id: string;
  name: string;
  key_type: 's3' | 'anon' | 'service_role';
  key_prefix: string;
  access_key_id?: string;
  permission: string;
  last_used_at?: string;
  created_at: string;
  revoked_at?: string;
}

export interface Webhook {
  id: string;
  project_id: string;
  url: string;
  secret?: string;
  events: string[];
  active: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  project_id: string;
  actor_email: string;
  action: string;
  target: string;
  details: string;
  ip_address: string;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  event_type: string;
  status_code: number;
  success: boolean;
  attempt: number;
  error_message: string;
  created_at: string;
}

export interface DailyUsagePoint {
  date: string;
  ingress_bytes: number;
  egress_bytes: number;
  requests: number;
}

export interface MimeCategoryStat {
  category: string;
  count: number;
  bytes: number;
}

export interface RecentObjectItem {
  key: string;
  bucket_name: string;
  mime_type: string;
  size_bytes: number;
  updated_at: string;
}

export interface ProjectMetrics {
  total_buckets: number;
  total_objects: number;
  total_bytes: number;
  ingress_bytes: number;
  egress_bytes: number;
  request_count: number;
  daily_usage?: DailyUsagePoint[];
  mime_breakdown?: MimeCategoryStat[];
  recent_objects?: RecentObjectItem[];
}

export interface PlatformStats {
  total_users: number;
  total_admins: number;
  total_projects: number;
  total_buckets: number;
  total_objects: number;
  total_bytes: number;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  project_count: number;
  bucket_count: number;
  object_count: number;
  total_bytes: number;
  created_at: string;
}

export interface AdminBucketSummary {
  id: string;
  name: string;
  visibility: 'public' | 'private';
  project_name: string;
  owner_email: string;
  object_count: number;
  total_bytes: number;
  created_at: string;
}

export interface AdminProjectSummary {
  id: string;
  name: string;
  slug: string;
  workspace_name: string;
  owner_email: string;
  owner_name: string;
  storage_quota_bytes: number;
  bucket_count: number;
  object_count: number;
  total_bytes: number;
  created_at: string;
}

const TOKEN_KEY = 'serevox_console_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers ?? {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`/console/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${res.status})`);
  }
  return data as T;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

