# Product Requirements Document (PRD): Serevox

> **Project Name:** Serevox (terinspirasi dari *Seregios* — Monster Hunter)  
> **Tagline:** *Razor-Sharp, Agile Object Storage for Modern Web Apps*  
> **Version:** 1.0 (Draft)  
> **Status:** Ready for Review  

---

## 1. Ringkasan Eksekutif & Visi Produk

### 1.1 Latar Belakang
Dalam membangun berbagai aplikasi web (SaaS, CMS, e-commerce, portfolio, hingga aplikasi AI), pengelolaan file statis dan media (gambar, video, dokumen PDF, arsip) hampir selalu membutuhkan layanan *object storage* yang terpisah dari server aplikasi utama. Layanan seperti Cloudflare R2, AWS S3, dan Supabase Storage menjadi standar industri, namun sering menimbulkan ketergantungan vendor, keterbatasan kontrol saat *self-hosting*, atau biaya egress/transformasi gambar yang tinggi seiring bertambahnya proyek.

### 1.2 Visi Produk
**Serevox** adalah platform *web object storage* yang dapat di-*self-host* maupun dijalankan sebagai layanan terpusat (*multi-project*), menggabungkan:
1. **Kompatibilitas Protokol S3** ala **Cloudflare R2 / AWS S3 / MinIO** (agar kompatibel dengan ribuan library, framework, dan tools yang sudah ada).
2. **Developer Experience (DX) Modern** ala **Supabase Storage** (REST API ergonomis, JavaScript/TypeScript SDK, bucket visibility, signed URL, dan transformasi gambar *on-the-fly*).
3. **Arsitektur Multi-App Hub**, sehingga satu instance Serevox dapat melayani banyak aplikasi web berbeda dengan isolasi bucket, API key, kuota, webhook, dan custom domain masing-masing.

### 1.3 Identitas Brand & Estetika (Tema Seregios)
Terinspirasi dari **Seregios** (*The Thousand-Blade Wyvern*), Serevox mengusung filosofi **kecepatan, kelincahan, dan presisi**:
- **Visual Direction:** *Dark Obsidian* (`#0B0D10`), *Golden Scale Amber* (`#E5A91A` / `#F59E0B`), *Steel Slate* (`#1E242E`), dan *Crimson Bleed Accent* (`#EF4444`) untuk status destruktif/alert.
- **Konsep Terminologi Internal (Opsional/UI Accent):** Tetap menggunakan istilah standar industri (`Bucket`, `Object`, `Access Key`, `Presigned URL`) agar tidak membingungkan developer, sambil memberi sentuhan visual geometris tajam (*blade-scale cards*, *sharp progress gauges*, *edge telemetry*).

---

## 2. Target Pengguna & Use Cases

### 2.1 Target Pengguna
- **Primary User:** Developer / Owner yang mengelola banyak aplikasi web sekaligus (Next.js, Laravel, React, Vue, Go, Express, dll.) dan membutuhkan satu penyimpanan objek terpusat yang andal.
- **Secondary User:** Tim developer atau integrator pihak ketiga yang membutuhkan akses API terisolasi per proyek/aplikasi.

### 2.2 Use Cases Utama
1. **Direct Browser Upload:** User di web app lain mengunggah avatar atau lampiran langsung dari browser ke Serevox menggunakan *Presigned URL* tanpa membebani server web utama.
2. **Public Media & CDN Delivery:** Menyajikan gambar, font, atau aset publik dengan header cache optimal (`ETag`, `Cache-Control`), CORS terkontrol, dan custom domain (`cdn.domainanda.com`).
3. **Private Document Vault:** Menyimpan invoice, kontrak PDF, atau file sensitif dalam bucket `private` yang hanya bisa diakses melalui *Signed URL* berbatas waktu (*expiring link*).
4. **On-the-fly Image Optimization:** Aplikasi frontend meminta gambar dengan parameter ukuran dan format (`?w=600&format=webp&q=80`) tanpa perlu pipeline resize terpisah.
5. **Event-Driven Integration:** Saat file selesai diunggah ke Serevox, Serevox mengirim *webhook* ke backend web app terkait agar database aplikasi langsung diperbarui.
6. **Drop-in S3 Replacement:** Menggunakan `@aws-sdk/client-s3`, Laravel `s3` driver, Next.js, atau `rclone` hanya dengan mengganti `endpoint`, `accessKeyId`, dan `secretAccessKey`.

---

## 3. Ruang Lingkup & Persyaratan Fungsional

### 3.1 Multi-Workspace & Multi-Project Isolation
Agar Serevox mudah digunakan di banyak web app yang berbeda:
- **Workspaces / Organizations:** Wadah tingkat atas untuk mengelola tim atau lingkungan (misal: `Production`, `Staging`, atau per klien).
- **Projects (Apps):** Setiap web app didaftarkan sebagai satu Project (misal: `toko-online-web`, `blog-cms`, `saas-dashboard`).
- **Isolasi per Project:**
  - Bucket, Access Keys, Webhooks, Custom Domains, dan Analytics terpisah per Project.
  - Kuota penyimpanan & bandwidth dapat dikonfigurasi per Project (opsional/soft-limit warning).

### 3.2 Bucket Management
- **CRUD Bucket:** Buat, konfigurasi, kosongkan (*empty*), dan hapus bucket.
- **Visibility Mode:**
  - `Public`: Objek dapat diakses via URL publik langsung (tanpa signature), cocok untuk aset web dan media publik.
  - `Private`: Semua akses baca/tulis wajib terautentikasi (API Key, JWT, atau Presigned URL).
- **Bucket Policies & Guardrails:**
  - **Max File Size Limit:** Batas ukuran per file (misal: maks `10MB` untuk bucket `avatars`, `2GB` untuk bucket `videos`).
  - **Allowed MIME Types:** Whitelist tipe file (misal: `image/jpeg, image/png, image/webp`) dengan validasi *magic bytes* (bukan hanya ekstensi nama file).
  - **CORS Configuration:** Pengaturan granular `AllowedOrigins`, `AllowedMethods`, `AllowedHeaders`, `ExposeHeaders`, dan `MaxAgeSeconds` per bucket.
  - **Lifecycle Rules (TTL):** Penghapusan otomatis objek berdasarkan prefix atau umur file (misal: hapus file di `/tmp/*` setelah 24 jam).

### 3.3 Object Operations & Upload Protocols
- **Single-Request Upload:** Upload langsung via `PUT` (S3 style) atau `POST multipart/form-data` (REST style).
- **Presigned URLs (GET & PUT):**
  - Generate URL sementara dengan masa berlaku (`expiresIn`, misal 60 detik – 7 hari).
  - Mendukung batasan kondisi saat upload (ukuran maksimal / content-type tertentu).
- **Multipart / Resumable Upload:**
  - Mendukung S3 Multipart Upload (`CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`) dan/atau protokol resumable untuk file besar (>50MB hingga multi-GB) agar tahan terhadap koneksi putus.
- **Streaming Download & HTTP Range Requests:**
  - Wajib mendukung header `Range: bytes=...` (`206 Partial Content`) untuk pemutaran video/audio *seeking* dan *resume download*.
  - Wajib mendukung conditional requests (`If-None-Match` / `ETag` → `304 Not Modified`, `If-Modified-Since`).
- **Virtual Folder & Object Management:**
  - Navigasi berbasis prefix `/` dan `delimiter`, copy, move/rename, bulk delete, metadata kustom (`x-amz-meta-*` / JSON metadata), serta object tagging.

### 3.4 Kompatibilitas API (Dual-Protocol Architecture)
Serevox menyediakan dua antarmuka API yang mengakses storage engine yang sama:

#### A. S3-Compatible API (Standar Industri)
Mendukung **AWS Signature Version 4 (SigV4)** (baik *Authorization Header* maupun *Presigned Query String*) serta Virtual-Hosted Style & Path-Style addressing:
- Bucket ops: `ListBuckets`, `CreateBucket`, `DeleteBucket`, `HeadBucket`, `GetBucketCors`, `PutBucketCors`.
- Object ops: `ListObjectsV2`, `HeadObject`, `GetObject`, `PutObject`, `CopyObject`, `DeleteObject`, `DeleteObjects` (batch).
- Multipart ops: `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`.

#### B. Serevox Native REST API (Supabase-Style DX)
API JSON modern dengan Bearer Token / API Key yang lebih ringkas untuk aplikasi web modern:
- `POST /v1/buckets/:bucket/objects/upload` (direct upload)
- `POST /v1/buckets/:bucket/objects/sign-upload` (generate signed upload URL + token)
- `POST /v1/buckets/:bucket/objects/sign` (generate signed download URL, mendukung batch sign)
- `GET /v1/public/:bucket/*path` (akses cepat bucket public + query transformasi)
- `GET /v1/authenticated/:bucket/*path` (akses bucket private dengan token)
- `POST /v1/buckets/:bucket/objects/list` (listing, search prefix, pagination, sort)
- `DELETE /v1/buckets/:bucket/objects` (batch delete)
- `POST /v1/buckets/:bucket/objects/move` & `copy`

### 3.5 On-the-Fly Image & Media Transformation
- Transformasi gambar dinamis melalui query parameter (atau path modifier) pada endpoint delivery:
  - `w` / `width`, `h` / `height`
  - `fit`: `cover`, `contain`, `fill`, `inside`
  - `format`: `auto` (deteksi header `Accept` browser untuk AVIF/WebP), `webp`, `avif`, `jpeg`, `png`
  - `q` / `quality`: `1–100`
- **Derivative Caching:** Hasil transformasi di-cache secara lokal/disk dengan kunci unik `(object_etag, transform_params)` agar permintaan berikutnya dilayani instan tanpa CPU overhead berulang.
- **Abuse Protection:** Batas dimensi maksimal, *rate limiting*, dan opsi mewajibkan *signed transform URL* atau preset transformasi agar tidak dieksploitasi untuk DDoS CPU.

### 3.6 Keamanan, Autentikasi & Access Control
1. **Console Authentication:** Login dashboard untuk admin/tim (Email + Password, Session/JWT, opsi 2FA/TOTP di fase lanjut).
2. **S3 Access Keys:** Pasangan `Access Key ID` (prefiks `srx_`) & `Secret Access Key` dengan scope:
   - Project-wide atau Bucket-specific.
   - Permission: `read_only`, `write_only`, `read_write`, `admin`.
   - Dukungan rotasi key tanpa downtime (memiliki >1 key aktif saat masa transisi).
3. **API Keys (Supabase-style):**
   - `Public / Anon Key`: Hanya dapat mengakses bucket `public` atau mengunggah menggunakan *Signed Upload Token* dari backend.
   - `Service Role / Secret Key`: Akses penuh backend-to-backend untuk generate signed URLs dan mengelola objek di project terkait.
4. **Scoped Path Policies (RLS-Style / JWT Claims - Phase 2/3):**
   - Mendukung aturan akses berbasis path pattern & JWT claim dari auth aplikasi pengguna (misal: user dengan `sub=123` hanya boleh read/write ke prefix `users/123/*`).
5. **Security Hardening:**
   - Validasi *magic bytes* file terhadap `Content-Type`.
   - Pencegahan *Path Traversal* (`../`), *SSRF* (pada webhook), dan *XSS* pada file HTML/SVG yang diunggah (memaksa `Content-Disposition: attachment` atau sandbox header untuk SVG/HTML di public bucket jika diaktifkan).

### 3.7 Webhooks & Event System
- **Events:** `object.uploaded`, `object.deleted`, `multipart.completed`, `bucket.created`, `bucket.deleted`.
- **Delivery Guarantee:** Background worker dengan *exponential backoff retry* (misal hingga 5x percobaan) dan log status pengiriman (HTTP code, latency, response snippet).
- **Verifikasi Keamanan:** Setiap payload disertai header `X-Serevox-Signature` (HMAC-SHA256) dan `X-Serevox-Timestamp` untuk verifikasi di backend web app penerima.

### 3.8 Serevox Web Console (Dashboard UI)
Antarmuka web yang responsif dan intuitif untuk mengelola seluruh ekosistem storage:
- **Telemetry Overview:** Total storage terpakai, jumlah objek, bandwidth ingress/egress, request/sec, error rate, dan grafik historis.
- **Project & Bucket Manager:** Switcher project cepat, konfigurasi bucket (visibility, CORS, MIME, max size, lifecycle).
- **Interactive File Explorer:**
  - Drag-and-drop multi-file upload dengan progress bar real-time (termasuk multipart untuk file besar).
  - Grid view & List view, breadcrumb folder navigation, search & filter.
  - **Preview Drawer:** Preview gambar, pemutar video/audio (range streaming), PDF viewer, syntax preview untuk JSON/text, inspeksi metadata, ETag, dan tombol salin URL (Public URL / Generate Presigned URL langsung dari UI).
- **Developer Integration Hub:**
  - Generator `.env` siap pakai untuk berbagai platform.
  - Snippet kode interaktif (`@serevox/sdk`, `@aws-sdk/client-s3`, Laravel `filesystems.php`, Next.js `next.config`, `curl`).
- **Logs & Audit Trail:** Riwayat akses API, error S3/REST, dan status pengiriman webhook.

### 3.9 Developer Ecosystem (SDK & Integrasi)
- **`@serevox/sdk` (TypeScript / JavaScript):**
  - Bekerja di Browser, Node.js, Bun, Cloudflare Workers / Edge Runtime.
  - API ergonomis:
    ```ts
    const serevox = createSerevoxClient({ url, apiKey });
    await serevox.from('avatars').upload('user-1.png', file, { upsert: true });
    const { data } = await serevox.from('private-docs').createSignedUrl('invoice.pdf', 3600);
    const publicUrl = serevox.from('media').getPublicUrl('banner.jpg', { transform: { width: 800, format: 'webp' } });
    ```
- **Panduan Integrasi Standar:** Dokumentasi konfigurasi resmi untuk AWS SDK v3, Next.js Image Loader, Laravel Flysystem S3, Prisma/Payload/Directus, dan `rclone`.

---

## 4. Persyaratan Non-Fungsional (NFR)

| Kategori | Target & Spesifikasi |
| :--- | :--- |
| **Performa I/O** | Streaming upload & download penuh (zero full-file buffering di RAM) sehingga upload file 5GB tidak membuat penggunaan memori melonjak. |
| **Latensi** | Overhead routing API < 15ms di luar waktu transfer disk/jaringan. |
| **Reliabilitas** | *Atomic file writes* (tulis ke staging/temp lalu atomic move/commit metadata dalam transaksi DB) untuk mencegah *corrupt/partial file* terlihat oleh user. |
| **Integritas Data** | Penghitungan checksum (MD5/ETag & SHA-256) saat upload dan verifikasi part pada multipart upload. |
| **Portabilitas & Deploy** | Mudah di-deploy dengan 1 perintah `docker compose up -d` pada VPS/server pribadi maupun Kubernetes. |
| **Observability** | Structured JSON logging, endpoint `/health` & `/ready`, serta metrics Prometheus (`/metrics`). |

---

## 5. Usulan Arsitektur & Tech Stack

### 5.1 Arsitektur Tingkat Tinggi
1. **API & Storage Gateway (Core Engine):** Menangani S3 SigV4 parser, Native REST API, streaming I/O, Range requests, Image transformation, dan Auth middleware.
2. **Metadata Database:** Menyimpan data workspaces, projects, buckets, object index/metadata, multipart state, access keys, dan webhook configs.
3. **Blob Storage Driver (Pluggable):**
   - *Local Filesystem Driver* (Default untuk self-hosted/VPS: struktur sharded directory berdasarkan hash/UUID objek untuk menghindari limitasi ribuan file dalam satu folder OS).
   - *Upstream S3 Driver* (Opsional fase lanjut: menjadikan Serevox sebagai gateway/image-proxy di atas R2/S3/Backblaze B2).
4. **Background Worker:** Garbage collection (membersihkan file terhapus & multipart kadaluarsa), lifecycle TTL cleanup, dan webhook delivery queue.
5. **Web Console (Frontend):** Single Page App / SSR Dashboard yang berkomunikasi dengan Control Plane API.

### 5.2 Rekomendasi Pilihan Tech Stack
Berikut opsi utama yang direkomendasikan (untuk dikonfirmasi sebelum masuk ke fase desain teknis):

- **Opsi A — Go (Golang) Core + Next.js/React Dashboard *(Direkomendasikan)***
  - **Backend:** Go (Fiber / Chi / Gin) + `libvips` (`bimg` / `govips`) atau `imaging` untuk transformasi gambar super cepat.
  - **Kelebihan:** Sangat hemat RAM saat streaming ribuan koneksi konkuren, binary tunggal yang ringan, performa S3 gateway setara MinIO, sangat stabil untuk file besar.
- **Opsi B — TypeScript Fullstack (Bun/Node + Fastify/Hono) + Next.js/React Dashboard**
  - **Backend:** TypeScript (Hono/Fastify) + `sharp` (`libvips`) + AWS4 signature verification.
  - **Kelebihan:** Satu bahasa dengan frontend dan `@serevox/sdk` (monorepo Turborepo/pnpm), iterasi fitur sangat cepat, ekosistem npm melimpah.
- **Database & Cache:**
  - **Metadata DB:** PostgreSQL (utama) + dukungan opsional SQLite untuk mode single-instance ringan.
  - **Cache/Queue:** Redis (opsional/recommended untuk rate-limit, cache metadata hot-path, dan webhook queue) dengan fallback in-memory untuk setup minimal.

---

## 6. Model Data Konseptual (High-Level)

- `users`: akun pengelola console (`id`, `email`, `password_hash`, `role`, `created_at`).
- `workspaces` & `workspace_members`: isolasi organisasi & hak akses tim.
- `projects`: representasi web app (`id`, `workspace_id`, `name`, `slug`, `storage_quota_bytes`, `created_at`).
- `buckets`: (`id`, `project_id`, `name`, `visibility`, `max_file_size`, `allowed_mime_types`, `cors_rules`, `lifecycle_rules`, `custom_domain`).
- `objects`: (`id`, `bucket_id`, `key`, `size_bytes`, `mime_type`, `etag`, `sha256`, `storage_path`, `metadata_json`, `tags_json`, `created_at`, `updated_at`, `expires_at`).
- `multipart_uploads` & `upload_parts`: melacak `upload_id`, nomor part, etag part, ukuran, dan status kadaluarsa.
- `api_keys`: menyimpan S3 Access Keys (`access_key_id`, `secret_encrypted/hashed`) & REST API Keys (`anon`/`service_role`), `scopes`, `last_used_at`.
- `webhooks` & `webhook_deliveries`: endpoint URL, secret HMAC, daftar event, status pengiriman, dan payload log.
- `usage_daily`: agregasi metrik storage bytes, ingress, egress, dan total request per project/bucket per hari.

---

## 7. Roadmap Implementasi Bertahap

### Phase 1: MVP — Core Engine, S3 & REST Parity
- Setup monorepo, database schema, & local blob storage driver (streaming + atomic write).
- Auth system (Console auth, S3 Access Keys + SigV4 verifier, REST API Keys).
- Multi-Project & Bucket CRUD (`public` & `private`, max size, MIME whitelist, CORS).
- Core Object APIs (Put, Get + Range, Head, ListV2, Delete, Batch Delete, Presigned URLs).
- Web Console MVP (Login, Project & Bucket manager, File Explorer upload/preview/delete, Key manager, Integration snippets).

### Phase 2: Web App Integration & Media Optimization
- Multipart / Resumable Upload (S3 Multipart + REST chunked upload).
- On-the-fly Image Optimization (`w`, `h`, `fit`, `format`, `q`) + disk derivative cache + abuse protection.
- Webhooks engine (`object.uploaded`, `object.deleted`) + HMAC signature + retry queue + delivery log UI.
- Official **`@serevox/sdk`** (TypeScript/JavaScript package) + dokumentasi integrasi Next.js, Laravel, & AWS SDK.

### Phase 3: Scale, Security & Governance
- Lifecycle auto-expiration rules & background garbage collector.
- Custom Domain routing per bucket + auto-SSL guidance (Caddy/Nginx/Cloudflare proxy ready).
- JWT / RLS-style path policy rules (untuk akses langsung client-side menggunakan JWT dari aplikasi eksternal).
- Usage Analytics Dashboard (bandwidth/storage charts, quota enforcement).
- `serevox` CLI tool & opsional Upstream S3/R2 storage driver.

---

## 8. Kriteria Keberhasilan (Success Metrics)

1. **Drop-in Compatibility:** Aplikasi eksternal yang menggunakan `@aws-sdk/client-s3` atau Laravel `s3` driver dapat mengunggah, membaca, dan membuat presigned URL ke Serevox tanpa modifikasi kode bisnis (cukup ubah konfigurasi env).
2. **Client-Side Upload Efficiency:** Upload file 1GB melalui presigned/multipart URL berjalan mulus dengan konsumsi RAM server Serevox tetap rendah dan stabil.
3. **Multi-App Readiness:** Minimal 2–3 aplikasi web berbeda dapat terhubung secara terisolasi dalam satu instance Serevox dengan bucket, API key, dan webhook masing-masing.
4. **Developer Onboarding:** Developer dapat menghubungkan web app baru ke Serevox dalam waktu < 5 menit menggunakan `.env` dan snippet dari Dashboard.

---

## 9. Keputusan Terbuka (Open Decisions untuk Konfirmasi)

Sebelum masuk ke tahap **System Architecture & Database Design**, perlu disepakati beberapa poin berikut:
1. **Tech Stack Backend:** Memilih **Opsi A (Go)** untuk performa I/O & efisiensi resource maksimal, atau **Opsi B (TypeScript / Bun / Node)** untuk kesatuan bahasa monorepo dengan Frontend & SDK?
2. **Target Deployment Utama:** Fokus awal di **Docker Compose (Self-hosted VPS / Local Server)** dengan PostgreSQL/SQLite, atau langsung target cloud-native/Kubernetes?
3. **Cakupan SDK & Framework Prioritas:** Framework web apa yang paling sering Anda gunakan (misal: Next.js, Laravel, Express/Hono, Go) agar contoh integrasi dan prioritas SDK langsung disesuaikan?

