import React, { useState } from 'react';
import { Play, Send, Check, Copy, CornerDownRight, Terminal } from 'lucide-react';
import { getToken } from '../api';

interface ApiSimulatorProps {
  publicUrl: string;
}

export function ApiSimulatorView({ publicUrl }: ApiSimulatorProps) {
  const [method, setMethod] = useState<'GET' | 'POST' | 'DELETE'>('GET');
  const [endpoint, setEndpoint] = useState('/console/api/auth/me');
  const [headerType, setHeaderType] = useState<'console' | 'none'>('console');
  const [loading, setLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [responseBody, setResponseBody] = useState<string>('');
  const [copied, setCopied] = useState(false);

  async function handleSend() {
    setLoading(true);
    setResponseStatus(null);
    setResponseBody('');
    try {
      const headers: Record<string, string> = {};
      if (headerType === 'console') {
        headers['Authorization'] = `Bearer ${getToken()}`;
      }
      const fullUrl = endpoint.startsWith('http') ? endpoint : `${window.location.origin}${endpoint}`;
      const res = await fetch(fullUrl, {
        method,
        headers,
      });
      setResponseStatus(res.status);
      const hdrs: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        hdrs[k] = v;
      });
      setResponseHeaders(hdrs);

      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        setResponseBody(JSON.stringify(parsed, null, 2));
      } catch {
        setResponseBody(text);
      }
    } catch (err) {
      setResponseStatus(0);
      setResponseBody(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  function copyResponse() {
    navigator.clipboard.writeText(responseBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const presets = [
    { label: 'Check Auth (me)', method: 'GET' as const, path: '/console/api/auth/me' },
    { label: 'List Projects', method: 'GET' as const, path: '/console/api/projects' },
    { label: 'Platform Stats', method: 'GET' as const, path: '/console/api/admin/stats' },
  ];

  return (
    <div className="space-y-4 rounded-2xl border border-[#1e2531] bg-[#0c1017] p-5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b222d] pb-3">
        <div className="flex items-center gap-2 font-bold text-slate-100">
          <Terminal className="h-4 w-4 text-[#84c498]" />
          <span>In-Console REST API Simulator (Live Tester)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setMethod(p.method);
                setEndpoint(p.path);
              }}
              className="rounded-md bg-[#161d27] px-2 py-1 text-[11px] text-slate-300 hover:border-[#417150] hover:text-[#9bd3ad]"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Request Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as any)}
          className="rounded-lg border border-[#232c3a] bg-[#07090d] px-3 py-2 font-mono font-bold text-[#9bd3ad]"
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="DELETE">DELETE</option>
        </select>
        <input
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          className="min-w-[280px] flex-1 rounded-lg border border-[#232c3a] bg-[#07090d] px-3 py-2 font-mono text-slate-200"
          placeholder="/console/api/projects"
        />
        <button
          type="button"
          disabled={loading}
          onClick={handleSend}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#417150] px-4 py-2 font-semibold text-white hover:bg-[#4d8660] disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          {loading ? 'Sending...' : 'Send Request'}
        </button>
      </div>

      {/* Response Display */}
      {responseStatus !== null && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-slate-400">Status:</span>
              <span
                className={`rounded px-2 py-0.5 font-bold ${
                  responseStatus >= 200 && responseStatus < 300
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {responseStatus || 'NETWORK ERR'}
              </span>
            </div>
            <button
              type="button"
              onClick={copyResponse}
              className="inline-flex items-center gap-1 rounded bg-[#161d27] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy Response'}
            </button>
          </div>

          <pre className="max-h-64 overflow-auto rounded-lg border border-[#1b222d] bg-[#07090d] p-3 font-mono text-[11px] leading-relaxed text-[#b7e2c5]">
            {responseBody || '(Empty response body)'}
          </pre>
        </div>
      )}
    </div>
  );
}

