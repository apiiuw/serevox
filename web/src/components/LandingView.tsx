import React, { useState } from 'react';
import {
  ArrowRight,
  Boxes,
  Check,
  Code2,
  Copy,
  Cpu,
  Database,
  FileCode2,
  FolderLock,
  Globe,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  KeyRound,
  Layers,
  Lock,
  Menu,
  Pause,
  Play,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  UploadCloud,
  Webhook,
  X,
  Zap,
} from 'lucide-react';

export type LandingPage = 'home' | 'features' | 'how-it-works' | 'docs' | 'pricing';

interface LandingViewProps {
  publicUrl: string;
  onEnterConsole: (mode: 'login' | 'register') => void;
}

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        options?: {
          onSuccess?: (result: any) => void;
          onPending?: (result: any) => void;
          onError?: (result: any) => void;
          onClose?: () => void;
        }
      ) => void;
    };
  }
}

const MARQUEE_TOP = [
  'Next.js App Router',
  'React & Vite',
  'Laravel Flysystem S3',
  'Node.js & Express',
  'Go net/http',
  'Python Boto3',
  'Flutter & Mobile',
  'AWS SDK v3',
  'Cloudflare R2 Compatible',
];

const MARQUEE_BOTTOM = [
  'On-the-Fly Image Resize',
  'Signed Upload URLs',
  'SigV4 Presigned Links',
  'HMAC-SHA256 Webhooks',
  'Multipart Uploads',
  'Bucket CORS Rules',
  'Multi-Tenant RBAC',
  'Admin Control Center',
  'SVG/HTML XSS Sandbox',
];

export function LandingView({ publicUrl, onEnterConsole }: LandingViewProps) {
  const [page, setPage] = useState<LandingPage>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tilt, setTilt] = useState({ rx: 10, ry: -14 });
  const [docLang, setDocLang] = useState<'sdk' | 'rest' | 'aws' | 'laravel' | 'python'>('sdk');
  const [copiedCode, setCopiedCode] = useState(false);

  function navigateTo(next: LandingPage) {
    setPage(next);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleVaultPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({
      rx: Math.round((0.5 - py - 0.5) * 24 + 8),
      ry: Math.round((px) * 28 - 10),
    });
  }

  function resetVaultTilt() {
    setTilt({ rx: 10, ry: -14 });
  }

  const codeSnippets: Record<typeof docLang, { label: string; title: string; code: string }> = {
    sdk: {
      label: '@serevox/sdk',
      title: 'TypeScript / JavaScript — Upload, Transform & Signed URL',
      code: `import { createSerevoxClient } from '@serevox/sdk';

const serevox = createSerevoxClient({
  url: '${publicUrl}',
  apiKey: process.env.SEREVOX_SERVICE_KEY!,
});

// 1. Upload or update a file (upsert: true)
await serevox.from('serevox-public').upload('products/hero.png', file, {
  upsert: true,
  contentType: 'image/png',
});

// 2. Get a public URL with on-the-fly image resizing
const thumbUrl = serevox.from('serevox-public').getPublicUrl('products/hero.png', {
  transform: { width: 640, height: 400, fit: 'cover', format: 'jpeg', quality: 85 },
});

// 3. Generate a time-limited Signed URL for private buckets
const { data } = await serevox.from('private-docs').createSignedUrl('invoice.pdf', 3600);`,
    },
    rest: {
      label: 'REST API',
      title: 'HTTP / cURL / Fetch — Universal Any Language',
      code: `# Upload a file directly via HTTP POST
curl -X POST "${publicUrl}/v1/buckets/serevox-public/objects/upload?path=avatars/user-1.png&upsert=true" \\
  -H "Authorization: Bearer $SEREVOX_SERVICE_KEY" \\
  -H "Content-Type: image/png" \\
  --data-binary "@avatar.png"

# Serve a public image (with optional on-the-fly transform)
# <img src="${publicUrl}/v1/public/serevox-public/avatars/user-1.png?w=300&format=jpeg" />

# List objects inside a bucket
curl -X POST "${publicUrl}/v1/buckets/serevox-public/objects/list" \\
  -H "Authorization: Bearer $SEREVOX_SERVICE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prefix":"avatars/","limit":50}'`,
    },
    aws: {
      label: 'AWS SDK v3',
      title: 'Drop-in S3-Compatible Client (Node.js / Next.js)',
      code: `import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: '${publicUrl}/s3',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.SEREVOX_S3_ACCESS_KEY!,
    secretAccessKey: process.env.SEREVOX_S3_SECRET_KEY!,
  },
});

await s3.send(new PutObjectCommand({
  Bucket: 'serevox-public',
  Key: 'uploads/report.pdf',
  Body: pdfBuffer,
  ContentType: 'application/pdf',
}));`,
    },
    laravel: {
      label: 'Laravel (PHP)',
      title: 'config/filesystems.php — S3 Driver Ready',
      code: `// config/filesystems.php
'serevox' => [
    'driver' => 's3',
    'key' => env('SEREVOX_ACCESS_KEY'),
    'secret' => env('SEREVOX_SECRET_KEY'),
    'region' => 'us-east-1',
    'bucket' => env('SEREVOX_BUCKET', 'serevox-public'),
    'endpoint' => '${publicUrl}/s3',
    'use_path_style_endpoint' => true,
],

// Di Controller Laravel Anda:
Storage::disk('serevox')->put('invoices/inv-001.pdf', $pdfContent);
$url = Storage::disk('serevox')->temporaryUrl('invoices/inv-001.pdf', now()->addMinutes(30));`,
    },
    python: {
      label: 'Python (Boto3)',
      title: 'Django / FastAPI / Data Pipelines',
      code: `import boto3

s3 = boto3.client(
    's3',
    endpoint_url='${publicUrl}/s3',
    aws_access_key_id='YOUR_S3_ACCESS_KEY',
    aws_secret_access_key='YOUR_S3_SECRET_KEY',
    region_name='us-east-1',
)

s3.upload_file('photo.jpg', 'serevox-public', 'gallery/photo.jpg')
presigned = s3.generate_presigned_url(
    'get_object',
    Params={'Bucket': 'private-docs', 'Key': 'contract.pdf'},
    ExpiresIn=3600,
)`,
    },
  };

  function copyActiveSnippet() {
    navigator.clipboard.writeText(codeSnippets[docLang].code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  }

  const navPages: { id: LandingPage; label: string }[] = [
    { id: 'home', label: 'Overview' },
    { id: 'how-it-works', label: 'How It Works' },
    { id: 'features', label: 'Features' },
    { id: 'docs', label: 'SDK & API Docs' },
    { id: 'pricing', label: 'Pricing' },
  ];

  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  async function handleCheckout(planId: string, amount: number) {
    if (planId === 'free') {
      onEnterConsole('register');
      return;
    }
    setCheckoutLoading(planId);
    try {
      const res = await fetch('/console/api/billing/charge-snap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          gross_amount: amount,
          customer_name: 'Serevox Developer',
          customer_email: 'developer@serevox.cloud',
        }),
      });
      const data = await res.json();
      if (!data.token) {
        alert(data.error || 'Failed to initiate Midtrans checkout');
        return;
      }
      if (window.snap) {
        window.snap.pay(data.token, {
          onSuccess: (result: any) => {
            alert('Pembayaran Berhasil! Selamat menikmati paket Serevox Cloud Anda.');
            onEnterConsole('register');
          },
          onPending: (result: any) => {
            alert('Menunggu pembayaran Anda via Midtrans.');
          },
          onError: (result: any) => {
            alert('Pembayaran gagal atau dibatalkan.');
          },
        });
      } else {
        alert('Midtrans Snap SDK sedang dimuat. Silakan coba sesaat lagi.');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setCheckoutLoading(null);
    }
  }

  return (
    <div className="min-h-screen scale-grid-bg text-slate-100">
      {/* Sticky Enterprise Navigation */}
      <header className="sticky top-0 z-40 border-b border-[#1d2530]/90 bg-[#07090d]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <button
            type="button"
            onClick={() => navigateTo('home')}
            className="flex items-center gap-3 text-left"
          >
            <img src="/LOGO-SEREVOX.png" alt="Serevox logo" className="h-14 w-auto shrink-0 object-contain" />
            <div>
              <div className="text-xl font-extrabold tracking-tight text-slate-50">
                SEREVOX <span className="text-[#84c498]">CLOUD</span>
              </div>
              <div className="text-[11px] font-medium text-slate-400">Enterprise Object Storage</div>
            </div>
          </button>

          {/* Desktop Multi-Page Nav */}
          <nav aria-label="Landing pages" className="hidden items-center gap-1 lg:flex">
            {navPages.map((item) => {
              const active = page === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${active
                      ? 'bg-[#417150]/25 text-[#9bd3ad]'
                      : 'text-slate-300 hover:bg-[#131820] hover:text-white'
                    }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onEnterConsole('login')}
              className="hidden rounded-lg border border-[#273242] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad] sm:inline-flex"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => onEnterConsole('register')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#417150] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#4e855f]"
            >
              Launch Console <ArrowRight className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="inline-flex items-center justify-center rounded-lg border border-[#242e3b] p-2 text-slate-300 lg:hidden"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Multi-Page Drawer */}
        {mobileMenuOpen && (
          <div className="border-t border-[#1d2530] bg-[#0b0e14] px-5 py-4 lg:hidden">
            <div className="flex flex-col gap-1.5">
              {navPages.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`rounded-lg px-3 py-2 text-left text-sm font-medium ${page === item.id ? 'bg-[#417150] text-white' : 'text-slate-300 hover:bg-[#141a23]'
                    }`}
                >
                  {item.label}
                </button>
              ))}
              <div className="mt-2 flex items-center gap-2 border-t border-[#1b222d] pt-3">
                <button
                  type="button"
                  onClick={() => onEnterConsole('login')}
                  className="flex-1 rounded-lg border border-[#273242] py-2 text-xs font-semibold text-slate-200"
                >
                  Sign In
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* PAGE CONTENT */}
      <main key={page} className="page-enter">
        {page === 'home' && (
          <>
            {/* HERO WITH 3D INTERACTIVE VAULT */}
            <section className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 lg:pt-16">
              <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
                <div>
                  <div className="mb-5 inline-flex items-center gap-2.5 rounded-lg border border-[#2b3b30] bg-[#0c1410]/90 px-3 py-1.5 text-xs font-semibold tracking-wide text-[#b7e4c5] shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-[#417150] ring-4 ring-[#417150]/25" />
                    Enterprise Cloud Object Storage
                  </div>

                  <h1 className="hero-title font-extrabold tracking-tight text-slate-50">
                    Store, Transform &amp; Serve{' '}
                    <span className="bg-gradient-to-r from-[#84c498] via-[#b7e4c5] to-[#417150] bg-clip-text text-transparent">
                      Every Asset
                    </span>{' '}
                    Across Any Web Stack.
                  </h1>

                  <p className="prose-pretty mt-5 text-base text-slate-300">
                    Serevox is a high-performance, self-hosted object storage platform engineered for modern web
                    applications. Store, transform, and deliver images, videos, PDFs, and mission-critical assets from
                    a single lightweight binary - featuring an S3 SigV4 API, REST SDK, on-the-fly image optimization,
                    Signed URLs, HMAC Webhooks, and an Enterprise Admin Control Center.
                  </p>

                  <div className="mt-8 flex flex-wrap items-center gap-3.5">
                    <button
                      type="button"
                      onClick={() => onEnterConsole('register')}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#417150] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#417150]/25 hover:bg-[#4e855f]"
                    >
                      Get Started Free <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateTo('docs')}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#283344] bg-[#0e131a] px-5 py-3.5 text-sm font-semibold text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad]"
                    >
                      <Terminal className="h-4 w-4 text-[#84c498]" /> Explore SDK &amp; API Docs
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateTo('how-it-works')}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#202936] px-4 py-3.5 text-sm font-medium text-slate-300 hover:text-white"
                    >
                      <Layers className="h-4 w-4 text-[#84c498]" /> How It Works
                    </button>
                  </div>

                  <div className="mt-8 grid grid-cols-3 gap-4 border-t border-[#1a222d] pt-6">
                    {[
                      { k: 'Dual API', v: 'S3 + REST' },
                      { k: 'On-the-Fly', v: 'Image Resize' },
                      { k: 'Zero Lock-in', v: 'Self-Hostable' },
                    ].map((item) => (
                      <div key={item.k}>
                        <div className="text-xs font-medium text-slate-400">{item.k}</div>
                        <div className="mt-0.5 text-sm font-bold text-[#9bd3ad]">{item.v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3D Interactive Storage Vault */}
                <div
                  className="scene-3d relative flex min-h-[380px] items-center justify-center overflow-x-clip py-6"
                  onPointerMove={handleVaultPointerMove}
                  onPointerLeave={resetVaultTilt}
                >
                  {/* Ambient 3D orbital ring */}
                  <div
                    aria-hidden="true"
                    className="orbit-ring pointer-events-none absolute h-72 w-72 rounded-full border border-dashed border-[#417150]/40 sm:h-88 sm:w-88"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute h-56 w-56 rounded-full bg-[#417150]/20 blur-3xl"
                  />

                  <div
                    className="vault-3d vault-float-idle relative w-full max-w-md"
                    style={{ transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }}
                  >
                    {/* Back 3D Layer: Disk & SQLite WAL */}
                    <div
                      className="vault-layer absolute -inset-3 rounded-2xl border border-[#417150]/30 bg-[#0b120e]/80 p-4 shadow-2xl"
                      style={{ transform: 'translateZ(-42px) translateX(14px) translateY(14px)' }}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#84c498]/70">
                        <span>LAYER 03 // BLOB + WAL</span>
                        <span>SHA-256 DEDUP</span>
                      </div>
                    </div>

                    {/* Middle 3D Layer: Image & Signed URL Engine */}
                    <div
                      className="vault-layer absolute -inset-1.5 rounded-2xl border border-[#417150]/45 bg-[#101914]/85 p-4 shadow-xl"
                      style={{ transform: 'translateZ(-20px) translateX(7px) translateY(7px)' }}
                    />

                    {/* Front 3D Layer: Interactive Storage Card */}
                    <div
                      className="vault-layer enterprise-card relative rounded-2xl border border-[#417150]/60 p-6 shadow-2xl"
                      style={{ transform: 'translateZ(24px)' }}
                    >
                      <div className="flex items-center justify-between border-b border-[#1d2733] pb-4">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#417150]/25 text-[#9bd3ad]">
                            <Boxes className="h-5 w-5" />
                          </span>
                          <div>
                            <div className="text-sm font-bold text-slate-100">Serevox Storage Core</div>
                            <div className="text-[11px] text-slate-400">Unified Object &amp; Media Engine</div>
                          </div>
                        </div>
                        <span className="rounded-full bg-[#417150]/25 px-2.5 py-1 text-[10px] font-bold text-[#9bd3ad]">
                          LIVE NODE
                        </span>
                      </div>

                      <div className="mt-4 space-y-2.5 text-xs">
                        {[
                          { label: 'S3 & REST Gateway', val: '/s3 • /v1', icon: Globe },
                          { label: 'Image Transform Cache', val: '?w=640&format=jpeg', icon: ImageIcon },
                          { label: 'Signed Upload / Download', val: 'HMAC-SHA256 Token', icon: Lock },
                          { label: 'Realtime Event Stream', val: 'Webhooks + Metrics', icon: Webhook },
                        ].map((row) => (
                          <div
                            key={row.label}
                            className="flex items-center justify-between rounded-xl border border-[#1f2936] bg-[#090d12]/90 px-3.5 py-2.5"
                          >
                            <span className="flex items-center gap-2 font-medium text-slate-200">
                              <row.icon className="h-3.5 w-3.5 text-[#84c498]" />
                              {row.label}
                            </span>
                            <code className="font-mono text-[11px] text-[#9bd3ad]">{row.val}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* INFINITY LOOP DATA PIPELINE (SVG ∞ + DUAL MARQUEE) */}
            <section className="border-y border-[#1a222d] bg-[#090c11]/90 py-14">
              <div className="mx-auto max-w-7xl px-5 sm:px-8">
                <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#84c498]">
                      <InfinityIcon className="h-4 w-4" /> Continuous Infinity Pipeline
                    </div>
                    <h2 className="section-heading mt-1 text-2xl font-extrabold text-slate-50 sm:text-3xl">
                      Seamless Infinity Pipeline for Every Framework
                    </h2>
                  </div>
                  <p className="max-w-md text-xs text-slate-400">
                    Upload from browser or backend → optimize &amp; cache images automatically → dispatch signed
                    webhooks → deliver globally in one continuous, zero-friction loop.
                  </p>
                </div>

                {/* Animated Infinity Figure-8 SVG Diagram */}
                <div className="enterprise-card mb-8 overflow-hidden rounded-2xl p-6">
                  <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.4fr_1fr]">
                    <div className="rounded-xl border border-[#1f2936] bg-[#0a0e14] p-4">
                      <div className="text-xs font-bold text-[#84c498]">01. INGEST &amp; UPLOAD</div>
                      <div className="mt-1 text-sm font-semibold text-slate-100">Web, Mobile &amp; Backend</div>
                      <p className="mt-1 text-xs text-slate-400">
                        Direct browser PUT via Signed URLs, REST Multipart, or AWS S3 SDKs.
                      </p>
                    </div>

                    <div className="relative flex flex-col items-center justify-center py-2">
                      <svg
                        viewBox="0 0 420 150"
                        className="h-32 w-full max-w-md"
                        role="img"
                        aria-label="Serevox infinity data flow animation"
                      >
                        <defs>
                          <linearGradient id="serevoxInfGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#417150" />
                            <stop offset="50%" stopColor="#9bd3ad" />
                            <stop offset="100%" stopColor="#417150" />
                          </linearGradient>
                        </defs>
                        {/* Base subtle infinity track */}
                        <path
                          d="M 210 75 C 160 15, 55 15, 55 75 C 55 135, 160 135, 210 75 C 260 15, 365 15, 365 75 C 365 135, 260 135, 210 75 Z"
                          fill="none"
                          stroke="#1e2935"
                          strokeWidth="10"
                          strokeLinecap="round"
                        />
                        {/* Animated glowing infinity loop */}
                        <path
                          d="M 210 75 C 160 15, 55 15, 55 75 C 55 135, 160 135, 210 75 C 260 15, 365 15, 365 75 C 365 135, 260 135, 210 75 Z"
                          fill="none"
                          stroke="url(#serevoxInfGrad)"
                          strokeWidth="4"
                          strokeLinecap="round"
                          className="infinity-svg-flow"
                        />
                        <text x="108" y="80" textAnchor="middle" fill="#cbd5e1" fontSize="11" fontWeight="700">
                          UPLOAD
                        </text>
                        <text x="312" y="80" textAnchor="middle" fill="#cbd5e1" fontSize="11" fontWeight="700">
                          DELIVER
                        </text>
                      </svg>
                    </div>

                    <div className="rounded-xl border border-[#1f2936] bg-[#0a0e14] p-4">
                      <div className="text-xs font-bold text-[#84c498]">02. TRANSFORM &amp; SERVE</div>
                      <div className="mt-1 text-sm font-semibold text-slate-100">CDN, Resize &amp; Webhooks</div>
                      <p className="mt-1 text-xs text-slate-400">
                        Stream video/PDFs with HTTP Range Requests, auto-resize images, and trigger webhooks.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Dual-Track Infinity Marquee */}
                <div className="infinity-marquee space-y-3 overflow-hidden py-2">
                  <div className="infinity-track-left gap-3">
                    {[...MARQUEE_TOP, ...MARQUEE_TOP].map((label, idx) => (
                      <span
                        key={`top-${idx}`}
                        className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#233040] bg-[#0e141c] px-4 py-2 text-xs font-semibold text-slate-200"
                      >
                        <span className="h-2 w-2 rounded-full bg-[#417150]" />
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="infinity-track-right gap-3">
                    {[...MARQUEE_BOTTOM, ...MARQUEE_BOTTOM].map((label, idx) => (
                      <span
                        key={`bot-${idx}`}
                        className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#26382d] bg-[#0c1510] px-4 py-2 text-xs font-semibold text-[#9bd3ad]"
                      >
                        <Zap className="h-3 w-3 text-[#75b88a]" />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* REAL-WORLD USE CASES */}
            <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
              <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">Built for Production</div>
                  <h2 className="section-heading mt-1 text-2xl font-extrabold text-slate-50 sm:text-3xl">
                    Real-World Use Cases Across Every Industry
                  </h2>
                </div>
                <p className="max-w-md text-xs text-slate-400">
                  Offload heavy binary assets from your app server and let Serevox handle uploads, resizing, streaming,
                  and access control automatically.
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    title: 'SaaS User Uploads',
                    desc: 'Accept avatars, CSVs, and documents directly from the browser using time-limited Signed Upload URLs without exposing API keys.',
                    tag: 'Direct Browser PUT',
                  },
                  {
                    title: 'E-Commerce Media',
                    desc: 'Upload one high-resolution product photo and serve crisp thumbnails (?w=400&h=400&format=jpeg) cached on disk automatically.',
                    tag: 'Image Studio',
                  },
                  {
                    title: 'Video & PDF Streaming',
                    desc: 'Deliver MP4 videos, audio tracks, and large PDFs with native HTTP Range Requests (Accept-Ranges: bytes) for instant seeking.',
                    tag: 'Range Streaming',
                  },
                  {
                    title: 'Private Invoice Vaults',
                    desc: 'Store contracts, KYC files, and invoices in Private buckets accessible only via authenticated Bearer keys or expiring Signed URLs.',
                    tag: 'Zero-Trust Access',
                  },
                ].map((uc) => (
                  <div key={uc.title} className="enterprise-card flex flex-col justify-between rounded-2xl p-6">
                    <div>
                      <span className="inline-block rounded-md bg-[#417150]/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#9bd3ad]">
                        {uc.tag}
                      </span>
                      <h3 className="mt-3 text-base font-bold text-slate-100">{uc.title}</h3>
                      <p className="mt-2 text-xs leading-relaxed text-slate-400">{uc.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* SECURITY & ARCHITECTURE HIGHLIGHTS */}
            <section className="border-y border-[#1a222d] bg-[#090c11]/80 py-16">
              <div className="mx-auto max-w-7xl px-5 sm:px-8">
                <div className="grid items-center gap-10 lg:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">
                      Security &amp; Governance
                    </div>
                    <h2 className="mt-2 text-2xl font-extrabold text-slate-50 sm:text-3xl">
                      Enterprise-Grade Security Built Into Every Layer
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">
                      From AES-GCM encrypted API credentials and 15-second auto-closing secret reveals to per-bucket
                      CORS policies and SVG/HTML XSS sandboxing, Serevox protects your assets by default.
                    </p>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {[
                        'AES-GCM Encrypted Secrets',
                        '15s Auto-Close Key Preview',
                        'HMAC-SHA256 Signed Webhooks',
                        'Multi-Tenant Admin RBAC',
                        'Per-Bucket MIME & Size Limits',
                        'CSP Sandbox for SVG & HTML',
                      ].map((item) => (
                        <div key={item} className="flex items-center gap-2 text-xs font-medium text-slate-200">
                          <Check className="h-4 w-4 shrink-0 text-[#84c498]" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="enterprise-card rounded-2xl p-6">
                    <div className="mb-4 text-xs font-bold uppercase tracking-wider text-[#84c498]">
                      Live Telemetry &amp; Control
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { label: 'Protocols', value: 'S3 + REST', sub: 'Dual-engine API' },
                        { label: 'Image Cache', value: 'On-the-Fly', sub: 'Auto disk caching' },
                        { label: 'Access Control', value: 'Public / Private', sub: 'Signed URLs & JWT' },
                        { label: 'Observability', value: '14-Day Charts', sub: 'Ingress & Egress' },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-xl border border-[#1f2936] bg-[#080b0f] p-4">
                          <div className="text-[11px] text-slate-400">{stat.label}</div>
                          <div className="mt-1 text-lg font-extrabold text-[#9bd3ad]">{stat.value}</div>
                          <div className="text-[11px] text-slate-500">{stat.sub}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* EXPLORE MULTI-PAGE SECTIONS */}
            <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
              <div className="mb-10 text-center">
                <h2 className="section-heading text-2xl font-extrabold text-slate-50 sm:text-3xl">
                  Explore Serevox in Depth
                </h2>
                <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-400">
                  Navigate through dedicated pages covering how Serevox works, platform advantages, SDK code examples,
                  and pricing.
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    page: 'how-it-works' as LandingPage,
                    title: 'How It Works',
                    desc: 'Understand what Serevox is, the end-to-end upload-to-delivery workflow, and why teams choose it.',
                    icon: Layers,
                  },
                  {
                    page: 'features' as LandingPage,
                    title: 'Platform Features',
                    desc: 'Public/Private buckets, Signed URLs, Image Studio, CORS, Multipart, and Admin RBAC.',
                    icon: Cpu,
                  },
                  {
                    page: 'docs' as LandingPage,
                    title: 'SDK & API Docs',
                    desc: 'Copy-paste integration guides for Next.js, React, Laravel, Python Boto3, and AWS SDK v3.',
                    icon: FileCode2,
                  },
                  {
                    page: 'pricing' as LandingPage,
                    title: 'Pricing',
                    desc: 'Compare Free Self-Hosted Core vs Enterprise Cluster & Edge Hybrid plans.',
                    icon: ShieldCheck,
                  },
                ].map((card) => (
                  <button
                    key={card.page}
                    type="button"
                    onClick={() => navigateTo(card.page)}
                    className="card-3d-tilt enterprise-card flex flex-col items-start rounded-2xl p-6 text-left"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#417150]/20 text-[#84c498]">
                      <card.icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-4 text-base font-bold text-slate-100">{card.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{card.desc}</p>
                    <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#9bd3ad]">
                      Explore Page <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {page === 'features' && (
          <section className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
            <div className="max-w-3xl">
              <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">Platform Capabilities</div>
              <h1 className="mt-2 text-3xl font-extrabold text-slate-50 sm:text-4xl">
                Enterprise Object Storage Capabilities in a Single Binary
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                Engineered for full compatibility with modern S3-compatible and REST cloud storage workflows so your
                web applications can upload, update, transform, and deliver assets with zero friction.
              </p>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: UploadCloud,
                  title: 'Create, Update, Move & Copy',
                  desc: 'Single-file uploads, multipart assembly, in-place replacement (upsert=true), folder moves, and server-side object copies via REST or S3.',
                },
                {
                  icon: ImageIcon,
                  title: 'On-the-Fly Image Engine',
                  desc: 'Append ?w=400&h=400&fit=cover&q=80&format=jpeg to any public or authenticated image URL — transformed results are cached on disk.',
                },
                {
                  icon: FolderLock,
                  title: 'Public CDN & Private Vault',
                  desc: 'Public buckets serve directly inside <img> and <video> tags, while private vaults enforce Bearer keys or time-limited Signed URLs.',
                },
                {
                  icon: KeyRound,
                  title: 'Scoped API Keys & S3 SigV4',
                  desc: 'Generate scoped anon/browser keys, service_role backend keys, and S3 Access Key + Secret Key pairs for AWS SDKs & Laravel.',
                },
                {
                  icon: Webhook,
                  title: 'HMAC-SHA256 Webhooks',
                  desc: 'Dispatch signed event notifications to your backend whenever objects are uploaded or deleted, complete with delivery logs and retries.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Admin Control Center & RBAC',
                  desc: 'Manage users, promote/demote admin & member roles, monitor cross-tenant storage quotas, and audit every bucket from one unified console.',
                },
              ].map((feat) => (
                <div key={feat.title} className="card-3d-tilt enterprise-card rounded-2xl p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#417150]/20 text-[#84c498]">
                    <feat.icon className="h-5 w-5" />
                  </span>
                  <h2 className="mt-4 text-base font-bold text-slate-100">{feat.title}</h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">{feat.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 space-y-10">
              {/* Image Transform Parameters Matrix */}
              <div className="enterprise-card overflow-hidden rounded-2xl">
                <div className="border-b border-[#1c2430] px-6 py-4">
                  <h2 className="text-base font-bold text-slate-100">On-the-Fly Image Transformation Parameters</h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Append any combination of query parameters to a public or authenticated image URL — Serevox caches
                    the transformed output automatically.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#1c2430] bg-[#0a0e14] text-[11px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-6 py-3">Parameter</th>
                        <th className="px-4 py-3">Example</th>
                        <th className="px-6 py-3">Behavior</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#171d27]">
                      {[
                        ['w / width', '?w=640', 'Target output width in pixels (up to 4096px).'],
                        ['h / height', '?h=400', 'Target output height in pixels (up to 4096px).'],
                        ['fit', '?fit=cover', 'Resize strategy: cover (crop), contain (letterbox), or fill.'],
                        ['q / quality', '?q=82', 'Compression quality from 1 to 100 (default 82).'],
                        ['format / f', '?format=jpeg', 'Convert output format on the fly (jpeg, png, or gif).'],
                      ].map(([param, ex, desc]) => (
                        <tr key={param}>
                          <td className="px-6 py-3 font-mono font-semibold text-[#9bd3ad]">{param}</td>
                          <td className="px-4 py-3 font-mono text-slate-300">{ex}</td>
                          <td className="px-6 py-3 text-slate-400">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Comparison Table */}
              <div className="enterprise-card overflow-hidden rounded-2xl">
                <div className="border-b border-[#1c2430] px-6 py-4">
                  <h2 className="text-base font-bold text-slate-100">Serevox vs Local App Disk vs Hyperscalers</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#1c2430] bg-[#0a0e14] text-[11px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-6 py-3">Capability</th>
                        <th className="px-4 py-3 text-[#9bd3ad]">Serevox Cloud</th>
                        <th className="px-4 py-3">Local App Folder</th>
                        <th className="px-6 py-3">Legacy Cloud S3</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#171d27]">
                      {[
                        ['S3 + REST Dual API', 'Built-in', 'Not available', 'S3 only'],
                        ['On-the-Fly Image Resize', 'Built-in + Cached', 'Manual setup', 'Requires extra CDN/Lambda'],
                        ['Zero Egress Fees (Self-Hosted)', 'Yes', 'Yes', 'High per-GB egress'],
                        ['Multi-Tenant Admin RBAC', 'Built-in Console', 'None', 'Complex IAM policies'],
                        ['15s Auto-Close Secret Preview', 'Built-in', 'None', 'Plaintext or hidden'],
                      ].map(([cap, sv, loc, leg]) => (
                        <tr key={cap}>
                          <td className="px-6 py-3 font-medium text-slate-200">{cap}</td>
                          <td className="px-4 py-3 font-semibold text-[#9bd3ad]">{sv}</td>
                          <td className="px-4 py-3 text-slate-400">{loc}</td>
                          <td className="px-6 py-3 text-slate-400">{leg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#417150]/40 bg-[#417150]/10 p-6">
              <div>
                <h3 className="text-base font-bold text-slate-100">Ready to take it for a spin?</h3>
                <p className="text-xs text-slate-300">Launch the Console to create buckets and test Image Studio live.</p>
              </div>
              <button
                type="button"
                onClick={() => onEnterConsole('register')}
                className="inline-flex items-center gap-2 rounded-xl bg-[#417150] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#4e855f]"
              >
                Launch Console Now <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>
        )}

        {page === 'how-it-works' && (
          <section className="mx-auto max-w-7xl space-y-12 px-5 py-14 sm:px-8">
            <div className="max-w-3xl">
              <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">What Is Serevox?</div>
              <h1 className="mt-2 text-3xl font-extrabold text-slate-50 sm:text-4xl">
                A Dedicated Object Storage Server for All Your Web &amp; Mobile Apps
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                Instead of storing user uploads, product photos, videos, and PDFs inside your application server&apos;s
                local folder, Serevox gives you a centralized, S3-compatible and REST-ready storage engine — complete
                with Public CDN links, Private Signed URLs, on-the-fly image optimization, and full multi-tenant
                management.
              </p>
            </div>

            {/* Step-by-Step Workflow */}
            <div>
              <h2 className="text-xl font-bold text-slate-100">How Serevox Works (3 Simple Steps)</h2>
              <div className="mt-5 grid gap-5 md:grid-cols-3">
                {[
                  {
                    step: 'STEP 01',
                    title: 'Create Buckets & Set Access Rules',
                    desc: 'Organize files into Public buckets (for images and media embedded in <img>/<video>) or Private buckets (for invoices and sensitive docs).',
                    icon: FolderLock,
                  },
                  {
                    step: 'STEP 02',
                    title: 'Connect With Any Framework',
                    desc: 'Generate scoped API Keys or S3 Access Keys, then upload, update, list, or delete files directly from Next.js, React, Laravel, Express, Go, or Python.',
                    icon: KeyRound,
                  },
                  {
                    step: 'STEP 03',
                    title: 'Transform, Deliver & Automate',
                    desc: 'Serve optimized images on the fly (?w=640&format=jpeg), stream videos via HTTP Range requests, and trigger HMAC webhooks on every upload.',
                    icon: Zap,
                  },
                ].map((s) => (
                  <div key={s.step} className="enterprise-card rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold tracking-wider text-[#84c498]">{s.step}</span>
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#417150]/20 text-[#84c498]">
                        <s.icon className="h-4 w-4" />
                      </span>
                    </div>
                    <h3 className="mt-3 text-base font-bold text-slate-100">{s.title}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Key Advantages + Local vs Production */}
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="enterprise-card rounded-2xl p-6">
                <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">Why Choose Serevox</div>
                <h2 className="mt-2 text-xl font-bold text-slate-100">Key Advantages Over Traditional Storage</h2>
                <ul className="mt-4 space-y-3 text-xs text-slate-300">
                  {[
                    'Zero vendor lock-in & zero surprise egress fees — run locally or on your own VPS/Docker.',
                    'Works seamlessly with AWS SDK v3, Cloudflare R2 clients, Laravel Flysystem, Python Boto3, and @serevox/sdk.',
                    'Built-in on-the-fly image resizing & disk caching — no extra image proxy service needed.',
                    'Enterprise security: AES-GCM encrypted API keys, 15s auto-closing secret previews, SVG/HTML XSS sandboxing, and Admin RBAC.',
                    'End users never need to open the Serevox Console — your web app handles everything via API or Signed Upload URLs.',
                  ].map((adv) => (
                    <li key={adv} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#84c498]" />
                      <span>{adv}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="enterprise-card flex flex-col justify-between rounded-2xl p-6">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#84c498]">
                    <Server className="h-4 w-4" /> Local Dev vs Production
                  </div>
                  <h2 className="mt-2 text-xl font-bold text-slate-100">
                    Identical Behavior Locally and in Production
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    Locally (<code className="text-[#9bd3ad]">{publicUrl}</code>), every upload, image preview, video
                    stream, signed URL, and S3 endpoint is live. When deploying to production, run the Docker container
                    or binary on your server and point <code className="text-[#9bd3ad]">SEREVOX_PUBLIC_URL</code> to
                    your public domain.
                  </p>
                </div>

                <div className="mt-6 rounded-xl border border-[#202936] bg-[#080b0f] p-4 font-mono text-xs text-slate-300">
                  <div className="mb-2 text-[11px] font-bold text-[#84c498]"># Production Docker / Env Example</div>
                  <div>SEREVOX_PORT=8080</div>
                  <div>SEREVOX_PUBLIC_URL=https://storage.yourdomain.com</div>
                  <div>SEREVOX_DATA_DIR=/var/lib/serevox/data</div>
                  <div>SEREVOX_JWT_SECRET=your-256-bit-production-secret</div>
                </div>
              </div>
            </div>

            {/* Direct Browser Upload vs Server-to-Server Upload */}
            <div className="grid gap-6 md:grid-cols-2">
              <div className="enterprise-card rounded-2xl p-6">
                <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">Pattern A</div>
                <h2 className="mt-1 text-lg font-bold text-slate-100">Server-to-Server Upload (Backend)</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Ideal when your backend (Laravel, Express, Next.js API, Go, Django) processes files first before
                  storing them. Your server authenticates with a <code className="text-[#9bd3ad]">service_role</code>{' '}
                  key or S3 Access Key stored safely in <code className="text-[#9bd3ad]">.env</code>.
                </p>
                <div className="mt-4 rounded-xl border border-[#1f2936] bg-[#080b0f] p-3 font-mono text-[11px] text-slate-300">
                  Browser → Your Backend API → Serevox (/v1 or /s3) → Public / Signed URL
                </div>
              </div>

              <div className="enterprise-card rounded-2xl p-6">
                <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">Pattern B</div>
                <h2 className="mt-1 text-lg font-bold text-slate-100">Direct Browser Upload (Signed URL)</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Ideal for large photos or videos. Your backend requests a short-lived{' '}
                  <code className="text-[#9bd3ad]">createSignedUploadUrl()</code> from Serevox, and the user&apos;s
                  browser uploads directly via <code className="text-[#9bd3ad]">PUT</code> without touching your app
                  server bandwidth.
                </p>
                <div className="mt-4 rounded-xl border border-[#1f2936] bg-[#080b0f] p-3 font-mono text-[11px] text-slate-300">
                  Browser requests token → Your Backend → Browser PUT directly to Serevox
                </div>
              </div>
            </div>
          </section>
        )}

        {page === 'docs' && (
          <section className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
            <div className="max-w-3xl">
              <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">Developer Documentation</div>
              <h1 className="mt-2 text-3xl font-extrabold text-slate-50 sm:text-4xl">
                Integrate With Any Web Framework in Minutes
              </h1>
              <p className="mt-3 text-sm text-slate-300">
                Your end users never need to open the Serevox Console — all Create, Read, Update, Download, and Delete
                operations run seamlessly via API from your own application.
              </p>
            </div>

            {/* Language Tabs */}
            <div className="mt-8 enterprise-card overflow-hidden rounded-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1c2430] bg-[#0a0e14] px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(codeSnippets) as Array<keyof typeof codeSnippets>).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDocLang(key)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${docLang === key
                          ? 'bg-[#417150] text-white'
                          : 'text-slate-300 hover:bg-[#151b24] hover:text-[#9bd3ad]'
                        }`}
                    >
                      {codeSnippets[key].label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={copyActiveSnippet}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#242e3b] px-3 py-1.5 text-xs text-slate-300 hover:border-[#417150] hover:text-[#9bd3ad]"
                >
                  {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedCode ? 'Copied!' : 'Copy Code'}
                </button>
              </div>
              <div className="p-5">
                <div className="mb-3 text-xs font-semibold text-[#9bd3ad]">{codeSnippets[docLang].title}</div>
                <pre className="overflow-x-auto rounded-xl border border-[#1a222d] bg-[#06080b] p-4 font-mono text-xs leading-relaxed text-slate-200">
                  <code>{codeSnippets[docLang].code}</code>
                </pre>
              </div>
            </div>

            {/* Complete CRUD Endpoint Reference */}
            <div className="mt-10 enterprise-card overflow-hidden rounded-2xl">
              <div className="border-b border-[#1c2430] px-6 py-4">
                <h2 className="text-base font-bold text-slate-100">REST API CRUD Reference (/v1)</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Every operation is also available via the S3-compatible endpoint at <code className="text-[#9bd3ad]">/s3</code>.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#1c2430] bg-[#0a0e14] text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-6 py-3">Operation</th>
                      <th className="px-4 py-3">Method &amp; Endpoint</th>
                      <th className="px-6 py-3">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#171d27]">
                    {[
                      ['Create / Upsert', 'POST /v1/buckets/{bucket}/objects/upload?path=...&upsert=true', 'Upload a new file or replace an existing object.'],
                      ['Signed Upload', 'POST /v1/buckets/{bucket}/objects/sign-upload', 'Generate a temporary PUT URL for direct browser uploads.'],
                      ['List Objects', 'POST /v1/buckets/{bucket}/objects/list', 'List files and folder prefixes with cursor pagination.'],
                      ['Public Serve', 'GET /v1/public/{bucket}/{key}', 'Serve public images, videos, PDFs, and transformed assets.'],
                      ['Private Download', 'GET /v1/authenticated/{bucket}/{key}', 'Download private objects using Bearer token or ?token= signed URL.'],
                      ['Move / Copy', 'POST /v1/buckets/{bucket}/objects/move | copy', 'Rename, relocate, or duplicate objects server-side.'],
                      ['Delete Objects', 'DELETE /v1/buckets/{bucket}/objects', 'Remove one or more object keys from the bucket.'],
                    ].map(([op, ep, desc]) => (
                      <tr key={op}>
                        <td className="px-6 py-3 font-semibold text-slate-100">{op}</td>
                        <td className="px-4 py-3 font-mono text-[#9bd3ad]">{ep}</td>
                        <td className="px-6 py-3 text-slate-400">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Webhook Signature Verification */}
            <div className="mt-10 enterprise-card rounded-2xl p-6">
              <h2 className="text-base font-bold text-slate-100">Verifying Webhook Signatures</h2>
              <p className="mt-1 text-xs text-slate-400">
                Every webhook POST includes <code className="text-[#9bd3ad]">X-Serevox-Signature</code> and{' '}
                <code className="text-[#9bd3ad]">X-Serevox-Timestamp</code>. Verify them in one call with{' '}
                <code className="text-[#9bd3ad]">verifySerevoxWebhook()</code>:
              </p>
              <pre className="mt-4 overflow-x-auto rounded-xl border border-[#1a222d] bg-[#06080b] p-4 font-mono text-xs leading-relaxed text-slate-200">
                <code>{`import { verifySerevoxWebhook } from '@serevox/sdk';

const isValid = await verifySerevoxWebhook({
  secret: process.env.SEREVOX_WEBHOOK_SECRET!,
  signatureHeader: req.headers['x-serevox-signature'],
  timestampHeader: req.headers['x-serevox-timestamp'],
  rawBody: await req.text(),
});`}</code>
              </pre>
            </div>
          </section>
        )}

        {page === 'pricing' && (
          <section className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">Pricing</div>
              <h1 className="mt-2 text-3xl font-extrabold text-slate-50 sm:text-4xl">
                Simple, Predictable Pricing for Any Scale
              </h1>
              <p className="mt-3 text-sm text-slate-300">
                Start free locally or on your own VPS with zero egress fees, and scale up anytime.
              </p>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {[
                {
                  id: 'free',
                  name: 'Self-Hosted Core',
                  price: 'Free',
                  amount: 0,
                  sub: 'Full source + single Go binary',
                  highlight: false,
                  cta: 'Start Free Locally',
                  items: [
                    'Unlimited Buckets & Objects (disk-bound)',
                    'REST API (/v1) & S3 SigV4 (/s3)',
                    'On-the-Fly Image Resize & Disk Cache',
                    'Admin Control Center & Multi-Tenant RBAC',
                  ],
                },
                {
                  id: 'edge',
                  name: 'Edge Hybrid',
                  price: 'Rp 149.000',
                  amount: 149000,
                  sub: 'per month • Serevox + CDN Edge',
                  highlight: true,
                  cta: 'Upgrade to Edge Hybrid',
                  items: [
                    'Zero Origin Egress via Edge Caching',
                    'Automatic WebP & JPEG Optimization',
                    'Custom CDN Domains & Auto SSL',
                    'Prometheus /metrics & Telemetry',
                  ],
                },
                {
                  id: 'enterprise',
                  name: 'Enterprise Cluster',
                  price: 'Rp 799.000',
                  amount: 799000,
                  sub: 'per month • For teams & heavy storage',
                  highlight: false,
                  cta: 'Deploy Enterprise Cluster',
                  items: [
                    'Everything in Edge Hybrid',
                    'Unlimited Dedicated Webhook Pipelines',
                    'Full Audit Trail & Security Alerts',
                    'Dedicated SLA & 24/7 Architecture Support',
                  ],
                },
              ].map((tier) => (
                <div
                  key={tier.name}
                  className={`card-3d-tilt enterprise-card flex flex-col justify-between rounded-2xl p-6 ${tier.highlight ? 'border-[#417150] ring-1 ring-[#417150]/50' : ''
                    }`}
                >
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-[#84c498]">{tier.name}</div>
                    <div className="mt-2 text-3xl font-extrabold text-slate-50">{tier.price}</div>
                    <div className="mt-1 text-xs text-slate-400">{tier.sub}</div>
                    <ul className="mt-6 space-y-2.5 text-xs text-slate-300">
                      {tier.items.map((it) => (
                        <li key={it} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#84c498]" />
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    type="button"
                    disabled={checkoutLoading === tier.id}
                    onClick={() => handleCheckout(tier.id, tier.amount)}
                    className={`mt-8 w-full rounded-xl py-2.5 text-xs font-bold transition ${tier.highlight
                        ? 'bg-[#417150] text-white hover:bg-[#4e855f] disabled:opacity-50'
                        : 'border border-[#273242] bg-[#0e131a] text-slate-200 hover:border-[#417150] disabled:opacity-50'
                      }`}
                  >
                    {checkoutLoading === tier.id ? 'Loading Snap...' : tier.cta}
                  </button>
                </div>
              ))}
            </div>

            {/* Pricing FAQ */}
            <div className="mt-14">
              <h2 className="text-center text-2xl font-extrabold text-slate-50">Frequently Asked Questions</h2>
              <div className="mt-8 grid gap-5 md:grid-cols-2">
                {[
                  {
                    q: 'Can I display photos and videos locally right now?',
                    a: `Yes. Every file uploaded to a Public bucket is immediately served at ${publicUrl}/v1/public/{bucket}/{key} with full Content-Type, ETag, and HTTP Range streaming.`,
                  },
                  {
                    q: 'Do my website users need to open the Serevox Console?',
                    a: 'No. Your web app uploads, updates, lists, and serves files via REST API, S3 API, or Signed URLs completely behind the scenes.',
                  },
                  {
                    q: 'Which web frameworks are supported?',
                    a: 'Any framework that speaks HTTP or S3 — including Next.js, React, Vue, Laravel, Express, Go, Django, FastAPI, and Flutter.',
                  },
                  {
                    q: 'How are API keys and secrets protected?',
                    a: 'Secrets are encrypted at rest with AES-GCM, masked by default in the Console, and only revealed after confirmation inside a 15-second auto-closing modal.',
                  },
                ].map((faq) => (
                  <div key={faq.q} className="enterprise-card rounded-2xl p-5">
                    <h3 className="text-sm font-bold text-slate-100">{faq.q}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">{faq.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Enterprise Footer */}
      <footer className="mt-16 border-t border-[#19212c] bg-[#06080b] py-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <img src="/LOGO-SEREVOX.png" alt="Serevox logo" className="h-10 w-auto object-contain" />
            <div>
              <div className="text-sm font-bold text-slate-100">SEREVOX OBJECT STORAGE</div>
              <div className="text-xs text-slate-400">Active endpoint: {publicUrl}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-slate-400">
            {navPages.map((p) => (
              <button key={p.id} type="button" onClick={() => navigateTo(p.id)} className="hover:text-[#9bd3ad]">
                {p.label}
              </button>
            ))}
            <button type="button" onClick={() => onEnterConsole('login')} className="text-[#9bd3ad] hover:underline">
              Console Login
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
