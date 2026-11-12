import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Clock,
  Code2,
  Database,
  FileText,
  FolderOpen,
  HardDrive,
  Key,
  PieChart,
  Sliders,
  TrendingUp,
} from 'lucide-react';
import { apiFetch, Bucket, DailyUsagePoint, formatBytes, Project, ProjectMetrics } from '../api';

interface OverviewViewProps {
  project?: Project;
  metrics: ProjectMetrics | null;
  onNavigate: (tab: 'explorer' | 'transforms' | 'keys' | 'integration') => void;
}

const MIME_COLORS: Record<string, string> = {
  Images: '#417150',
  Media: '#84c498',
  Documents: '#38bdf8',
  Other: '#94a3b8',
};

export function OverviewView({ project, metrics, onNavigate }: OverviewViewProps) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [hoverDay, setHoverDay] = useState<DailyUsagePoint | null>(null);

  useEffect(() => {
    if (!project?.id) return;
    apiFetch<{ buckets: Bucket[] }>(`/projects/${project.id}/buckets`)
      .then((res) => setBuckets(res.buckets))
      .catch(() => {});
  }, [project?.id, metrics?.total_buckets, metrics?.total_objects]);

  const daily = metrics?.daily_usage ?? [];
  const maxTraffic = Math.max(
    1024,
    ...daily.map((d) => Math.max(d.ingress_bytes, d.egress_bytes))
  );

  const mimeList = metrics?.mime_breakdown ?? [];
  const mimeTotalBytes = Math.max(
    1,
    mimeList.reduce((acc, m) => acc + m.bytes, 0)
  );

  const recentObjects = metrics?.recent_objects ?? [];
  const totalProjectBytes = Math.max(1, metrics?.total_bytes ?? 0);

  // Build SVG Donut segments
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let cumulativePct = 0;
  const donutSegments = mimeList.map((m) => {
    const pct = m.bytes / mimeTotalBytes;
    const dashArray = `${pct * circumference} ${circumference}`;
    const dashOffset = -cumulativePct * circumference;
    cumulativePct += pct;
    return {
      ...m,
      pct: Math.round(pct * 100),
      color: MIME_COLORS[m.category] ?? '#64748b',
      dashArray,
      dashOffset,
    };
  });

  // Build SVG Area/Line chart coordinates (viewBox 640 x 200)
  const chartW = 640;
  const chartH = 190;
  const padL = 12;
  const padR = 12;
  const padT = 16;
  const padB = 26;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const ingressPoints = daily.map((d, i) => {
    const x = daily.length > 1 ? padL + (i / (daily.length - 1)) * plotW : padL + plotW / 2;
    const y = padT + plotH - (d.ingress_bytes / maxTraffic) * plotH;
    return { x, y, d };
  });

  const egressPoints = daily.map((d, i) => {
    const x = daily.length > 1 ? padL + (i / (daily.length - 1)) * plotW : padL + plotW / 2;
    const y = padT + plotH - (d.egress_bytes / maxTraffic) * plotH;
    return { x, y, d };
  });

  const toPolyline = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const toArea = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    const line = pts.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return `M ${pts[0].x.toFixed(1)} ${padT + plotH} ${line} L ${pts[pts.length - 1].x.toFixed(1)} ${padT + plotH} Z`;
  };

  return (
    <div className="space-y-6">
      {/* Telemetry KPIs */}
      <section aria-label="Storage telemetry" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Total Storage Used',
            value: formatBytes(metrics?.total_bytes ?? 0),
            sub: `${metrics?.total_objects ?? 0} objects stored`,
            icon: HardDrive,
          },
          {
            label: 'Active Buckets',
            value: String(metrics?.total_buckets ?? 0),
            sub: 'Public CDN & private vaults',
            icon: Database,
          },
          {
            label: '30d Ingress Traffic',
            value: formatBytes(metrics?.ingress_bytes ?? 0),
            sub: 'Uploads & multipart assembly',
            icon: Activity,
          },
          {
            label: '30d Egress Traffic',
            value: formatBytes(metrics?.egress_bytes ?? 0),
            sub: `${metrics?.request_count ?? 0} total I/O requests`,
            icon: TrendingUp,
          },
        ].map((card) => (
          <div key={card.label} className="enterprise-card rounded-xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>{card.label}</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#417150]/20 text-[#84c498]">
                <card.icon className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-extrabold tracking-tight text-slate-50">{card.value}</div>
            <div className="mt-1 text-xs text-slate-400">{card.sub}</div>
          </div>
        ))}
      </section>

      {/* Main Analytics Charts Row */}
      <section className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        {/* 14-Day Traffic Area Chart */}
        <div className="enterprise-card rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
                <TrendingUp className="h-4 w-4 text-[#84c498]" />
                14-Day Ingress &amp; Egress Traffic
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Daily upload (Ingress) and download/stream (Egress) traffic volume.
              </p>
            </div>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full bg-[#417150]" /> Ingress
              </span>
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full bg-[#84c498]" /> Egress
              </span>
            </div>
          </div>

          <div className="relative rounded-xl border border-[#1a222d] bg-[#080b0f] p-3">
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="h-52 w-full overflow-visible">
              <defs>
                <linearGradient id="ingGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#417150" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#417150" stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id="egrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#84c498" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#84c498" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Horizontal grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((r) => {
                const y = padT + r * plotH;
                return (
                  <line
                    key={r}
                    x1={padL}
                    x2={chartW - padR}
                    y1={y}
                    y2={y}
                    stroke="#18202b"
                    strokeDasharray="3 3"
                  />
                );
              })}

              {ingressPoints.length > 0 && (
                <>
                  <path d={toArea(ingressPoints)} fill="url(#ingGrad)" />
                  <path d={toArea(egressPoints)} fill="url(#egrGrad)" />
                  <polyline
                    fill="none"
                    stroke="#417150"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    points={toPolyline(ingressPoints)}
                  />
                  <polyline
                    fill="none"
                    stroke="#84c498"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    points={toPolyline(egressPoints)}
                  />
                </>
              )}

              {/* Interactive points & date labels */}
              {daily.map((d, i) => {
                const x = daily.length > 1 ? padL + (i / (daily.length - 1)) * plotW : padL + plotW / 2;
                const showLabel = i === 0 || i === Math.floor(daily.length / 2) || i === daily.length - 1;
                return (
                  <g key={d.date}>
                    {showLabel && (
                      <text
                        x={x}
                        y={chartH - 6}
                        textAnchor={i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'}
                        fill="#64748b"
                        fontSize="10"
                      >
                        {d.date.slice(5)}
                      </text>
                    )}
                    <rect
                      x={x - 16}
                      y={padT}
                      width="32"
                      height={plotH}
                      fill="transparent"
                      onMouseEnter={() => setHoverDay(d)}
                      onMouseLeave={() => setHoverDay(null)}
                    />
                    {hoverDay?.date === d.date && (
                      <line x1={x} x2={x} y1={padT} y2={padT + plotH} stroke="#84c498" strokeOpacity="0.4" />
                    )}
                  </g>
                );
              })}
            </svg>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#141b24] pt-2 text-[11px] text-slate-400">
              {hoverDay ? (
                <>
                  <span className="font-mono text-slate-200">{hoverDay.date}</span>
                  <span>
                    Ingress: <strong className="text-[#9bd3ad]">{formatBytes(hoverDay.ingress_bytes)}</strong> ·
                    Egress: <strong className="text-[#9bd3ad]">{formatBytes(hoverDay.egress_bytes)}</strong> ·
                    Requests: <strong className="text-slate-200">{hoverDay.requests}</strong>
                  </span>
                </>
              ) : (
                <span>Hover over the chart to inspect daily traffic metrics.</span>
              )}
            </div>
          </div>
        </div>

        {/* MIME Category Donut Chart */}
        <div className="enterprise-card flex flex-col justify-between rounded-2xl p-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
              <PieChart className="h-4 w-4 text-[#84c498]" />
              Storage Breakdown by File Type
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">File type distribution across this project.</p>
          </div>

          <div className="my-4 flex flex-col items-center gap-5 sm:flex-row">
            <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
              <svg viewBox="0 0 130 130" className="h-full w-full -rotate-90">
                <circle cx="65" cy="65" r={radius} fill="none" stroke="#161e29" strokeWidth="14" />
                {donutSegments.map((seg) => (
                  <circle
                    key={seg.category}
                    cx="65"
                    cy="65"
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="14"
                    strokeDasharray={seg.dashArray}
                    strokeDashoffset={seg.dashOffset}
                  />
                ))}
              </svg>
              <div className="absolute text-center">
                <div className="text-xs font-extrabold text-slate-100">{formatBytes(metrics?.total_bytes ?? 0)}</div>
                <div className="text-[10px] text-slate-400">{metrics?.total_objects ?? 0} files</div>
              </div>
            </div>

            <div className="w-full space-y-2.5 text-xs">
              {donutSegments.length === 0 ? (
                <div className="text-slate-400">No files uploaded yet.</div>
              ) : (
                donutSegments.map((seg) => (
                  <div key={seg.category} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-slate-200">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                      {seg.category} <span className="text-slate-500">({seg.count})</span>
                    </span>
                    <span className="font-mono text-[#9bd3ad]">
                      {formatBytes(seg.bytes)} ({seg.pct}%)
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-[#1b222d] pt-3">
            <button
              type="button"
              onClick={() => onNavigate('explorer')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#417150] px-3 py-2 text-xs font-semibold text-white hover:bg-[#4e855f]"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Upload File
            </button>
            <button
              type="button"
              onClick={() => onNavigate('transforms')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#242e3b] bg-[#0c1016] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad]"
            >
              <Sliders className="h-3.5 w-3.5" /> Image Studio
            </button>
          </div>
        </div>
      </section>

      {/* Bucket Storage Bar Chart + Recent Objects */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="enterprise-card rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-100">Bucket Storage Distribution</h2>
              <p className="text-xs text-slate-400">Storage capacity comparison across buckets.</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('explorer')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#9bd3ad] hover:underline"
            >
              Manage <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-3.5">
            {buckets.length === 0 ? (
              <p className="text-xs text-slate-400">No buckets created in this project yet.</p>
            ) : (
              buckets.map((b) => {
                const bBytes = b.total_bytes ?? 0;
                const pct = Math.round((bBytes / totalProjectBytes) * 100);
                return (
                  <div key={b.id} className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-mono font-semibold text-slate-100">
                        {b.name}
                        <span className="rounded-full bg-[#18202c] px-2 py-0.5 font-sans text-[10px] font-medium text-slate-300">
                          {b.visibility}
                        </span>
                      </span>
                      <span className="font-mono text-slate-300">
                        {formatBytes(bBytes)} · {b.object_count ?? 0} obj
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#151c26]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#417150] to-[#84c498]"
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Uploaded Objects */}
        <div className="enterprise-card rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
                <Clock className="h-4 w-4 text-[#84c498]" />
                Recent Objects Activity
              </h2>
              <p className="text-xs text-slate-400">Latest uploaded or updated objects.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('keys')}
                className="inline-flex items-center gap-1 rounded-lg border border-[#242e3b] px-2.5 py-1 text-[11px] text-slate-300 hover:border-[#417150] hover:text-[#9bd3ad]"
              >
                <Key className="h-3 w-3" /> Keys
              </button>
              <button
                type="button"
                onClick={() => onNavigate('integration')}
                className="inline-flex items-center gap-1 rounded-lg border border-[#242e3b] px-2.5 py-1 text-[11px] text-slate-300 hover:border-[#417150] hover:text-[#9bd3ad]"
              >
                <Code2 className="h-3 w-3" /> SDK
              </button>
            </div>
          </div>

          <div className="divide-y divide-[#171d27]">
            {recentObjects.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">
                No recent object activity. Upload your first file in Buckets &amp; Files.
              </p>
            ) : (
              recentObjects.map((ro) => (
                <div key={`${ro.bucket_name}/${ro.key}`} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-[#84c498]" />
                    <div className="min-w-0">
                      <div className="truncate font-mono font-medium text-slate-100">{ro.key}</div>
                      <div className="text-[11px] text-slate-400">
                        {ro.bucket_name} · {ro.mime_type}
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[#9bd3ad]">{formatBytes(ro.size_bytes)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

