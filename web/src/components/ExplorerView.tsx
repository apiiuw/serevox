import React, { useCallback, useEffect, useState } from 'react';
import {
  Folder,
  FileText,
  Image as ImageIcon,
  Film,
  Upload,
  Plus,
  Trash2,
  Globe,
  Lock,
  Link2,
  Eye,
  ChevronRight,
  Copy,
  Check,
  RefreshCw,
  Settings,
  FolderPlus,
  CheckSquare,
  Square,
  Code2,
} from 'lucide-react';
import { apiFetch, Bucket, formatBytes, getToken, StorageObject } from '../api';
import { Modal } from './Modal';
import { CodeSnippetGenerator } from './CodeSnippetGenerator';
import { MediaInspectorModalContent } from './MediaInspector';

interface ExplorerViewProps {
  projectId: string;
  publicUrl: string;
  onChanged: () => void;
}

export function ExplorerView({ projectId, publicUrl, onChanged }: ExplorerViewProps) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);
  const [prefix, setPrefix] = useState('');
  const [objects, setObjects] = useState<StorageObject[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');

  // Create bucket modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [newBucketVis, setNewBucketVis] = useState<'public' | 'private'>('public');
  const [newBucketMaxMB, setNewBucketMaxMB] = useState('50');
  const [newBucketMimes, setNewBucketMimes] = useState('');
  const [newBucketTTL, setNewBucketTTL] = useState('0');

  // Preview / inspector modal
  const [previewObj, setPreviewObj] = useState<StorageObject | null>(null);
  const [signedLink, setSignedLink] = useState('');
  const [copiedId, setCopiedId] = useState('');

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'object' | 'bucket'; label: string; id?: string } | null>(null);

  // Batch selection
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // New folder modal
  const [folderOpen, setFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Code snippet modal
  const [snippetObj, setSnippetObj] = useState<StorageObject | null>(null);

  // Edit bucket settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editVis, setEditVis] = useState<'public' | 'private'>('public');
  const [editMaxMB, setEditMaxMB] = useState('50');
  const [editMimes, setEditMimes] = useState('');
  const [editTTL, setEditTTL] = useState('0');
  const [editCorsOrigins, setEditCorsOrigins] = useState('*');
  const [editDomain, setEditDomain] = useState('');

  const loadBuckets = useCallback(async () => {
    try {
      const res = await apiFetch<{ buckets: Bucket[] }>(`/projects/${projectId}/buckets`);
      setBuckets(res.buckets);
      setSelectedBucket((prev) => {
        if (prev && res.buckets.some((b) => b.id === prev.id)) {
          return res.buckets.find((b) => b.id === prev.id) ?? null;
        }
        return res.buckets[0] ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load buckets');
    }
  }, [projectId]);

  const loadObjects = useCallback(async (bucketId: string, currentPrefix: string) => {
    setLoadingObjects(true);
    setError('');
    try {
      const qs = new URLSearchParams({ prefix: currentPrefix, delimiter: '/' });
      const res = await apiFetch<{ objects: StorageObject[]; common_prefixes: string[] }>(
        `/buckets/${bucketId}/objects?${qs.toString()}`
      );
      setObjects(res.objects ?? []);
      setFolders(res.common_prefixes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load objects');
    } finally {
      setLoadingObjects(false);
    }
  }, []);

  useEffect(() => {
    setPrefix('');
    loadBuckets();
  }, [loadBuckets]);

  useEffect(() => {
    if (selectedBucket) {
      loadObjects(selectedBucket.id, prefix);
    } else {
      setObjects([]);
      setFolders([]);
    }
  }, [selectedBucket, prefix, loadObjects]);

  useEffect(() => {
    setSelectedKeys([]);
  }, [prefix, selectedBucket?.id]);

  function toggleSelectAll() {
    if (selectedKeys.length === objects.length) {
      setSelectedKeys([]);
    } else {
      setSelectedKeys(objects.map((o) => o.key));
    }
  }

  function toggleSelectKey(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  async function handleBatchDelete() {
    if (!selectedBucket || selectedKeys.length === 0) return;
    setBatchDeleting(true);
    try {
      await apiFetch(`/buckets/${selectedBucket.id}/objects`, {
        method: 'DELETE',
        body: JSON.stringify({ keys: selectedKeys }),
      });
      setSelectedKeys([]);
      await loadObjects(selectedBucket.id, prefix);
      await loadBuckets();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch delete failed');
    } finally {
      setBatchDeleting(false);
    }
  }

  function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    const clean = newFolderName.trim().replace(/\/+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!clean) return;
    const targetFolder = (prefix ? prefix.replace(/\/$/, '') + '/' : '') + clean + '/';
    setFolders((prev) => (prev.includes(targetFolder) ? prev : [...prev, targetFolder]));
    setPrefix(targetFolder);
    setNewFolderName('');
    setFolderOpen(false);
  }

  async function handleCreateBucket(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const maxBytes = Number(newBucketMaxMB) > 0 ? Number(newBucketMaxMB) * 1024 * 1024 : 0;
      const mimes = newBucketMimes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiFetch<{ bucket: Bucket }>(`/projects/${projectId}/buckets`, {
        method: 'POST',
        body: JSON.stringify({
          name: newBucketName.trim().toLowerCase(),
          visibility: newBucketVis,
          max_file_size: maxBytes,
          allowed_mime_types: mimes,
          lifecycle_days: Number(newBucketTTL) || 0,
        }),
      });
      setCreateOpen(false);
      setNewBucketName('');
      setNewBucketMimes('');
      await loadBuckets();
      setSelectedBucket(res.bucket);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bucket');
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!selectedBucket || files.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      for (const file of Array.from(files)) {
        fd.append('file', file);
      }
      const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
      await apiFetch(`/buckets/${selectedBucket.id}/objects/upload${qs}`, {
        method: 'POST',
        body: fd,
      });
      await loadObjects(selectedBucket.id, prefix);
      await loadBuckets();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function openBucketSettings() {
    if (!selectedBucket) return;
    setEditName(selectedBucket.name);
    setEditVis(selectedBucket.visibility);
    setEditMaxMB(selectedBucket.max_file_size > 0 ? String(Math.round(selectedBucket.max_file_size / (1024 * 1024))) : '0');
    setEditMimes((selectedBucket.allowed_mime_types ?? []).join(', '));
    setEditTTL(String(selectedBucket.lifecycle_days ?? 0));
    setEditDomain(selectedBucket.custom_domain ?? '');
    setEditCorsOrigins('*');
    setSettingsOpen(true);
  }

  async function handleSaveBucketSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBucket) return;
    setError('');
    try {
      const maxBytes = Number(editMaxMB) > 0 ? Number(editMaxMB) * 1024 * 1024 : 0;
      const mimes = editMimes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const origins = editCorsOrigins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await apiFetch(`/buckets/${selectedBucket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim().toLowerCase(),
          visibility: editVis,
          max_file_size: maxBytes,
          allowed_mime_types: mimes,
          lifecycle_days: Number(editTTL) || 0,
          custom_domain: editDomain.trim(),
          cors_rules: [
            {
              allowed_origins: origins.length ? origins : ['*'],
              allowed_methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
              allowed_headers: ['*'],
              max_age_seconds: 3600,
            },
          ],
        }),
      });
      setSettingsOpen(false);
      await loadBuckets();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update bucket');
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget || !selectedBucket) return;
    try {
      if (deleteTarget.type === 'object') {
        await apiFetch(`/buckets/${selectedBucket.id}/objects?key=${encodeURIComponent(deleteTarget.label)}`, {
          method: 'DELETE',
        });
        await loadObjects(selectedBucket.id, prefix);
      } else {
        await apiFetch(`/buckets/${selectedBucket.id}`, { method: 'DELETE' });
        setPrefix('');
        await loadBuckets();
      }
      setDeleteTarget(null);
      await loadBuckets();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function generateSignedUrl(key: string) {
    if (!selectedBucket) return;
    try {
      const res = await apiFetch<{ signed_url: string }>(`/buckets/${selectedBucket.id}/objects/sign`, {
        method: 'POST',
        body: JSON.stringify({ key, expires_in: 3600 }),
      });
      setSignedLink(res.signed_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign URL');
    }
  }

  function copyText(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 1800);
  }

  const breadcrumbs = prefix.split('/').filter(Boolean);

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      {/* Bucket Sidebar */}
      <aside className="rounded-xl border border-[#232a35] bg-[#13171e] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Buckets</h2>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1 rounded-md bg-[#417150]/25 px-2.5 py-1 text-xs font-medium text-[#9bd3ad] hover:bg-[#417150]/40"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>

        <ul className="space-y-1.5">
          {buckets.map((b) => {
            const active = selectedBucket?.id === b.id;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBucket(b);
                    setPrefix('');
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                    active
                      ? 'border border-[#417150] bg-[#417150]/20 text-[#a3d7b3]'
                      : 'border border-transparent text-slate-300 hover:bg-[#1a2029]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {b.visibility === 'public' ? (
                      <Globe className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-[#84c498]" />
                    )}
                    <span className="truncate font-medium">{b.name}</span>
                  </div>
                  <span className="ml-2 shrink-0 text-xs text-slate-500">{b.object_count ?? 0}</span>
                </button>
              </li>
            );
          })}
          {buckets.length === 0 && (
            <li className="rounded-lg border border-dashed border-[#2b3340] p-4 text-center text-xs text-slate-500">
              No buckets yet. Click <strong>New</strong> to create your first bucket.
            </li>
          )}
        </ul>
      </aside>

      {/* Main Explorer Area */}
      <section className="min-w-0 space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        {selectedBucket ? (
          <>
            {/* Bucket Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#232a35] bg-[#13171e] px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <button
                  type="button"
                  onClick={() => setPrefix('')}
                  className="font-semibold text-[#84c498] hover:underline"
                >
                  {selectedBucket.name}
                </button>
                <span className="rounded bg-[#1e242e] px-2 py-0.5 text-xs text-slate-300">
                  {selectedBucket.visibility}
                </span>
                {breadcrumbs.map((seg, idx) => {
                  const target = breadcrumbs.slice(0, idx + 1).join('/') + '/';
                  return (
                    <React.Fragment key={target}>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                      <button
                        type="button"
                        onClick={() => setPrefix(target)}
                        className="text-slate-200 hover:text-[#9bd3ad]"
                      >
                        {seg}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFolderOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#2b3340] px-3 py-2 text-xs font-medium text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad]"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-[#84c498]" />
                  New Folder
                </button>
                <button
                  type="button"
                  onClick={() => loadObjects(selectedBucket.id, prefix)}
                  className="rounded-lg border border-[#2b3340] p-2 text-slate-300 hover:border-[#417150] hover:text-[#9bd3ad]"
                  aria-label="Refresh objects"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingObjects ? 'animate-spin' : ''}`} />
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#417150] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4e8660]">
                  <Upload className="h-3.5 w-3.5" />
                  {uploading ? 'Uploading...' : 'Upload Files'}
                  <input
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files) uploadFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={openBucketSettings}
                  className="rounded-lg border border-[#2b3340] p-2 text-slate-300 hover:border-[#417150] hover:text-[#9bd3ad]"
                  aria-label="Bucket settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget({ type: 'bucket', label: selectedBucket.name, id: selectedBucket.id })}
                  className="rounded-lg border border-red-500/30 px-2.5 py-2 text-xs text-red-400 hover:bg-red-500/10"
                  aria-label="Delete bucket"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Batch Action Toolbar */}
            {selectedKeys.length > 0 && (
              <div className="flex items-center justify-between rounded-xl border border-[#417150]/60 bg-[#417150]/15 px-4 py-2.5 text-xs">
                <span className="font-medium text-[#b7e2c5]">
                  {selectedKeys.length} object{selectedKeys.length > 1 ? 's' : ''} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedKeys([])}
                    className="rounded-lg border border-[#2b3340] px-3 py-1 text-slate-300 hover:bg-slate-800"
                  >
                    Deselect All
                  </button>
                  <button
                    type="button"
                    disabled={batchDeleting}
                    onClick={handleBatchDelete}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {batchDeleting ? 'Deleting...' : `Delete (${selectedKeys.length})`}
                  </button>
                </div>
              </div>
            )}

            {/* Drag and Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer.files?.length) {
                  uploadFiles(e.dataTransfer.files);
                }
              }}
              className={`rounded-xl border-2 border-dashed px-4 py-5 text-center text-xs transition ${
                dragActive
                  ? 'border-[#417150] bg-[#417150]/20 text-[#b7e2c5]'
                  : 'border-[#232a35] bg-[#10141a] text-slate-400'
              }`}
            >
              Drag &amp; drop files here to upload directly to{' '}
              <span className="font-mono text-[#9bd3ad]">
                {selectedBucket.name}/{prefix}
              </span>
            </div>

            {/* Accessible Responsive Objects Table */}
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="objects-table-caption"
              className="table-wrapper"
            >
              <table className="serevox-table">
                <caption id="objects-table-caption" className="sr-only">
                  Objects in bucket {selectedBucket.name}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-10">
                      <button
                        type="button"
                        onClick={toggleSelectAll}
                        className="text-slate-400 hover:text-[#9bd3ad]"
                        aria-label="Select all"
                      >
                        {selectedKeys.length > 0 && selectedKeys.length === objects.length ? (
                          <CheckSquare className="h-4 w-4 text-[#84c498]" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col">Type</th>
                    <th scope="col">Size</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {folders.map((folder) => (
                    <tr key={folder}>
                      <td className="w-10">
                        <Folder className="h-4 w-4 text-[#84c498]" />
                      </td>
                      <th scope="row" className="font-medium text-[#9bd3ad]">
                        <button
                          type="button"
                          onClick={() => setPrefix(folder)}
                          className="inline-flex items-center gap-2 hover:underline"
                        >
                          {folder.slice(prefix.length)}
                        </button>
                      </th>
                      <td data-label="Type" className="text-slate-400">
                        Folder
                      </td>
                      <td data-label="Size" className="text-slate-500">
                        —
                      </td>
                      <td data-label="Updated" className="text-slate-500">
                        —
                      </td>
                      <td data-label="Actions" className="text-slate-500">
                        <button
                          type="button"
                          onClick={() => setPrefix(folder)}
                          className="text-xs text-[#84c498] hover:underline"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}

                  {objects.map((obj) => {
                    const isImg = obj.mime_type.startsWith('image/');
                    const isVid = obj.mime_type.startsWith('video/');
                    const isSelected = selectedKeys.includes(obj.key);
                    return (
                      <tr key={obj.id} className={isSelected ? 'bg-[#417150]/10' : ''}>
                        <td className="w-10">
                          <button
                            type="button"
                            onClick={() => toggleSelectKey(obj.key)}
                            className="text-slate-400 hover:text-[#9bd3ad]"
                          >
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4 text-[#84c498]" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <th scope="row" className="font-medium text-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewObj(obj);
                              setSignedLink('');
                            }}
                            className="inline-flex items-center gap-2 text-left hover:text-[#9bd3ad]"
                          >
                            {isImg ? (
                              <ImageIcon className="h-4 w-4 shrink-0 text-emerald-400" />
                            ) : isVid ? (
                              <Film className="h-4 w-4 shrink-0 text-sky-400" />
                            ) : (
                              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                            )}
                            <span className="truncate">{obj.key.slice(prefix.length)}</span>
                          </button>
                        </th>
                        <td data-label="Type" className="font-mono text-xs text-slate-400">
                          {obj.mime_type}
                        </td>
                        <td data-label="Size" className="text-slate-300">
                          {formatBytes(obj.size_bytes)}
                        </td>
                        <td data-label="Updated" className="text-xs text-slate-400">
                          {new Date(obj.updated_at).toLocaleString()}
                        </td>
                        <td data-label="Actions">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSnippetObj(obj)}
                              className="rounded border border-[#2b3340] p-1.5 text-slate-300 hover:border-[#417150] hover:text-[#9bd3ad]"
                              title="Code Snippet Generator"
                              aria-label={`Code Snippets for ${obj.key}`}
                            >
                              <Code2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewObj(obj);
                                setSignedLink('');
                              }}
                              className="rounded border border-[#2b3340] p-1.5 text-slate-300 hover:border-[#417150] hover:text-[#9bd3ad]"
                              aria-label={`Inspect ${obj.key}`}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget({ type: 'object', label: obj.key })}
                              className="rounded border border-red-500/30 p-1.5 text-red-400 hover:bg-red-500/10"
                              aria-label={`Delete ${obj.key}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {folders.length === 0 && objects.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                        {loadingObjects ? 'Memuat objek...' : 'Bucket / folder ini masih kosong.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-[#232a35] bg-[#13171e] p-10 text-center text-sm text-slate-400">
            Create a new bucket in the left panel to start uploading objects.
          </div>
        )}
      </section>

      {/* Create Bucket Dialog */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create New Bucket">
        <form onSubmit={handleCreateBucket} className="space-y-4">
          <div>
            <label htmlFor="bucket-name" className="mb-1.5 block text-sm font-medium text-slate-200">
              Bucket Name <span aria-hidden="true" className="text-[#84c498]">*</span>
            </label>
            <input
              id="bucket-name"
              name="bucket_name"
              type="text"
              required
              autoFocus
              pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]"
              aria-describedby="bucket-name-help"
              value={newBucketName}
              onChange={(e) => setNewBucketName(e.target.value.toLowerCase())}
              placeholder="e.g. user-avatars"
              className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-base text-slate-100"
            />
            <p id="bucket-name-help" className="mt-1 text-xs text-slate-500">
              3–63 karakter huruf kecil, angka, dan tanda hubung (-).
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-200">Visibility</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={newBucketVis === 'public'}
                  onChange={() => setNewBucketVis('public')}
                />
                Public (CDN URL)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={newBucketVis === 'private'}
                  onChange={() => setNewBucketVis('private')}
                />
                Private (Signed / Auth)
              </label>
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="max-mb" className="mb-1 block text-xs font-medium text-slate-300">
                Max File Size (MB)
              </label>
              <input
                id="max-mb"
                type="number"
                min={0}
                value={newBucketMaxMB}
                onChange={(e) => setNewBucketMaxMB(e.target.value)}
                className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="ttl-days" className="mb-1 block text-xs font-medium text-slate-300">
                Auto-Expire TTL (Days, 0=off)
              </label>
              <input
                id="ttl-days"
                type="number"
                min={0}
                value={newBucketTTL}
                onChange={(e) => setNewBucketTTL(e.target.value)}
                className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>

          <div>
            <label htmlFor="mime-list" className="mb-1 block text-xs font-medium text-slate-300">
              Allowed MIME Types (opsional, pisahkan koma)
            </label>
            <input
              id="mime-list"
              type="text"
              value={newBucketMimes}
              onChange={(e) => setNewBucketMimes(e.target.value)}
              placeholder="image/*, application/pdf"
              className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg border border-[#2b3340] px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#417150] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4e8660]"
            >
              Create Bucket
            </button>
          </div>
        </form>
      </Modal>

      {/* Object Preview & URL Inspector Modal */}
      <Modal
        open={Boolean(previewObj)}
        onClose={() => setPreviewObj(null)}
        title={previewObj ? previewObj.key : 'Object Details'}
      >
        {previewObj && selectedBucket && (
          <div className="space-y-4">
            <MediaInspectorModalContent
              bucketId={selectedBucket.id}
              bucketName={selectedBucket.name}
              obj={previewObj}
              publicUrl={publicUrl}
              isPublic={selectedBucket.visibility === 'public'}
            />

            {selectedBucket.visibility === 'public' && (
              <div>
                <div className="mb-1 text-xs font-medium text-slate-300">Public CDN URL</div>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={`${publicUrl}/v1/public/${selectedBucket.name}/${previewObj.key}`}
                    className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-2.5 py-1.5 font-mono text-xs text-[#9bd3ad]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      copyText('pub', `${publicUrl}/v1/public/${selectedBucket.name}/${previewObj.key}`)
                    }
                    className="rounded-lg border border-[#2b3340] px-3 text-xs text-slate-200 hover:border-[#417150]"
                  >
                    {copiedId === 'pub' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => generateSignedUrl(previewObj.key)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#417150]/60 bg-[#417150]/20 px-3 py-1.5 text-xs font-medium text-[#9bd3ad] hover:bg-[#417150]/35"
              >
                <Link2 className="h-3.5 w-3.5" /> Generate 1-Hour Signed URL
              </button>
              {signedLink && (
                <div className="mt-2 flex gap-2">
                  <input
                    readOnly
                    value={signedLink}
                    className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-2.5 py-1.5 font-mono text-xs text-emerald-300"
                  />
                  <button
                    type="button"
                    onClick={() => copyText('sig', signedLink)}
                    className="rounded-lg border border-[#2b3340] px-3 text-xs text-slate-200 hover:border-[#417150]"
                  >
                    {copiedId === 'sig' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Bucket Settings Modal */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={selectedBucket ? `Settings: ${selectedBucket.name}` : 'Bucket Settings'}
      >
        <form onSubmit={handleSaveBucketSettings} className="space-y-4">
          <div>
            <label htmlFor="edit-bucket-name" className="mb-1 block text-xs font-medium text-slate-300">
              Bucket Name (lowercase, 3–63 chars)
            </label>
            <input
              id="edit-bucket-name"
              type="text"
              required
              minLength={3}
              maxLength={63}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-lg border border-[#2b3340] bg-[#0b0d10] px-3 py-2 font-mono text-sm text-slate-100"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-200">Visibility</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="radio"
                  name="edit_visibility"
                  value="public"
                  checked={editVis === 'public'}
                  onChange={() => setEditVis('public')}
                />
                Public (CDN URL)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="radio"
                  name="edit_visibility"
                  value="private"
                  checked={editVis === 'private'}
                  onChange={() => setEditVis('private')}
                />
                Private (Signed / Auth)
              </label>
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-max-mb" className="mb-1 block text-xs font-medium text-slate-300">
                Max File Size (MB, 0=default)
              </label>
              <input
                id="edit-max-mb"
                type="number"
                min={0}
                value={editMaxMB}
                onChange={(e) => setEditMaxMB(e.target.value)}
                className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="edit-ttl" className="mb-1 block text-xs font-medium text-slate-300">
                Auto-Expire TTL (Days)
              </label>
              <input
                id="edit-ttl"
                type="number"
                min={0}
                value={editTTL}
                onChange={(e) => setEditTTL(e.target.value)}
                className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>

          <div>
            <label htmlFor="edit-mimes" className="mb-1 block text-xs font-medium text-slate-300">
              Allowed MIME Types (comma-separated, empty = all)
            </label>
            <input
              id="edit-mimes"
              type="text"
              value={editMimes}
              onChange={(e) => setEditMimes(e.target.value)}
              placeholder="image/*, application/pdf"
              className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="edit-cors" className="mb-1 block text-xs font-medium text-slate-300">
              CORS Allowed Origins (comma-separated)
            </label>
            <input
              id="edit-cors"
              type="text"
              value={editCorsOrigins}
              onChange={(e) => setEditCorsOrigins(e.target.value)}
              placeholder="https://myapp.com, http://localhost:3000"
              className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="edit-domain" className="mb-1 block text-xs font-medium text-slate-300">
              Custom CDN Domain (optional)
            </label>
            <input
              id="edit-domain"
              type="text"
              value={editDomain}
              onChange={(e) => setEditDomain(e.target.value)}
              placeholder="cdn.myapp.com"
              className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-lg border border-[#2b3340] px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#417150] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4e8660]"
            >
              Save Settings
            </button>
          </div>
        </form>
      </Modal>

      {/* New Folder Modal */}
      <Modal open={folderOpen} onClose={() => setFolderOpen(false)} title="Create Virtual Folder">
        <form onSubmit={handleCreateFolder} className="space-y-4">
          <div>
            <label htmlFor="folder-name" className="mb-1 block text-xs font-medium text-slate-300">
              Folder Name
            </label>
            <input
              id="folder-name"
              type="text"
              required
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. avatars or 2026"
              className="w-full rounded-lg border border-[#2b3340] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
            />
            <p className="mt-1 text-xs text-slate-500">
              Folder akan dibuat di path: <span className="font-mono text-[#9bd3ad]">{prefix || '/'}</span>
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setFolderOpen(false)}
              className="rounded-lg border border-[#2b3340] px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#417150] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4e8660]"
            >
              Create Folder
            </button>
          </div>
        </form>
      </Modal>

      {/* Code Snippet Modal */}
      <Modal
        open={Boolean(snippetObj)}
        onClose={() => setSnippetObj(null)}
        title={snippetObj ? `Code Snippets: ${snippetObj.key}` : 'Code Generator'}
      >
        {snippetObj && selectedBucket && (
          <CodeSnippetGenerator
            bucketName={selectedBucket.name}
            objectKey={snippetObj.key}
            publicUrl={publicUrl}
            isPublic={selectedBucket.visibility === 'public'}
            mimeType={snippetObj.mime_type}
          />
        )}
      </Modal>

      {/* Destructive Delete Confirmation Modal (Cancel gets autofocus per dialog guidance) */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget?.type === 'bucket' ? 'Delete Bucket?' : 'Delete Object?'}
      >
        <p className="mb-5 text-sm text-slate-300">
          Are you sure you want to delete{' '}
          <span className="font-mono font-semibold text-red-400">{deleteTarget?.label}</span>? Tindakan ini bersifat permanen.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => setDeleteTarget(null)}
            className="rounded-lg border border-[#2b3340] px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
          >
            Delete Permanently
          </button>
        </div>
      </Modal>
    </div>
  );
}

