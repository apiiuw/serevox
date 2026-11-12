import React, { useCallback, useEffect, useState } from 'react';
import { Key, Plus, Trash2, Copy, Check, Webhook as WebhookIcon, Send, Code2 } from 'lucide-react';
import { apiFetch, APIKey, Webhook, WebhookDelivery } from '../api';
import { Modal } from './Modal';
import { MaskedCredential } from './SecretField';
import { ApiSimulatorView } from './ApiSimulator';

export function KeysView({ projectId }: { projectId: string }) {
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [keyType, setKeyType] = useState<'s3' | 'service_role' | 'anon'>('s3');
  const [permission, setPermission] = useState('read_write');
  const [createdSecret, setCreatedSecret] = useState<Record<string, string> | null>(null);
  const [copied, setCopied] = useState('');

  const loadKeys = useCallback(async () => {
    const res = await apiFetch<{ keys: APIKey[] }>(`/projects/${projectId}/keys`);
    setKeys(res.keys);
  }, [projectId]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch<{
      key: APIKey;
      plain_key?: string;
      access_key_id?: string;
      secret_access_key?: string;
    }>(`/projects/${projectId}/keys`, {
      method: 'POST',
      body: JSON.stringify({ name, key_type: keyType, permission }),
    });
    if (res.plain_key) {
      setCreatedSecret({ 'API Key (Bearer)': res.plain_key });
    } else if (res.access_key_id && res.secret_access_key) {
      setCreatedSecret({
        'S3 Access Key ID': res.access_key_id,
        'S3 Secret Access Key': res.secret_access_key,
      });
    }
    setCreateOpen(false);
    setName('');
    loadKeys();
  }

  async function revokeKey(id: string) {
    await apiFetch(`/projects/${projectId}/keys/${id}`, { method: 'DELETE' });
    loadKeys();
  }

  function copyVal(label: string, val: string) {
    navigator.clipboard.writeText(val);
    setCopied(label);
    setTimeout(() => setCopied(''), 1800);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Access Keys &amp; API Tokens</h2>
          <p className="text-xs text-slate-400">
            Manage isolated S3 Access Keys (`@aws-sdk/client-s3`) and REST Keys (`@serevox/sdk`) for this project.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#417150] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4e8660]"
        >
          <Plus className="h-4 w-4" /> Generate Key
        </button>
      </div>

      {createdSecret && (
        <div className="rounded-xl border border-[#417150]/60 bg-[#417150]/20 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-[#a3d7b3]">
              Save Your Secret Key Now (displayed once)
            </span>
            <button
              type="button"
              onClick={() => setCreatedSecret(null)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2">
            {Object.entries(createdSecret).map(([k, v]) => (
              <div key={k} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#0b0d10] px-3 py-2">
                <div className="text-[11px] font-medium text-slate-300">{k}</div>
                <MaskedCredential label={k} value={v} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div tabIndex={0} role="region" aria-labelledby="keys-table-caption" className="table-wrapper">
        <table className="serevox-table">
          <caption id="keys-table-caption" className="sr-only">Project API Keys</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Key / Prefix</th>
              <th scope="col">Permission</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <th scope="row" className="font-medium text-slate-100">
                  <span className="inline-flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-[#84c498]" />
                    {k.name}
                  </span>
                </th>
                <td data-label="Type" className="font-mono text-xs uppercase text-[#9bd3ad]">
                  {k.key_type}
                </td>
                <td data-label="Prefix" className="font-mono text-xs text-slate-300">
                  <MaskedCredential
                    label={`${k.name} (${k.key_type || 'key'})`}
                    onReveal={async () => {
                      const res = await apiFetch<{
                        key_type?: string;
                        plain_key?: string;
                        access_key_id?: string;
                        secret_access_key?: string;
                      }>(`/projects/${projectId}/keys/${k.id}/reveal`);
                      const effectiveType = res.key_type || k.key_type;
                      if (effectiveType === 's3') {
                        return [
                          { label: 'S3 Access Key ID', value: res.access_key_id || k.access_key_id || k.key_prefix },
                          { label: 'S3 Secret Access Key', value: res.secret_access_key ?? '' },
                        ];
                      }
                      return [{ label: `${k.name} (${effectiveType})`, value: res.plain_key || k.key_prefix }];
                    }}
                  />
                </td>
                <td data-label="Permission" className="text-xs text-slate-300">
                  {k.permission}
                </td>
                <td data-label="Status">
                  {k.revoked_at ? (
                    <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">Revoked</span>
                  ) : (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">Active</span>
                  )}
                </td>
                <td data-label="Action">
                  {!k.revoked_at && (
                    <button
                      type="button"
                      onClick={() => revokeKey(k.id)}
                      className="inline-flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3 w-3" /> Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Generate API Key">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="key-name" className="mb-1 block text-sm font-medium text-slate-200">
              Key Name
            </label>
            <input
              id="key-name"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. nextjs-production"
              className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-200">Key Type</legend>
            <div className="space-y-1.5 text-sm text-slate-300">
              <label className="flex items-center gap-2">
                <input type="radio" name="kt" checked={keyType === 's3'} onChange={() => setKeyType('s3')} />
                S3 Access Key Pair (AWS SDK / R2 / Laravel / rclone)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="kt"
                  checked={keyType === 'service_role'}
                  onChange={() => setKeyType('service_role')}
                />
                REST Service Role Key (Backend `@serevox/sdk`)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="kt" checked={keyType === 'anon'} onChange={() => setKeyType('anon')} />
                REST Public / Anon Key (Read Public Buckets Only)
              </label>
            </div>
          </fieldset>
          {keyType === 's3' && (
            <div>
              <label htmlFor="key-perm" className="mb-1 block text-sm font-medium text-slate-200">
                Permission
              </label>
              <select
                id="key-perm"
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
                className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
              >
                <option value="read_write">Read &amp; Write</option>
                <option value="read_only">Read Only</option>
                <option value="write_only">Write Only</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg border border-[#2b3340] px-4 py-2 text-sm text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#417150] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4e8660]"
            >
              Create Key
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function WebhooksView({ projectId }: { projectId: string }) {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState('');
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [selectedHookId, setSelectedHookId] = useState('');
  const [error, setError] = useState('');

  const loadHooks = useCallback(async () => {
    const res = await apiFetch<{ webhooks: Webhook[] }>(`/projects/${projectId}/webhooks`);
    setHooks(res.webhooks);
  }, [projectId]);

  useEffect(() => {
    loadHooks();
  }, [loadHooks]);

  async function addWebhook(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await apiFetch(`/projects/${projectId}/webhooks`, {
        method: 'POST',
        body: JSON.stringify({
          url,
          events: ['object.uploaded', 'object.deleted', 'multipart.completed'],
        }),
      });
      setUrl('');
      loadHooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    }
  }

  async function testWebhook(id: string) {
    await apiFetch(`/projects/${projectId}/webhooks/${id}/test`, { method: 'POST' });
    loadDeliveries(id);
  }

  async function loadDeliveries(id: string) {
    setSelectedHookId(id);
    const res = await apiFetch<{ deliveries: WebhookDelivery[] }>(`/webhooks/${id}/deliveries`);
    setDeliveries(res.deliveries);
  }

  async function deleteHook(id: string) {
    await apiFetch(`/projects/${projectId}/webhooks/${id}`, { method: 'DELETE' });
    if (selectedHookId === id) {
      setSelectedHookId('');
      setDeliveries([]);
    }
    loadHooks();
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Event Webhooks</h2>
        <p className="text-xs text-slate-400">
          Send HMAC-signed HTTP notifications (`X-Serevox-Signature`) to your web app whenever objects are uploaded or deleted.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={addWebhook} className="flex flex-wrap gap-2 rounded-xl border border-[#232a35] bg-[#13171e] p-4">
        <label htmlFor="wh-url" className="sr-only">
          Webhook Endpoint URL
        </label>
        <input
          id="wh-url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-webapp.com/api/webhooks/serevox"
          className="min-w-[260px] flex-1 rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#417150] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4e8660]"
        >
          <Plus className="h-4 w-4" /> Add Webhook
        </button>
      </form>

      <div className="space-y-2">
        {hooks.map((w) => (
          <div
            key={w.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#232a35] bg-[#13171e] px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-mono text-xs text-[#9bd3ad]">
                <WebhookIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{w.url}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-400">
                <span>Secret:</span>
                <MaskedCredential label={`Webhook Secret (${w.url})`} value={w.secret ?? ''} />
                <span>· Events: {w.events.join(', ')}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => testWebhook(w.id)}
                className="inline-flex items-center gap-1 rounded border border-[#417150]/60 px-2.5 py-1 text-xs text-[#9bd3ad] hover:bg-[#417150]/20"
              >
                <Send className="h-3 w-3" /> Test Ping
              </button>
              <button
                type="button"
                onClick={() => loadDeliveries(w.id)}
                className="rounded border border-[#2b3340] px-2.5 py-1 text-xs text-slate-300 hover:text-slate-100"
              >
                Logs
              </button>
              <button
                type="button"
                onClick={() => deleteHook(w.id)}
                className="rounded border border-red-500/30 p-1.5 text-red-400 hover:bg-red-500/10"
                aria-label="Delete webhook"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedHookId && (
        <div className="rounded-xl border border-[#232a35] bg-[#13171e] p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">Recent Deliveries</h3>
          <div className="space-y-2 text-xs">
            {deliveries.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg bg-[#0b0d10] px-3 py-2">
                <div>
                  <span className={d.success ? 'text-emerald-400' : 'text-red-400'}>
                    {d.success ? 'OK' : 'FAIL'} ({d.status_code || 'ERR'})
                  </span>{' '}
                  <span className="font-mono text-slate-300">{d.event_type}</span>{' '}
                  <span className="text-slate-500">attempt #{d.attempt}</span>
                </div>
                <span className="text-slate-500">{new Date(d.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
            {deliveries.length === 0 && <p className="text-slate-500">No delivery history yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function IntegrationHubView({ publicUrl }: { publicUrl: string }) {
  const [tab, setTab] = useState<'env' | 'sdk' | 's3' | 'laravel' | 'nextjs'>('env');
  const [copied, setCopied] = useState(false);

  const snippets: Record<typeof tab, { title: string; code: string }> = {
    env: {
      title: '.env (Universal Web App Config)',
      code: `# Serevox Native REST / @serevox/sdk
SEREVOX_URL=${publicUrl}
SEREVOX_SERVICE_KEY=srx_srv_your_secret_key

# S3-Compatible (Cloudflare R2 / AWS S3 Drop-in)
S3_ENDPOINT=${publicUrl}
S3_REGION=us-east-1
S3_BUCKET=serevox-public
S3_ACCESS_KEY_ID=SRX_YOUR_ACCESS_KEY
S3_SECRET_ACCESS_KEY=your_s3_secret_key`,
    },
    sdk: {
      title: 'TypeScript / Next.js / React (@serevox/sdk)',
      code: `import { createSerevoxClient } from '@serevox/sdk';

const serevox = createSerevoxClient({
  url: process.env.SEREVOX_URL!,
  apiKey: process.env.SEREVOX_SERVICE_KEY!,
});

// 1. Direct upload
await serevox.from('serevox-public').upload('avatars/user-1.png', file, { upsert: true });

// 2. Public CDN URL + On-the-fly resize
const avatarUrl = serevox.from('serevox-public').getPublicUrl('avatars/user-1.png', {
  transform: { width: 256, height: 256, fit: 'cover', format: 'jpeg', quality: 85 },
});

// 3. Direct browser upload using presigned URL
const { data } = await serevox.from('private-docs').createSignedUploadUrl('invoices/inv-01.pdf', {
  expiresIn: 600,
});`,
    },
    s3: {
      title: 'AWS SDK v3 (@aws-sdk/client-s3)',
      code: `import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: '${publicUrl}',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

await s3.send(new PutObjectCommand({
  Bucket: 'serevox-public',
  Key: 'uploads/banner.png',
  Body: fileBuffer,
  ContentType: 'image/png',
}));`,
    },
    laravel: {
      title: 'Laravel config/filesystems.php (S3 Driver)',
      code: `'serevox' => [
    'driver' => 's3',
    'key' => env('S3_ACCESS_KEY_ID'),
    'secret' => env('S3_SECRET_ACCESS_KEY'),
    'region' => env('S3_REGION', 'us-east-1'),
    'bucket' => env('S3_BUCKET'),
    'endpoint' => env('S3_ENDPOINT', '${publicUrl}'),
    'use_path_style_endpoint' => true,
],`,
    },
    nextjs: {
      title: 'Next.js Custom Image Loader',
      code: `// lib/serevoxImageLoader.ts
export default function serevoxImageLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  const clean = src.replace(/^\\/+/, '');
  return \`${publicUrl}/v1/public/serevox-public/\${clean}?w=\${width}&q=\${quality || 80}&format=jpeg\`;
}`,
    },
  };

  function copyCode() {
    navigator.clipboard.writeText(snippets[tab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Code2 className="h-5 w-5 text-[#84c498]" />
        <div>
          <h2 className="text-base font-semibold text-slate-100">Developer Integration Hub</h2>
          <p className="text-xs text-slate-400">
            Sambungkan Serevox ke web app Anda menggunakan S3-compatible SDK atau `@serevox/sdk`.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['env', '.env'],
            ['sdk', '@serevox/sdk'],
            ['s3', '@aws-sdk/client-s3'],
            ['laravel', 'Laravel S3'],
            ['nextjs', 'Next.js Image'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === id
                ? 'bg-[#417150] text-white'
                : 'border border-[#232a35] bg-[#13171e] text-slate-300 hover:border-[#417150]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#232a35] bg-[#0b0d10]">
        <div className="flex items-center justify-between border-b border-[#1c222b] bg-[#13171e] px-4 py-2.5">
          <span className="text-xs font-medium text-slate-300">{snippets[tab].title}</span>
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex items-center gap-1.5 rounded border border-[#2b3340] px-2.5 py-1 text-xs text-slate-200 hover:border-[#417150]"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-[#a3d7b3]">
          <code>{snippets[tab].code}</code>
        </pre>
      </div>

      <ApiSimulatorView publicUrl={publicUrl} />
    </div>
  );
}

