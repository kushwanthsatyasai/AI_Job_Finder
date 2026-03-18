import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../lib/api';
import type { Application, ApplicationStatus } from '../types';
import { useNavigate } from 'react-router-dom';

export function ApplicationsPage() {
  const navigate = useNavigate();
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch<{ applications: Application[] }>('/applications');
      setApps(res.applications);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        navigate('/login');
        return;
      }
      console.error('load applications error:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function updateStatus(id: string, status: ApplicationStatus) {
    const res = await apiFetch<{ application: Application }>(`/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setApps((prev) => prev.map((a) => (a.id === id ? res.application : a)));
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="h1">Applications</h1>
          <p className="muted">Track what you applied to, update status, and review a per-application timeline.</p>
        </div>
        <button className="btn btnSecondary" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading ? <div className="skeleton">Loading applications…</div> : null}
      {!loading && !apps.length ? <div className="card">No applications yet. Apply to a job from the feed first.</div> : null}

      <div className="appsGrid">
        {apps.map((a) => (
          <div key={a.id} className="appCard">
            <div className="rowBetween" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="jobTitle">{a.jobTitle}</div>
                <div className="jobMeta">
                  <span>{a.companyName}</span>
                  <span className="dot" />
                  <span>{new Date(a.createdAt).toLocaleString()}</span>
                </div>
              </div>
              <select className="input" value={a.status} onChange={(e) => void updateStatus(a.id, e.target.value as any)}>
                <option value="Applied">Applied</option>
                <option value="Interview">Interview</option>
                <option value="Offer">Offer</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>

            <div className="rowEnd" style={{ marginTop: 10 }}>
              <button className="btn btnSecondary" onClick={() => window.open(a.applyUrl, '_blank', 'noopener,noreferrer')}>
                Open job link
              </button>
            </div>

            <div className="timeline">
              {a.timeline.slice().reverse().map((ev, idx) => (
                <div key={idx} className="timelineItem">
                  <div className="timelineAt">{new Date(ev.at).toLocaleString()}</div>
                  <div className="timelineMsg">{ev.message}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

