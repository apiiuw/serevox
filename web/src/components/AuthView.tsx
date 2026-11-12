import React, { useState } from 'react';
import { ArrowLeft, Check, Copy, Eye, EyeOff, Lock, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { apiFetch, setToken, User } from '../api';
import { MaskedCredential } from './SecretField';

interface InitialCreds {
  service_role_key: string;
  s3_access_key_id: string;
  s3_secret_key: string;
  s3_endpoint: string;
  starter_bucket: string;
}

interface AuthViewProps {
  initialMode?: 'login' | 'register';
  onAuthenticated: (user: User) => void;
  onBackToLanding?: () => void;
}

export function AuthView({ initialMode = 'login', onAuthenticated, onBackToLanding }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [projectName, setProjectName] = useState('my-web-app');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [initialCreds, setInitialCreds] = useState<InitialCreds | null>(null);
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [copiedKey, setCopiedKey] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'register') {
        const res = await apiFetch<{
          token: string;
          user: User;
          initial_credentials: InitialCreds;
        }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email,
            name,
            password,
            project_name: projectName,
          }),
        });
        setToken(res.token);
        setPendingUser(res.user);
        setInitialCreds(res.initial_credentials);
      } else {
        const res = await apiFetch<{ token: string; user: User }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setToken(res.token);
        onAuthenticated(res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  function copyValue(label: string, val: string) {
    navigator.clipboard.writeText(val);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(''), 1800);
  }

  if (initialCreds && pendingUser) {
    return (
      <div className="scale-grid-bg flex min-h-screen items-center justify-center p-4">
        <div className="enterprise-card w-full max-w-2xl rounded-2xl border border-[#417150]/60 p-7">
          <div className="mb-5 flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#417150]/20 text-[#84c498]">
              <Sparkles aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100">Workspace &amp; Keys Ready</h1>
              <p className="text-sm text-slate-400">
                Your account, workspace, starter bucket, and API credentials are ready. Save your secrets below.
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-[#232a35] bg-[#07090d] p-4 text-sm">
            {[
              { label: 'Storage Endpoint', val: initialCreds.s3_endpoint, secret: false },
              { label: 'Starter Public Bucket', val: initialCreds.starter_bucket, secret: false },
              { label: 'Service Role Key (REST / @serevox/sdk)', val: initialCreds.service_role_key, secret: true },
              { label: 'S3 Access Key ID', val: initialCreds.s3_access_key_id, secret: true },
              { label: 'S3 Secret Access Key', val: initialCreds.s3_secret_key, secret: true },
            ].map(({ label, val, secret }) => (
              <div
                key={label}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[#181e28] pb-2.5 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="text-xs text-slate-400">{label}</div>
                  {!secret && <div className="truncate font-mono text-xs text-[#9bd3ad]">{val}</div>}
                </div>
                {secret ? (
                  <MaskedCredential label={label} value={val} />
                ) : (
                  <button
                    type="button"
                    onClick={() => copyValue(label, val)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#2b3442] px-2.5 py-1.5 text-xs text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad]"
                  >
                    {copiedKey === label ? (
                      <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                    )}
                    <span>{copiedKey === label ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onAuthenticated(pendingUser)}
            className="mt-6 w-full rounded-lg bg-[#417150] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#4e8660]"
          >
            Enter Serevox Console
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="scale-grid-bg flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="enterprise-card grid w-full max-w-5xl overflow-hidden rounded-2xl lg:grid-cols-[0.95fr_1.05fr]">
        {/* Left Enterprise Brand Panel */}
        <div className="flex flex-col justify-between border-b border-[#1d2531] bg-gradient-to-br from-[#0e1512] via-[#0c1116] to-[#080b0f] p-8 lg:border-b-0 lg:border-e">
          <div>
            {onBackToLanding && (
              <button
                type="button"
                onClick={onBackToLanding}
                className="mb-8 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-[#9bd3ad]"
              >
                <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
                Back to Overview
              </button>
            )}

            <div className="flex items-center gap-3.5">
              <img src="/LOGO-SEREVOX.png" alt="Serevox logo" className="h-20 w-auto shrink-0 object-contain" />
              <div>
                <div className="text-2xl font-extrabold tracking-wide text-slate-100">
                  SEREVOX <span className="text-[#84c498]">CLOUD</span>
                </div>
                <div className="text-xs font-medium text-slate-400">Enterprise Object Storage Platform</div>
              </div>
            </div>

            <p className="prose-pretty mt-6 text-sm text-slate-300">
              One isolated workspace to store, optimize, and deliver files across all your web applications.
            </p>

            <ul className="mt-7 space-y-4 text-sm text-slate-300">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#417150]/25 text-[#84c498]">
                  <Zap aria-hidden="true" className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-semibold text-slate-100">Instant Provisioning</div>
                  <div className="text-xs text-slate-400">
                    Otomatis membuat workspace, starter bucket, S3 key, &amp; REST key saat registrasi.
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#417150]/25 text-[#84c498]">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-semibold text-slate-100">Multi-Tenant Isolation</div>
                  <div className="text-xs text-slate-400">
                    Fully isolated buckets, API keys, and webhooks for every account and application.
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#417150]/25 text-[#84c498]">
                  <Lock aria-hidden="true" className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-semibold text-slate-100">AWS SigV4 &amp; Signed URLs</div>
                  <div className="text-xs text-slate-400">
                    Built for secure direct browser uploads and time-limited private document access.
                  </div>
                </div>
              </li>
            </ul>
          </div>

          <div className="mt-8 border-t border-[#1c242f] pt-4 text-xs text-slate-500">
            Serevox Cloud Storage • S3 + REST Dual-Protocol Engine
          </div>
        </div>

        {/* Right Sign In / Create Account Form Panel */}
        <div className="bg-[#0d1117] p-8 sm:p-10">
          {/* Mode Switcher */}
          <div className="mb-6 grid grid-cols-2 rounded-xl border border-[#202936] bg-[#080b0f] p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                mode === 'login' ? 'bg-[#417150] text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                mode === 'register' ? 'bg-[#417150] text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Create Account
            </button>
          </div>

          <h1 className="text-xl font-bold text-slate-100">
            {mode === 'register' ? 'Create Your Storage Workspace' : 'Sign In to Your Workspace'}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {mode === 'register'
              ? 'Create a new account to get your own dashboard, buckets, and API keys.'
              : 'Sign in to manage your buckets, file explorer, API keys, and webhooks.'}
          </p>

          {error && (
            <div role="alert" className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label htmlFor="setup-name" className="mb-1.5 block text-sm font-medium text-slate-200">
                    Full Name
                  </label>
                  <input
                    id="setup-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    placeholder="Alex Mercer"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-[#283240] bg-[#07090d] px-3.5 py-2.5 text-base text-slate-100 placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <label htmlFor="setup-project" className="mb-1.5 block text-sm font-medium text-slate-200">
                    First Web App / Project Name
                  </label>
                  <input
                    id="setup-project"
                    name="project"
                    type="text"
                    required
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full rounded-lg border border-[#283240] bg-[#07090d] px-3.5 py-2.5 text-base text-slate-100"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-sm font-medium text-slate-200">
                Work Email <span aria-hidden="true" className="text-[#84c498]">*</span>
              </label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="username"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-[#283240] bg-[#07090d] px-3.5 py-2.5 text-base text-slate-100 placeholder:text-slate-500"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="auth-password" className="block text-sm font-medium text-slate-200">
                  Password <span aria-hidden="true" className="text-[#84c498]">*</span>
                </label>
                <button
                  type="button"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-[#9bd3ad]"
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                id="auth-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                minLength={6}
                aria-describedby="pw-hint"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-[#283240] bg-[#07090d] px-3.5 py-2.5 text-base text-slate-100"
              />
              <p id="pw-hint" className="mt-1 text-xs text-slate-500">
                Minimal 6 karakter.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#417150] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#4e8660] disabled:opacity-60"
            >
              {loading
                ? 'Processing...'
                : mode === 'register'
                  ? 'Create Workspace & Generate Keys'
                  : 'Sign In to Console'}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-400">
            {mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                  className="font-semibold text-[#84c498] hover:underline"
                >
                  Create Account
                </button>
              </>
            ) : (
              <>
                Sudah punya akun?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                  }}
                  className="font-semibold text-[#84c498] hover:underline"
                >
                  Sign In
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
