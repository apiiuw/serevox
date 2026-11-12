import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Check,
  Code2,
  Copy,
  FolderOpen,
  Key,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  Sliders,
  Webhook,
} from 'lucide-react';
import { apiFetch, getToken, Project, ProjectMetrics, setToken, User } from './api';
import { AdminView } from './components/AdminView';
import { AuthView } from './components/AuthView';
import { ImageStudioView, ProjectSettingsView, UsageMetricsView } from './components/ConsoleExtrasView';
import { ExplorerView } from './components/ExplorerView';
import { IntegrationHubView, KeysView, WebhooksView } from './components/KeysAndWebhooksView';
import { LandingView } from './components/LandingView';
import { Modal } from './components/Modal';
import { OverviewView } from './components/OverviewView';

type Tab =
  | 'overview'
  | 'explorer'
  | 'transforms'
  | 'keys'
  | 'webhooks'
  | 'integration'
  | 'usage'
  | 'settings'
  | 'admin';

export function App() {
  const [booting, setBooting] = useState(true);
  const [publicUrl, setPublicUrl] = useState(window.location.origin);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);

  const loadProjectsAndMetrics = useCallback(async (preferredId?: string) => {
    const res = await apiFetch<{ projects: Project[] }>('/projects');
    setProjects(res.projects);
    const activeId =
      preferredId && res.projects.some((p) => p.id === preferredId)
        ? preferredId
        : res.projects[0]?.id ?? '';
    setSelectedProjectId(activeId);
    if (activeId) {
      const m = await apiFetch<{ metrics: ProjectMetrics }>(`/projects/${activeId}/metrics`);
      setMetrics(m.metrics);
    }
  }, []);

  const refreshMetrics = useCallback(async () => {
    if (!selectedProjectId) return;
    const m = await apiFetch<{ metrics: ProjectMetrics }>(`/projects/${selectedProjectId}/metrics`);
    setMetrics(m.metrics);
  }, [selectedProjectId]);

  useEffect(() => {
    async function init() {
      try {
        const status = await apiFetch<{ needs_setup: boolean; public_url: string }>('/setup-status');
        if (status.public_url) {
          setPublicUrl(status.public_url);
        }
        if (getToken()) {
          try {
            const me = await apiFetch<{ user: User; public_url: string }>('/auth/me');
            setUser(me.user);
            if (me.public_url) setPublicUrl(me.public_url);
            await loadProjectsAndMetrics();
          } catch {
            setToken('');
          }
        }
      } finally {
        setBooting(false);
      }
    }
    init();
  }, [loadProjectsAndMetrics]);

  useEffect(() => {
    if (user && selectedProjectId) {
      refreshMetrics();
    }
  }, [user, selectedProjectId, refreshMetrics]);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch<{ project: Project }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: newProjName }),
    });
    setNewProjOpen(false);
    setNewProjName('');
    await loadProjectsAndMetrics(res.project.id);
  }

  function copyEndpoint() {
    navigator.clipboard.writeText(publicUrl);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 1800);
  }

  function logout() {
    setToken('');
    setUser(null);
    setAuthMode(null);
  }

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center overflow-x-hidden bg-[#07090d] text-sm text-[#84c498]">
        Loading Serevox Cloud...
      </div>
    );
  }

  if (!user) {
    if (!authMode) {
      return (
        <LandingView
          publicUrl={publicUrl}
          onEnterConsole={(mode) => setAuthMode(mode)}
        />
      );
    }
    return (
      <AuthView
        initialMode={authMode}
        onBackToLanding={() => setAuthMode(null)}
        onAuthenticated={async (u) => {
          setUser(u);
          setAuthMode(null);
          await loadProjectsAndMetrics();
        }}
      />
    );
  }

  const navItems: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'explorer', label: 'Buckets & Files', icon: FolderOpen },
    { id: 'transforms', label: 'Image Studio', icon: Sliders },
    { id: 'keys', label: 'API Keys', icon: Key },
    { id: 'webhooks', label: 'Webhooks', icon: Webhook },
    { id: 'integration', label: 'Integration Hub', icon: Code2 },
    { id: 'usage', label: 'Usage & Quota', icon: BarChart3 },
    { id: 'settings', label: 'Project Settings', icon: Settings },
    ...(user.role === 'admin' ? [{ id: 'admin' as Tab, label: 'Admin Panel', icon: ShieldCheck }] : []),
  ];

  const activeProject = projects.find((p) => p.id === selectedProjectId);
  const currentTitle = navItems.find((n) => n.id === tab)?.label ?? 'Console';

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#07090d] text-slate-100 lg:grid lg:grid-cols-[270px_1fr]">
      {/* Enterprise Sidebar */}
      <aside className="flex flex-col justify-between border-b border-[#1b222d] bg-[#0b0e14] p-4 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-e">
        <div className="space-y-6">
          {/* Brand */}
          <div className="flex items-center gap-3 px-1">
            <img src="/LOGO-SEREVOX.png" alt="Serevox logo" className="h-12 w-auto shrink-0 object-contain" />
            <div>
              <div className="text-lg font-extrabold tracking-wide text-slate-100">
                SEREVOX <span className="text-[#84c498]">CLOUD</span>
              </div>
              <div className="text-[11px] text-slate-400">Object Storage Console</div>
            </div>
          </div>

          {/* Active Project Selector */}
          <div className="rounded-xl border border-[#1d2531] bg-[#0f141c] p-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <span>Active App / Project</span>
              <button
                type="button"
                onClick={() => setNewProjOpen(true)}
                className="inline-flex items-center gap-0.5 text-[#84c498] hover:text-[#a3d7b3]"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            </div>
            <label htmlFor="project-select" className="sr-only">
              Active Project
            </label>
            <select
              id="project-select"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full rounded-lg border border-[#25303f] bg-[#07090d] px-2.5 py-2 text-sm font-medium text-[#9bd3ad]"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Navigation */}
          <nav aria-label="Console navigation" className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {navItems.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`inline-flex shrink-0 items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition ${
                    active
                      ? 'bg-[#417150] text-white shadow-sm'
                      : 'text-slate-300 hover:bg-[#141a23] hover:text-[#9bd3ad]'
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Footer */}
        <div className="mt-4 hidden border-t border-[#1b222d] pt-4 lg:block">
          <div className="mb-3 truncate px-1 text-xs text-slate-400">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-slate-200">{user.name}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  user.role === 'admin'
                    ? 'bg-[#417150]/30 text-[#9bd3ad]'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {user.role}
              </span>
            </div>
            <div className="truncate">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#242e3b] bg-[#11161d] px-3 py-2 text-xs font-medium text-slate-300 hover:border-red-500/40 hover:text-red-300"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0">
        {/* Top Utility Bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b222d] bg-[#0b0e14]/80 px-5 py-3.5 backdrop-blur">
          <div>
            <h1 className="text-lg font-bold text-slate-100">{currentTitle}</h1>
            <p className="text-xs text-slate-400">
              Project: <span className="font-medium text-[#9bd3ad]">{activeProject?.name ?? '—'}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-[#202936] bg-[#07090d] px-3 py-1.5 text-xs">
              <span className="text-slate-400">API Endpoint:</span>
              <code className="font-mono text-[#9bd3ad]">{publicUrl}</code>
              <button
                type="button"
                onClick={copyEndpoint}
                aria-label="Copy API endpoint"
                className="text-slate-400 hover:text-[#9bd3ad]"
              >
                {copiedEndpoint ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#242e3b] px-3 py-1.5 text-xs text-slate-300 hover:border-red-500/40 hover:text-red-300 lg:hidden"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-6xl space-y-6 p-5 sm:p-6">
          {tab === 'overview' && (
            <OverviewView
              project={activeProject}
              metrics={metrics}
              onNavigate={(nextTab) => setTab(nextTab)}
            />
          )}

          {selectedProjectId && (
            <>
              {tab === 'explorer' && (
                <ExplorerView
                  projectId={selectedProjectId}
                  publicUrl={publicUrl}
                  onChanged={refreshMetrics}
                />
              )}
              {tab === 'transforms' && <ImageStudioView projectId={selectedProjectId} publicUrl={publicUrl} />}
              {tab === 'keys' && <KeysView projectId={selectedProjectId} />}
              {tab === 'webhooks' && <WebhooksView projectId={selectedProjectId} />}
              {tab === 'integration' && <IntegrationHubView publicUrl={publicUrl} />}
              {tab === 'usage' && <UsageMetricsView project={activeProject} metrics={metrics} />}
              {tab === 'settings' && (
                <ProjectSettingsView
                  project={activeProject}
                  publicUrl={publicUrl}
                  onProjectUpdated={() => loadProjectsAndMetrics(selectedProjectId)}
                />
              )}
            </>
          )}
          {tab === 'admin' && user.role === 'admin' && <AdminView currentUserId={user.id} />}
        </main>
      </div>

      <Modal open={newProjOpen} onClose={() => setNewProjOpen(false)} title="Register New Web App / Project">
        <form onSubmit={handleCreateProject} className="space-y-4">
          <div>
            <label htmlFor="new-proj-name" className="mb-1.5 block text-sm font-medium text-slate-200">
              Web App / Project Name
            </label>
            <input
              id="new-proj-name"
              type="text"
              required
              autoFocus
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
              placeholder="e.g. ecommerce-storefront"
              className="w-full rounded-lg border border-[#2a3240] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNewProjOpen(false)}
              className="rounded-lg border border-[#2b3340] px-4 py-2 text-sm text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#417150] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4e8660]"
            >
              Create Project
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
export default App;
