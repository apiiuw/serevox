import React, { useEffect, useState } from 'react';
import { Check, Copy, Eye, ShieldAlert, Timer } from 'lucide-react';
import { Modal } from './Modal';

export interface RevealedEntry {
  label: string;
  value: string;
}

interface MaskedCredentialProps {
  label: string;
  value?: string;
  onReveal?: () => Promise<RevealedEntry[]>;
}

const REVEAL_SECONDS = 15;

export function MaskedCredential({ label, value, onReveal }: MaskedCredentialProps) {
  const [stage, setStage] = useState<'closed' | 'confirm' | 'revealed'>('closed');
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_SECONDS);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealError, setRevealError] = useState('');
  const [entries, setEntries] = useState<RevealedEntry[]>([]);

  useEffect(() => {
    if (stage !== 'revealed') return;
    setSecondsLeft(REVEAL_SECONDS);
    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          setStage('closed');
          setEntries([]);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [stage]);

  function handleClose() {
    setStage('closed');
    setCopiedIdx(null);
    setRevealError('');
    setEntries([]);
  }

  async function handleConfirmReveal() {
    setRevealError('');
    if (onReveal) {
      setLoading(true);
      try {
        const res = await onReveal();
        setEntries(res);
        setStage('revealed');
      } catch (err) {
        setRevealError(err instanceof Error ? err.message : 'Failed to load credential');
      } finally {
        setLoading(false);
      }
      return;
    }
    setEntries([{ label, value: value ?? '' }]);
    setStage('revealed');
  }

  function handleCopy(idx: number, val: string) {
    navigator.clipboard.writeText(val);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1800);
  }

  return (
    <>
      <span className="inline-flex items-center gap-2">
        <code className="rounded bg-[#0a0d12] px-2 py-0.5 font-mono text-xs tracking-wider text-slate-400">
          ••••••••••••••••
        </code>
        <button
          type="button"
          onClick={() => {
            setRevealError('');
            setStage('confirm');
          }}
          className="inline-flex items-center gap-1 rounded-md border border-[#2a3444] bg-[#0e131a] px-2 py-1 text-[11px] font-medium text-[#9bd3ad] hover:border-[#417150] hover:bg-[#417150]/20"
        >
          <Eye className="h-3 w-3" /> Preview
        </button>
      </span>

      <Modal
        open={stage !== 'closed'}
        onClose={handleClose}
        title={stage === 'confirm' ? 'Confirm Credential Reveal' : `Preview: ${label}`}
      >
        {stage === 'confirm' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              <div>
                <div className="font-semibold">Are you sure you want to reveal this credential?</div>
                <p className="mt-1 text-amber-200/80">
                  You are about to display <strong>{label}</strong> in full. Make sure no one else can see your
                  screen. This dialog will automatically close after 15 seconds.
                </p>
              </div>
            </div>
            {revealError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {revealError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-[#2b3340] px-4 py-2 text-xs text-slate-300 hover:text-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleConfirmReveal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#417150] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4e855f] disabled:opacity-60"
              >
                <Eye className="h-3.5 w-3.5" /> {loading ? 'Loading...' : 'Yes, Reveal Key'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{label}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#417150]/25 px-2.5 py-1 font-mono font-bold text-[#9bd3ad]">
                <Timer className="h-3.5 w-3.5" />
                Auto-close: {secondsLeft}s
              </span>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1a222d]">
              <div
                className="h-full rounded-full bg-[#417150] transition-all duration-1000 ease-linear"
                style={{ width: `${(secondsLeft / REVEAL_SECONDS) * 100}%` }}
              />
            </div>

            <div className="space-y-2.5">
              {entries.map((entry, idx) => (
                <div
                  key={entry.label}
                  className="rounded-xl border border-[#242e3b] bg-[#07090d] p-3"
                >
                  <div className="mb-1 text-[11px] font-medium text-slate-400">{entry.label}</div>
                  <div className="flex items-center justify-between gap-2">
                    <code className="min-w-0 break-all font-mono text-xs text-emerald-300">{entry.value}</code>
                    <button
                      type="button"
                      onClick={() => handleCopy(idx, entry.value)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#2b3442] px-2.5 py-1.5 text-xs text-slate-200 hover:border-[#417150] hover:text-[#9bd3ad]"
                    >
                      {copiedIdx === idx ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedIdx === idx ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-[#2b3340] px-4 py-2 text-xs text-slate-300 hover:text-slate-100"
              >
                Close Now
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
