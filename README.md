# Serevox — Razor-Sharp Web Object Storage

> Terinspirasi oleh *Seregios* (Monster Hunter) — cepat, lincah, dan presisi.  
> Platform *self-hostable object storage* yang menggabungkan **S3-Compatible API** (ala Cloudflare R2 / AWS S3) dan **Developer Ergonomics** (ala Supabase Storage) untuk melayani banyak aplikasi web dalam satu hub.

## Struktur Proyek

- `docs/PRD.md` — Product Requirements Document lengkap.
- `backend/` — Core Object Storage Engine (Go, SQLite WAL, Local Sharded Blob Driver, AWS SigV4, REST API, On-the-fly Image Optimization, Webhooks).
- `web/` — Serevox Web Console (React, TypeScript, Tailwind CSS, Dark Obsidian & Golden Amber theme).
- `packages/sdk/` — Official `@serevox/sdk` TypeScript/JavaScript client library.
- `Dockerfile` & `docker-compose.yml` — Deployment siap produksi dalam satu container.

## Menjalankan Secara Lokal

### 1. Build Web Console (agar langsung dilayani oleh Go server di port 8080)
```bash
cd web
npm install
npm run build
```

### 2. Jalankan Backend Serevox
```bash
cd backend
go run ./cmd/serevox
```
Buka **`http://localhost:8080`** di browser untuk melakukan initial setup (membuat admin, project pertama, starter bucket, dan mendapatkan API Key + S3 Key).

*(Untuk development frontend terpisah dengan HMR, jalankan `cd web && npm run dev` dan akses `http://localhost:5173` — Vite otomatis mem-proxy API ke port `8080`.)*

## Menjalankan Test Suite

```bash
# Backend integration tests (Console, REST, Image Resize, S3 SigV4, Multipart, Webhooks)
cd backend && go test -v ./...

# SDK TypeScript build & unit tests
cd packages/sdk && npm test

# Frontend TypeScript & Vite production build
cd web && npm run build
```

## Integrasi ke Web App Lain

### Menggunakan `@aws-sdk/client-s3` (Drop-in S3 / R2)
```ts
import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://localhost:8080',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});
```

### Menggunakan `@serevox/sdk` (Supabase-style)
```ts
import { createSerevoxClient } from '@serevox/sdk';

const serevox = createSerevoxClient({
  url: 'http://localhost:8080',
  apiKey: process.env.SEREVOX_SERVICE_KEY!,
});

await serevox.from('serevox-public').upload('avatars/u1.png', file, { upsert: true });
const thumbUrl = serevox.from('serevox-public').getPublicUrl('avatars/u1.png', {
  transform: { width: 256, height: 256, fit: 'cover', format: 'jpeg' },
});
```

## Menjalankan dengan Docker Compose

Satu container `serevox-app` menyajikan Web Console + S3-Compatible API + REST API
(Golang `net/http`, database SQLite WAL di dalam `/data`, tanpa database eksternal).

```bash
# Pastikan network eksternal tersedia (dibuat sekali oleh platform)
docker network create autodev-net  # abaikan jika sudah ada

docker compose -p serevox build
docker compose -p serevox up -d
docker compose -p serevox logs
```

- UI & API: `http://serevox-app:80` (dari dalam network `autodev-net`)
  - `GET /health` — healthcheck
  - `GET /console/api/setup-status` — status setup awal
  - Frontend memanggil API via path relatif (`/console/api/*`, `/v1/*`, `/s3/*`).
- Persistensi: named volume `serevox_db_data` → `/data` (SQLite + blob).
  Seeding/inisialisasi berjalan otomatis di dalam aplikasi saat startup.
- Uploads share: `/project/autodev-py/data_sharing/serevox` → `/app/uploads`.
- Semua service memakai network eksternal `autodev-net`, `restart: always`,
  dan hanya `expose` (tanpa pemetaan `ports`).

## Helm Chart

Template Kubernetes ada di `helmchart/` (`Chart.yaml`, `values.yaml`,
`templates/deployment.yaml`, `templates/service.yaml`, `templates/ingress.yaml`).
Atur `global.ingress.enabled`, `global.ingress.host`, `global.ingress.tlsSecret`
serta `services.serevox-app.image` / `services.serevox-app.port` di `values.yaml`.

