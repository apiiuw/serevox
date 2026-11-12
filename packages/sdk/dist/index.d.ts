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
export declare class SerevoxBucketClient {
    private readonly baseUrl;
    private readonly apiKey?;
    private readonly bucket;
    private readonly fetcher;
    constructor(baseUrl: string, bucket: string, apiKey?: string, fetcher?: typeof fetch);
    private authHeaders;
    private requestJSON;
    upload(path: string, fileBody: Blob | ArrayBuffer | Uint8Array | string, options?: {
        upsert?: boolean;
        contentType?: string;
    }): Promise<SerevoxResponse<{
        bucket: string;
        object: SerevoxObject;
        public_url?: string;
    }>>;
    createSignedUploadUrl(path: string, options?: {
        expiresIn?: number;
        upsert?: boolean;
    }): Promise<SerevoxResponse<{
        signedUrl: string;
        token: string;
        path: string;
        expiresIn: number;
    }>>;
    uploadToSignedUrl(signedUrl: string, fileBody: Blob | ArrayBuffer | Uint8Array | string, options?: {
        contentType?: string;
    }): Promise<SerevoxResponse<{
        bucket: string;
        object: SerevoxObject;
    }>>;
    createSignedUrl(path: string, expiresIn?: number): Promise<SerevoxResponse<{
        signedUrl: string;
        expiresIn: number;
    }>>;
    createSignedUrls(paths: string[], expiresIn?: number): Promise<SerevoxResponse<{
        data: Array<{
            path: string;
            signedUrl: string;
            error?: string;
        }>;
    }>>;
    getPublicUrl(path: string, options?: {
        transform?: TransformOptions;
    }): string;
    download(path: string): Promise<SerevoxResponse<Blob>>;
    list(prefix?: string, options?: {
        delimiter?: string;
        limit?: number;
        cursor?: string;
    }): Promise<SerevoxResponse<{
        objects: SerevoxObject[];
        common_prefixes: string[];
        is_truncated: boolean;
        next_continuation_token?: string;
    }>>;
    move(sourceKey: string, destinationKey: string): Promise<SerevoxResponse<{
        object: SerevoxObject;
    }>>;
    copy(sourceKey: string, destinationKey: string): Promise<SerevoxResponse<{
        object: SerevoxObject;
    }>>;
    remove(paths: string[]): Promise<SerevoxResponse<{
        deleted: string[];
    }>>;
}
export declare class SerevoxClient {
    private readonly url;
    private readonly apiKey?;
    private readonly fetcher;
    constructor(options: SerevoxClientOptions);
    from(bucket: string): SerevoxBucketClient;
}
export declare function createSerevoxClient(options: SerevoxClientOptions): SerevoxClient;
/**
 * Verifies an incoming Serevox webhook request signature (`X-Serevox-Signature` + `X-Serevox-Timestamp`).
 * Works in Node.js 20+, Bun, Deno, and Edge Runtimes via Web Crypto.
 */
export declare function verifySerevoxWebhook(rawBody: string | Uint8Array, signatureHeader: string, timestampHeader: string, secret: string, maxAgeSeconds?: number): Promise<boolean>;
