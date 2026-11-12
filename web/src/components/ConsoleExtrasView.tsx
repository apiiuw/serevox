import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Check,
  Copy,
  Database,
  HardDrive,
  Image as ImageIcon,
  Settings,
  Sliders,
  ShieldAlert,
  Clock,
  Terminal,
} from 'lucide-react';
import { apiFetch, AuditLog, Bucket, formatBytes, Project, ProjectMetrics, StorageObject } from '../api';

export function ImageStudioView({ projectId, publicUrl }: { projectId: string; publicUrl: string }) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState('');
  const [images, setImages] = useState<StorageObject[]>([]);
  const [selectedKey, setSelectedKey] = useState('');

  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(400);
  const [fit, setFit] = useState<'cover' | 'contain' | 'fill'>('cover');
  const [quality, setQuality] = useState(82);
  const [format, setFormat] = useState<'jpeg' | 'png' | 'gif'>('jpeg');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch<{ buckets: Bucket[] }>(`/projects/${projectId}/buckets`)
      .then((res) => {
        const pub = res.buckets.filter((b) => b.visibility === 'public');
        const list = pub.length > 0 ? pub : res.buckets;
        setBuckets(list);
        if (list[0]) setSelectedBucket(list[0].id);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!selectedBucket) return;
    apiFetch<{ objects: StorageObject[] }>(`/buckets/${selectedBucket}/objects?limit=200`)
      .then((res) => {
        const imgs = res.objects.filter(
          (o) => o.mime_type.startsWith('image/') && o.mime_type !== 'image/svg+xml'
        );
        setImages(imgs);
        setSelectedKey(imgs[0]?.key ?? '');
      })
      .catch(() => {});
  }, [selectedBucket]);

  const activeBucketObj = buckets.find((b) => b.id === selectedBucket);
  const previewUrl = useMemo(() => {
    if (!activeBucketObj || !selectedKey) return '';
    const qs = new URLSearchParams({
      w: String(width),
      h: String(height),
      fit,
      q: String(quality),
      format,
    });
    return `${publicUrl}/v1/public/${encodeURIComponent(activeBucketObj.name)}/${selectedKey}?${qs.toString()}`;
  }, [activeBucketObj, selectedKey, publicUrl, width, height, fit, quality, format]);

  function copyUrl() {
    if (!previewUrl) return;
    navigator.clipboard.writeText(previewUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
          <Sliders className="h-5 w-5 text-[#84c498]" />
          On-the-Fly Image Studio
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Resize, crop, optimize quality, and convert image formats on the fly via URL query parameters.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="enterprise-card space-y-4 rounded-2xl p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Bucket (Public Recommended)</label>
            <select
              value={selectedBucket}
              onChange={(e) => setSelectedBucket(e.target.value)}
              className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-xs text-slate-100"
            >
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.visibility})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Image Object</label>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-xs text-slate-100"
            >
              {images.length === 0 ? (
                <option value="">No images found in this bucket</option>
              ) : (
                images.map((img) => (
                  <option key={img.id} value={img.key}>
                    {img.key} ({formatBytes(img.size_bytes)})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Width (px)</label>
              <input
                type="number"
                min={16}
                max={4096}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value) || 100)}
                className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Height (px)</label>
              <input
                type="number"
                min={16}
                max={4096}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value) || 100)}
                className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-xs text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Fit Mode</label>
              <select
                value={fit}
                onChange={(e) => setFit(e.target.value as 'cover' | 'contain' | 'fill')}
                className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-xs text-slate-100"
              >
                <option value="cover">cover</option>
                <option value="contain">contain</option>
                <option value="fill">fill</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Output Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as 'jpeg' | 'png' | 'gif')}
                className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-xs text-slate-100"
              >
                <option value="jpeg">jpeg</option>
                <option value="png">png</option>
                <option value="gif">gif</option>
              </select>
            </div>
          </div>

          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-slate-300">Quality</span>
              <span className="font-mono text-[#9bd3ad]">{quality}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div className="enterprise-card flex flex-col justify-between rounded-2xl p-5">
          {previewUrl && activeBucketObj?.visibility === 'public' ? (
            <>
              <div className="flex min-h-[280px] items-center justify-center overflow-hidden rounded-xl border border-[#1d2531] bg-[#07090d] p-4">
                <img
                  src={previewUrl}
                  alt={selectedKey}
                  className="max-h-[340px] rounded-lg object-contain shadow-lg"
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#202936] bg-[#080b0f] p-3">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-[#9bd3ad]">{previewUrl}</code>
                <button
                  type="button"
                  onClick={copyUrl}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#417150] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4e855f]"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy Transform URL'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex min-h-[300px] flex-col items-center justify-center text-center text-xs text-slate-400">
              <ImageIcon className="mb-2 h-8 w-8 text-slate-500" />
              <p className="font-semibold text-slate-300">Select an image from a Public bucket for live preview</p>
              <p className="mt-1 max-w-sm">
                Upload an image (JPG/PNG/WebP) in Buckets &amp; Files first, then test on-the-fly transforms here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function UsageMetricsView({
  project,
  metrics,
}: {
  project?: Project;
  metrics: ProjectMetrics | null;
}) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  useEffect(() => {
    if (!project?.id) return;
    apiFetch<{ buckets: Bucket[] }>(`/projects/${project.id}/buckets`)
      .then((res) => setBuckets(res.buckets))
      .catch(() => {});
  }, [project?.id]);

  const totalBytes = metrics?.total_bytes ?? 0;
  const quotaBytes = project?.storage_quota_bytes && project.storage_quota_bytes > 0 ? project.storage_quota_bytes : 0;
  const quotaPct = quotaBytes > 0 ? Math.min(100, Math.round((totalBytes / quotaBytes) * 100)) : 0;
  const totalTraffic = (metrics?.ingress_bytes ?? 0) + (metrics?.egress_bytes ?? 0);
  const ingressPct = totalTraffic > 0 ? Math.round(((metrics?.ingress_bytes ?? 0) / totalTraffic) * 100) : 50;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
          <BarChart3 className="h-5 w-5 text-[#84c498]" />
          Usage, Quota &amp; Traffic Telemetry
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Detailed storage capacity usage, 30-day ingress/egress traffic, and per-bucket distribution.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="enterprise-card rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-[#84c498]" /> Storage Quota Utilization
            </span>
            <span className="font-mono text-[#9bd3ad]">
              {formatBytes(totalBytes)} / {quotaBytes > 0 ? formatBytes(quotaBytes) : 'Unlimited'}
            </span>
          </div>
          <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-[#151c26]">
            <div
              className="h-full rounded-full bg-[#417150] transition-all"
              style={{ width: `${quotaBytes > 0 ? Math.max(4, quotaPct) : 18}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {metrics?.total_objects ?? 0} objects stored across {metrics?.total_buckets ?? 0} active buckets.
          </div>
        </div>

        <div className="enterprise-card rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#84c498]" /> 30-Day Ingress vs Egress
            </span>
            <span className="font-mono text-[#9bd3ad]">{metrics?.request_count ?? 0} requests</span>
          </div>
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-[#151c26]">
            <div className="h-full bg-[#417150]" style={{ width: `${ingressPct}%` }} />
            <div className="h-full bg-[#84c498]" style={{ width: `${100 - ingressPct}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-400">
            <span>Ingress (Upload): {formatBytes(metrics?.ingress_bytes ?? 0)}</span>
            <span>Egress (Download): {formatBytes(metrics?.egress_bytes ?? 0)}</span>
          </div>
        </div>
      </div>

      <div className="enterprise-card overflow-hidden rounded-2xl">
        <div className="border-b border-[#1b222d] px-5 py-3.5 text-sm font-bold text-slate-100">
          Storage Distribution by Bucket
        </div>
        <div className="divide-y divide-[#171d27]">
          {buckets.map((b) => {
            const bBytes = b.total_bytes ?? 0;
            const pct = totalBytes > 0 ? Math.round((bBytes / totalBytes) * 100) : 0;
            return (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 text-xs">
                <div className="flex items-center gap-2.5">
                  <Database className="h-4 w-4 text-[#84c498]" />
                  <span className="font-mono font-semibold text-slate-100">{b.name}</span>
                  <span className="rounded-full bg-[#161e29] px-2 py-0.5 text-[10px] text-slate-300">
                    {b.visibility}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-slate-400">{b.object_count ?? 0} objects</span>
                  <span className="w-20 text-right font-mono text-[#9bd3ad]">{formatBytes(bBytes)}</span>
                  <span className="w-10 text-right text-slate-400">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ProjectSettingsView({
  project,
  publicUrl,
  onProjectUpdated,
}: {
  project?: Project;
  publicUrl: string;
  onProjectUpdated?: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState('');
  const [projectName, setProjectName] = useState(project?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    setProjectName(project?.name ?? '');
    setSaveMsg('');
    setSaveErr('');
  }, [project?.id, project?.name]);

  function copyVal(label: string, val: string) {
    navigator.clipboard.writeText(val);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(''), 1800);
  }

  async function handleRenameProject(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    setSaving(true);
    setSaveMsg('');
    setSaveErr('');
    try {
      await apiFetch(`/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: projectName.trim() }),
      });
      setSaveMsg('Project name updated successfully.');
      onProjectUpdated?.();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to rename project');
    } finally {
      setSaving(false);
    }
  }

  if (!project) return null;

  const rows = [
    { label: 'Project ID', value: project.id },
    { label: 'Project Name', value: project.name },
    { label: 'Project Slug', value: project.slug },
    { label: 'Workspace ID', value: project.workspace_id },
    { label: 'REST API Base URL', value: `${publicUrl}/v1` },
    { label: 'S3 Endpoint URL', value: `${publicUrl}/s3` },
    { label: 'Default S3 Region', value: 'us-east-1' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
          <Settings className="h-5 w-5 text-[#84c498]" />
          Project Settings &amp; Endpoints
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Rename your project and copy S3/REST endpoint configurations for your application.
        </p>
      </div>

      <form onSubmit={handleRenameProject} className="enterprise-card rounded-2xl p-5 space-y-3">
        <div className="text-sm font-bold text-slate-100">Rename Project</div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="min-w-[240px] flex-1 rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-sm text-slate-100"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#417150] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4e855f] disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Project Name'}
          </button>
        </div>
        {saveMsg && <p className="text-xs text-[#9bd3ad]">{saveMsg}</p>}
        {saveErr && <p className="text-xs text-red-400">{saveErr}</p>}
      </form>

      <div className="enterprise-card divide-y divide-[#171d27] overflow-hidden rounded-2xl">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-xs">
            <span className="font-medium text-slate-400">{r.label}</span>
            <div className="flex items-center gap-2">
              <code className="rounded bg-[#090d12] px-2.5 py-1 font-mono text-[#9bd3ad]">{r.value}</code>
              <button
                type="button"
                onClick={() => copyVal(r.label, r.value)}
                className="rounded-lg border border-[#242e3b] p-1.5 text-slate-400 hover:border-[#417150] hover:text-[#9bd3ad]"
              >
                {copiedKey === r.label ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        ))}
      </div>

      <ProjectAuditTrailView projectId={project.id} />
    </div>
  );
}

export function ProjectAuditTrailView({ projectId }: { projectId: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    apiFetch<{ audit_logs: AuditLog[] }>(`/projects/${projectId}/audit-logs`)
      .then((res) => setLogs(res.audit_logs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div className="enterprise-card rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[#84c498]" />
          <h3 className="text-sm font-bold text-slate-100">Audit Trail &amp; Activity Log</h3>
        </div>
        <span className="text-[11px] text-slate-500">Real-time Security Logs</span>
      </div>

      <div className="space-y-2 text-xs">
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#1b222c] bg-[#07090d] px-4 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#417150]/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[#9bd3ad]">
                {log.action}
              </span>
              <span className="font-mono text-slate-300">{log.target}</span>
              <span className="text-slate-500">by {log.actor_email}</span>
            </div>
            <div className="flex items-center gap-3 text-slate-400 text-[11px]">
              {log.ip_address && <span>IP: {log.ip_address}</span>}
              <span>{new Date(log.created_at).toLocaleString()}</span>
            </div>
          </div>
        ))}

        {logs.length === 0 && (
          <p className="py-6 text-center text-slate-500">
            {loading ? 'Memuat audit log...' : 'Belum ada aktivitas audit log yang tercatat untuk project ini.'}
          </p>
        )}
      </div>
    </div>
  );
}

