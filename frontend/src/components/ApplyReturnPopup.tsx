import { useEffect, useMemo, useState } from 'react';
import type { Job } from '../types';
import { apiFetch, ApiError } from '../lib/api';

type PendingApply = {
  job: Pick<Job, 'id' | 'title' | 'companyName' | 'applyUrl'>;
  openedAt: string; // ISO
};

const KEY = 'jfai_pending_apply';

export function markPendingApply(job: Job) {
  const payload: PendingApply = {
    job: { id: job.id, title: job.title, companyName: job.companyName, applyUrl: job.applyUrl },
    openedAt: new Date().toISOString(),
  };
  localStorage.setItem(KEY, JSON.stringify(payload));
}

function readPending(): PendingApply | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingApply;
  } catch {
    return null;
  }
}

function clearPending() {
  localStorage.removeItem(KEY);
}

export function ApplyReturnPopup({ onTracked }: { onTracked: () => void }) {
  const [pending, setPending] = useState<PendingApply | null>(() => readPending());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => pending?.job.title || '', [pending]);

  useEffect(() => {
    const check = () => {
      const p = readPending();
      setPending(p);
      if (p) setOpen(true);
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') check();
    };
    const onFocus = () => check();

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!open || !pending) return null;

  async function track(action: 'YesApplied' | 'AppliedEarlier') {
    const p = pending;
    if (!p) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/applications', {
        method: 'POST',
        body: JSON.stringify({
          jobId: p.job.id,
          jobTitle: p.job.title,
          companyName: p.job.companyName,
          applyUrl: p.job.applyUrl,
          appliedAt: action === 'AppliedEarlier' ? p.openedAt : undefined,
          action,
        }),
      });
      clearPending();
      setOpen(false);
      onTracked();
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : 'Failed to save application');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2 className="h2">Did you apply?</h2>
        <p className="muted">
          Did you apply to <b>{title}</b> at <b>{pending.job.companyName}</b>?
        </p>
        {error ? <div className="errorBox">{error}</div> : null}
        <div className="btnRow">
          <button className="btn" onClick={() => void track('YesApplied')} disabled={loading}>
            Yes, Applied
          </button>
          <button
            className="btn btnSecondary"
            onClick={() => {
              clearPending();
              setOpen(false);
            }}
            disabled={loading}
          >
            No, just browsing
          </button>
          <button className="btn btnSecondary" onClick={() => void track('AppliedEarlier')} disabled={loading}>
            Applied earlier
          </button>
        </div>
      </div>
    </div>
  );
}

