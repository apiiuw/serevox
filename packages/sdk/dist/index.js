export class SerevoxBucketClient {
    baseUrl;
    apiKey;
    bucket;
    fetcher;
    constructor(baseUrl, bucket, apiKey, fetcher = fetch) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.bucket = bucket;
        this.apiKey = apiKey;
        this.fetcher = fetcher;
    }
    authHeaders(extra) {
        const h = { ...extra };
        if (this.apiKey) {
            h['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return h;
    }
    async requestJSON(path, init) {
        const res = await this.fetcher(`${this.baseUrl}${path}`, init);
        const text = await res.text();
        let parsed = {};
        if (text) {
            try {
                parsed = JSON.parse(text);
            }
            catch {
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
        return { data: parsed, error: null };
    }
    async upload(path, fileBody, options) {
        const cleanPath = path.replace(/^\/+/, '');
        const qs = new URLSearchParams({ path: cleanPath });
        if (options?.upsert) {
            qs.set('upsert', 'true');
        }
        const headers = this.authHeaders();
        if (options?.contentType) {
            headers['Content-Type'] = options.contentType;
        }
        else if (typeof Blob !== 'undefined' && fileBody instanceof Blob && fileBody.type) {
            headers['Content-Type'] = fileBody.type;
        }
        else {
            headers['Content-Type'] = 'application/octet-stream';
        }
        return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/upload?${qs.toString()}`, {
            method: 'POST',
            headers,
            body: fileBody,
        });
    }
    async createSignedUploadUrl(path, options) {
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
    async uploadToSignedUrl(signedUrl, fileBody, options) {
        const headers = {};
        if (options?.contentType) {
            headers['Content-Type'] = options.contentType;
        }
        const res = await this.fetcher(signedUrl, {
            method: 'PUT',
            headers,
            body: fileBody,
        });
        const data = (await res.json());
        if (!res.ok) {
            return {
                data: null,
                error: { message: String(data.error ?? `HTTP ${res.status}`), status: res.status },
            };
        }
        return { data: data, error: null };
    }
    async createSignedUrl(path, expiresIn = 3600) {
        return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/sign`, {
            method: 'POST',
            headers: this.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ path: path.replace(/^\/+/, ''), expiresIn }),
        });
    }
    async createSignedUrls(paths, expiresIn = 3600) {
        return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/sign`, {
            method: 'POST',
            headers: this.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ paths: paths.map((p) => p.replace(/^\/+/, '')), expiresIn }),
        });
    }
    getPublicUrl(path, options) {
        const cleanPath = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
        const base = `${this.baseUrl}/v1/public/${encodeURIComponent(this.bucket)}/${cleanPath}`;
        if (!options?.transform) {
            return base;
        }
        const qs = new URLSearchParams();
        const t = options.transform;
        if (t.width)
            qs.set('w', String(t.width));
        if (t.height)
            qs.set('h', String(t.height));
        if (t.fit)
            qs.set('fit', t.fit);
        if (t.quality)
            qs.set('q', String(t.quality));
        if (t.format)
            qs.set('format', t.format);
        const qStr = qs.toString();
        return qStr ? `${base}?${qStr}` : base;
    }
    async download(path) {
        const cleanPath = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
        const res = await this.fetcher(`${this.baseUrl}/v1/authenticated/${encodeURIComponent(this.bucket)}/${cleanPath}`, { headers: this.authHeaders() });
        if (!res.ok) {
            return { data: null, error: { message: `HTTP ${res.status}`, status: res.status } };
        }
        const blob = await res.blob();
        return { data: blob, error: null };
    }
    async list(prefix = '', options) {
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
    async move(sourceKey, destinationKey) {
        return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/move`, {
            method: 'POST',
            headers: this.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ sourceKey, destinationKey }),
        });
    }
    async copy(sourceKey, destinationKey) {
        return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects/copy`, {
            method: 'POST',
            headers: this.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ sourceKey, destinationKey }),
        });
    }
    async remove(paths) {
        return this.requestJSON(`/v1/buckets/${encodeURIComponent(this.bucket)}/objects`, {
            method: 'DELETE',
            headers: this.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ paths }),
        });
    }
}
export class SerevoxClient {
    url;
    apiKey;
    fetcher;
    constructor(options) {
        this.url = options.url.replace(/\/+$/, '');
        this.apiKey = options.apiKey;
        this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    }
    from(bucket) {
        return new SerevoxBucketClient(this.url, bucket, this.apiKey, this.fetcher);
    }
}
export function createSerevoxClient(options) {
    return new SerevoxClient(options);
}
/**
 * Verifies an incoming Serevox webhook request signature (`X-Serevox-Signature` + `X-Serevox-Timestamp`).
 * Works in Node.js 20+, Bun, Deno, and Edge Runtimes via Web Crypto.
 */
export async function verifySerevoxWebhook(rawBody, signatureHeader, timestampHeader, secret, maxAgeSeconds = 300) {
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
    const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
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
