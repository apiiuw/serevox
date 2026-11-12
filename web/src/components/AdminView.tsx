import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  FolderKanban,
  HardDrive,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  AdminBucketSummary,
  AdminProjectSummary,
  AdminUserSummary,
  apiFetch,
  formatBytes,
  PlatformStats,
} from '../api';
import { Modal } from './Modal';

interface AdminViewProps {
  currentUserId: string;
}

export function AdminView({ currentUserId }: AdminViewProps) {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [projects, setProjects] = useState<AdminProjectSummary[]>([]);
  const [buckets, setBuckets] = useState<AdminBucketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [projectName, setProjectName] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [submitting, setSubmitting] = useState(false);

  const [renameTarget, setRenameTarget] = useState<{
    kind: 'project' | 'bucket';
    id: string;
    name: string;
    visibility?: 'public' | 'private';
  } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameVisibility, setRenameVisibility] = useState<'public' | 'private'>('public');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{
        stats: PlatformStats;
        users: AdminUserSummary[];
        projects: AdminProjectSummary[];
        buckets: AdminBucketSummary[];
      }>('/admin/overview');
      setStats(res.stats);
      setUsers(res.users);
      setProjects(res.projects ?? []);
      setBuckets(res.buckets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          name,
          password,
          project_name: projectName,
          role,
        }),
      });
      setCreateOpen(false);
      setEmail('');
      setName('');
      setPassword('');
      setProjectName('');
      setRole('member');
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleRole(u: AdminUserSummary) {
    const nextRole = u.role === 'admin' ? 'member' : 'admin';
    setError('');
    try {
      await apiFetch(`/admin/users/${u.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  }

  async function handleDeleteUser(u: AdminUserSummary) {
    if (!window.confirm(`Delete user ${u.email} and all of their workspaces, projects, and buckets?`)) {
      return;
    }
    setError('');
    try {
      await apiFetch(`/admin/users/${u.id}`, { method: 'DELETE' });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }

  function openRenameProject(p: AdminProjectSummary) {
    setRenameTarget({ kind: 'project', id: p.id, name: p.name });
    setRenameValue(p.name);
  }

  function openEditBucket(b: AdminBucketSummary) {
    setRenameTarget({ kind: 'bucket', id: b.id, name: b.name, visibility: b.visibility });
    setRenameValue(b.name);
    setRenameVisibility(b.visibility);
  }

  async function handleSaveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renameTarget) return;
    setError('');
    try {
      if (renameTarget.kind === 'project') {
        await apiFetch(`/admin/projects/${renameTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: renameValue.trim() }),
        });
      } else {
        await apiFetch(`/admin/buckets/${renameTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: renameValue.trim().toLowerCase(),
            visibility: renameVisibility,
          }),
        });
      }
      setRenameTarget(null);
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item');
    }
  }

  async function handleDeleteProject(p: AdminProjectSummary) {
    if (!window.confirm(`Delete project "${p.name}" owned by ${p.owner_email} and all of its buckets?`)) {
      return;
    }
    setError('');
    try {
      await apiFetch(`/admin/projects/${p.id}`, { method: 'DELETE' });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    }
  }

  async function handleToggleBucketVisibility(b: AdminBucketSummary) {
    const nextVis = b.visibility === 'public' ? 'private' : 'public';
    setError('');
    try {
      await apiFetch(`/admin/buckets/${b.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility: nextVis }),
      });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle bucket visibility');
    }
  }

  async function handleDeleteBucket(b: AdminBucketSummary) {
    if (!window.confirm(`Delete bucket "${b.name}" owned by ${b.owner_email}?`)) {
      return;
    }
    setError('');
    try {
      await apiFetch(`/admin/buckets/${b.id}`, { method: 'DELETE' });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete bucket');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
            <ShieldCheck className="h-5 w-5 text-[#84c498]" />
            Platform Admin Control Center
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Full platform control over all users, cross-tenant projects, buckets, and cluster storage capacity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadOverview}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#242e3b] bg-[#11161d] px-3 py-2 text-xs font-medium text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#417150] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4e855f]"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Create User
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Platform KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Total Users',
            value: String(stats?.total_users ?? 0),
            sub: `${stats?.total_admins ?? 0} admin accounts`,
            icon: Users,
          },
          {
            label: 'Total Projects',
            value: String(stats?.total_projects ?? 0),
            sub: 'Isolated tenant workspaces',
            icon: FolderKanban,
          },
          {
            label: 'Total Buckets',
            value: String(stats?.total_buckets ?? 0),
            sub: 'Public & private containers',
            icon: Database,
          },
          {
            label: 'Platform Storage',
            value: formatBytes(stats?.total_bytes ?? 0),
            sub: `${stats?.total_objects ?? 0} objects stored`,
            icon: HardDrive,
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

      {/* Users & Role Management */}
      <section className="enterprise-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-[#1b222d] px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Users &amp; Role Access</h3>
            <p className="text-xs text-slate-400">Promote members to admin or revoke admin privileges.</p>
          </div>
          <span className="rounded-full bg-[#417150]/20 px-2.5 py-1 text-[11px] font-semibold text-[#84c498]">
            {users.length} accounts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#1b222d] bg-[#090c10] text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Projects</th>
                <th className="px-4 py-3">Buckets</th>
                <th className="px-4 py-3">Objects</th>
                <th className="px-4 py-3">Storage</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#171d27]">
              {users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className="hover:bg-[#10151d]">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-100">
                        {u.name} {isSelf && <span className="ml-1 text-[10px] text-[#84c498]">(You)</span>}
                      </div>
                      <div className="text-slate-400">{u.email}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          u.role === 'admin'
                            ? 'bg-[#417150]/25 text-[#9bd3ad]'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {u.role === 'admin' ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">{u.project_count}</td>
                    <td className="px-4 py-3.5 text-slate-300">{u.bucket_count}</td>
                    <td className="px-4 py-3.5 text-slate-300">{u.object_count}</td>
                    <td className="px-4 py-3.5 font-mono text-slate-300">{formatBytes(u.total_bytes)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleRole(u)}
                          className="rounded-lg border border-[#242e3b] bg-[#0b0e14] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad]"
                        >
                          {u.role === 'admin' ? 'Set Member' : 'Make Admin'}
                        </button>
                        <button
                          type="button"
                          disabled={isSelf}
                          onClick={() => handleDeleteUser(u)}
                          title={isSelf ? 'Cannot delete your own account' : 'Delete user'}
                          className="rounded-lg border border-[#242e3b] bg-[#0b0e14] p-1.5 text-slate-400 hover:border-red-500/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* All Platform Projects (Admin Control) */}
      <section className="enterprise-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-[#1b222d] px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-slate-100">All Platform Projects</h3>
            <p className="text-xs text-slate-400">Rename or delete any user&apos;s project across the platform.</p>
          </div>
          <span className="rounded-full bg-[#417150]/20 px-2.5 py-1 text-[11px] font-semibold text-[#84c498]">
            {projects.length} projects
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#1b222d] bg-[#090c10] text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3">Project Name</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Workspace</th>
                <th className="px-4 py-3">Buckets</th>
                <th className="px-4 py-3">Objects</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#171d27]">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-[#10151d]">
                  <td className="px-5 py-3 font-semibold text-slate-100">
                    <div>{p.name}</div>
                    <div className="font-mono text-[10px] text-slate-500">{p.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{p.owner_email}</td>
                  <td className="px-4 py-3 text-slate-400">{p.workspace_name}</td>
                  <td className="px-4 py-3 text-slate-300">{p.bucket_count}</td>
                  <td className="px-4 py-3 text-slate-300">{p.object_count}</td>
                  <td className="px-4 py-3 font-mono text-slate-300">{formatBytes(p.total_bytes)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openRenameProject(p)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#242e3b] bg-[#0b0e14] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad]"
                      >
                        <Pencil className="h-3 w-3" /> Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProject(p)}
                        title="Delete project"
                        className="rounded-lg border border-[#242e3b] bg-[#0b0e14] p-1.5 text-slate-400 hover:border-red-500/40 hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* All Buckets Across Tenants (Admin Control) */}
      <section className="enterprise-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-[#1b222d] px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-slate-100">All Platform Buckets</h3>
            <p className="text-xs text-slate-400">Manage names, toggle public/private visibility, and delete buckets across tenants.</p>
          </div>
          <span className="rounded-full bg-[#417150]/20 px-2.5 py-1 text-[11px] font-semibold text-[#84c498]">
            {buckets.length} buckets
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#1b222d] bg-[#090c10] text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3">Bucket Name</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Visibility</th>
                <th className="px-4 py-3">Objects</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#171d27]">
              {buckets.map((b) => (
                <tr key={b.id} className="hover:bg-[#10151d]">
                  <td className="px-5 py-3 font-mono font-semibold text-slate-100">{b.name}</td>
                  <td className="px-4 py-3 text-slate-300">{b.owner_email}</td>
                  <td className="px-4 py-3 text-slate-300">{b.project_name}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleBucketVisibility(b)}
                      title="Click to toggle public/private"
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                        b.visibility === 'public'
                          ? 'bg-[#417150]/25 text-[#9bd3ad] hover:bg-[#417150]/40'
                          : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                      }`}
                    >
                      {b.visibility}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{b.object_count}</td>
                  <td className="px-4 py-3 font-mono text-slate-300">{formatBytes(b.total_bytes)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditBucket(b)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#242e3b] bg-[#0b0e14] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad]"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteBucket(b)}
                        title="Delete bucket"
                        className="rounded-lg border border-[#242e3b] bg-[#0b0e14] p-1.5 text-slate-400 hover:border-red-500/40 hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create User Modal */}
      <Modal open={createOpen} title="Create User Account" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ops Engineer"
              className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ops@company.com"
              className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Password (min 6 chars)</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Default Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="primary-web-app"
                className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
                className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-sm text-slate-100"
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg border border-[#242e3b] px-4 py-2 text-xs text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#417150] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4e855f] disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {submitting ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Admin Rename Project / Edit Bucket Modal */}
      <Modal
        open={Boolean(renameTarget)}
        title={renameTarget?.kind === 'project' ? 'Rename Project (Admin)' : 'Edit Bucket (Admin)'}
        onClose={() => setRenameTarget(null)}
      >
        <form onSubmit={handleSaveRename} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              {renameTarget?.kind === 'project' ? 'Project Name' : 'Bucket Name (lowercase, 3–63 chars)'}
            </label>
            <input
              type="text"
              required
              minLength={renameTarget?.kind === 'bucket' ? 3 : 2}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-sm text-slate-100"
            />
          </div>
          {renameTarget?.kind === 'bucket' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Visibility</label>
              <select
                value={renameVisibility}
                onChange={(e) => setRenameVisibility(e.target.value as 'public' | 'private')}
                className="w-full rounded-lg border border-[#242e3b] bg-[#07090d] px-3 py-2 text-sm text-slate-100"
              >
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRenameTarget(null)}
              className="rounded-lg border border-[#242e3b] px-4 py-2 text-xs text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#417150] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4e855f]"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
