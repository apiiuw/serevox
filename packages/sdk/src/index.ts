export interface SerevoxClientOptions {
  url: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export interface TransformOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill';
  quality?: number;
  format?: 'jpeg' | 'png' | 'gif';
}

export interface SerevoxObject {
  id: string;
  bucket_id: string;
  key: string;
  size_bytes: number;
  mime_type: string;
  etag: string;
  sha256: string;
  metadata: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface SerevoxError {
  message: string;
  status: number;
}

export interface SerevoxResponse<T> {
  data: T | null;
  error: SerevoxError | null;
}

export class SerevoxBucketClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly bucket: string;
  private readonly fetcher: typeof fetch;

  constructor(baseUrl: string, bucket: string, apiKey?: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.bucket = bucket;
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  private async requestJSON<T>(path: string, init: RequestInit): Promise<SerevoxResponse<T>> {
    const res = await this.fetcher(`${this.baseUrl}${path}`, init);
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = { error: text };
      }
    }
    if (!res.ok) {
      return {
        data: null,
        error: {
          message: typeof parsed.error === 'string' ? parsed.error : `HTTP ${res.status}`,
          status: res.status,
        },
      };
    }
    return { data: parsed as T, error: null };
  }

  async upload(
    path: string,
    fileBody: Blob | ArrayBuffer | Uint8Array | string,
    options?: { upsert?: boolean; contentType?: string }
  ): Promise<SerevoxResponse<{ bucket: string; object: SerevoxObject; public_url?: string }>> {
    const cleanPath = path.replace(/^\/+/, '');
    const qs = new URLSearchParams({ path: cleanPath });
    if (options?.upsert) {
      qs.set('upsert', 'true');
    }

    const headers = this.authHeaders();
    if (options?.contentType) {
      headers['Content-Type'] = options.contentType;
    } else if (typeof Blob !== 'undefined' && fileBody instanceof Blob && fileBody.type) {
      headers['Content-Type'] = fileBody.type;
    } else {
      headers['Content-Type'] = 'application/octet-stream';
    }

    return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/upload?${qs.toString()}`, {
      method: 'POST',
      headers,
      body: fileBody as BodyInit,
    });
  }

  async createSignedUploadUrl(
    path: string,
    options?: { expiresIn?: number; upsert?: boolean }
  ): Promise<SerevoxResponse<{ signedUrl: string; token: string; path: string; expiresIn: number }>> {
    return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/sign-upload`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        path: path.replace(/^\/+/, ''),
        expiresIn: options?.expiresIn ?? 900,
        upsert: options?.upsert ?? false,
      }),
    });
  }

  async uploadToSignedUrl(
    signedUrl: string,
    fileBody: Blob | ArrayBuffer | Uint8Array | string,
    options?: { contentType?: string }
  ): Promise<SerevoxResponse<{ bucket: string; object: SerevoxObject }>> {
    const headers: Record<string, string> = {};
    if (options?.contentType) {
      headers['Content-Type'] = options.contentType;
    }
    const res = await this.fetcher(signedUrl, {
      method: 'PUT',
      headers,
      body: fileBody as BodyInit,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        data: null,
        error: { message: String(data.error ?? `HTTP ${res.status}`), status: res.status },
      };
    }
    return { data: data as { bucket: string; object: SerevoxObject }, error: null };
  }

  async createSignedUrl(
    path: string,
    expiresIn = 3600
  ): Promise<SerevoxResponse<{ signedUrl: string; expiresIn: number }>> {
    return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/sign`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path: path.replace(/^\/+/, ''), expiresIn }),
    });
  }

  async createSignedUrls(
    paths: string[],
    expiresIn = 3600
  ): Promise<SerevoxResponse<{ data: Array<{ path: string; signedUrl: string; error?: string }> }>> {
    return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/sign`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ paths: paths.map((p) => p.replace(/^\/+/, '')), expiresIn }),
    });
  }

  getPublicUrl(path: string, options?: { transform?: TransformOptions }): string {
    const cleanPath = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    const base = `${this.baseUrl}/v1/public/${encodeURIComponent(this.bucket)}/${cleanPath}`;
    if (!options?.transform) {
      return base;
    }
    const qs = new URLSearchParams();
    const t = options.transform;
    if (t.width) qs.set('w', String(t.width));
    if (t.height) qs.set('h', String(t.height));
    if (t.fit) qs.set('fit', t.fit);
    if (t.quality) qs.set('q', String(t.quality));
    if (t.format) qs.set('format', t.format);
    const qStr = qs.toString();
    return qStr ? `${base}?${qStr}` : base;
  }

  async download(path: string): Promise<SerevoxResponse<Blob>> {
    const cleanPath = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    const res = await this.fetcher(
      `${this.baseUrl}/v1/authenticated/${encodeURIComponent(this.bucket)}/${cleanPath}`,
      { headers: this.authHeaders() }
    );
    if (!res.ok) {
      return { data: null, error: { message: `HTTP ${res.status}`, status: res.status } };
    }
    const blob = await res.blob();
    return { data: blob, error: null };
  }

  async list(
    prefix = '',
    options?: { delimiter?: string; limit?: number; cursor?: string }
  ): Promise<SerevoxResponse<{ objects: SerevoxObject[]; common_prefixes: string[]; is_truncated: boolean; next_continuation_token?: string }>> {
    return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/list`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        prefix,
        delimiter: options?.delimiter ?? '',
        limit: options?.limit ?? 1000,
        cursor: options?.cursor ?? '',
      }),
    });
  }

  async move(sourceKey: string, destinationKey: string): Promise<SerevoxResponse<{ object: SerevoxObject }>> {
    return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/move`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sourceKey, destinationKey }),
    });
  }

  async copy(sourceKey: string, destinationKey: string): Promise<SerevoxResponse<{ object: SerevoxObject }>> {
    return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/copy`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sourceKey, destinationKey }),
    });
  }

  async remove(paths: string[]): Promise<SerevoxResponse<{ deleted: string[] }>> {
    return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects`, {
      method: 'DELETE',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ paths }),
    });
  }
}

export class SerevoxClient {
  private readonly url: string;
  private readonly apiKey?: string;
  private readonly fetcher: typeof fetch;

  constructor(options: SerevoxClientOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  from(bucket: string): SerevoxBucketClient {
    return new SerevoxBucketClient(this.url, bucket, this.apiKey, this.fetcher);
  }
}

export function createSerevoxClient(options: SerevoxClientOptions): SerevoxClient {
  return new SerevoxClient(options);
}

/**
 * Verifies an incoming Serevox webhook request signature (`X-Serevox-Signature` + `X-Serevox-Timestamp`).
 * Works in Node.js 20+, Bun, Deno, and Edge Runtimes via Web Crypto.
 */
export async function verifySerevoxWebhook(
  rawBody: string | Uint8Array,
  signatureHeader: string,
  timestampHeader: string,
  secret: string,
  maxAgeSeconds = 300
): Promise<boolean> {
  if (!signatureHeader || !timestampHeader || !secret) {
    return false;
  }
  const tsNum = Number(timestampHeader);
  if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > maxAgeSeconds) {
    return false;
  }
  const providedHex = signatureHeader.replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return false;
  }

  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const prefixBytes = enc.encode(`${timestampHeader}.`);
  const bodyBytes = typeof rawBody === 'string' ? enc.encode(rawBody) : rawBody;
  const combined = new Uint8Array(prefixBytes.length + bodyBytes.length);
  combined.set(prefixBytes, 0);
  combined.set(bodyBytes, prefixBytes.length);

  const sigBuf = await globalThis.crypto.subtle.sign('HMAC', key, combined);
  const expectedHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (expectedHex.length !== providedHex.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= expectedHex.charCodeAt(i) ^ providedHex.charCodeAt(i);
  }
  return diff === 0;
}

