import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ResumeUploadModal } from '../components/ResumeUploadModal';
import type { Job } from '../types';
import { FiltersPanel, type Filters } from '../components/FiltersPanel';
import { JobCard } from '../components/JobCard';
import { BestMatches } from '../components/BestMatches';
import { ApplyReturnPopup, markPendingApply } from '../components/ApplyReturnPopup';
import { AssistantChat } from '../components/AssistantChat';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';

type MeResponse = {
  id: string;
  email: string;
  hasResume: boolean;
  resumeUpdatedAt: string | null;
};

export function JobFeedPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');

  const DEFAULT_FILTERS: Filters = {
    roleTitle: '',
    skills: [],
    datePosted: 'any',
    jobType: 'Any',
    workMode: 'Any',
    location: '',
    matchScoreBand: 'All',
  };

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  async function loadMe() {
    setLoading(true);
    try {
      const res = await apiFetch<MeResponse>('/me');
      setMe(res);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        navigate('/login');
        return;
      }
      console.error('loadMe error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadJobs() {
    setJobsLoading(true);
    setMatchError('');
    try {
      const res = await apiFetch<{ jobs: Job[] }>('/jobs');
      setJobs(res.jobs);

      setMatchLoading(true);
      try {
        const m = await apiFetch<{ matches: { jobId: string; score: number; explanation: string; matchingSkills: string[]; missingSkills: string[] }[] }>('/match', {
          method: 'POST',
          body: JSON.stringify({ jobs: res.jobs }),
        });
        const byId = new Map(m.matches.map((x) => [x.jobId, x]));
        setJobs((prev) =>
          prev.map((j) => {
            const mm = byId.get(j.id);
            return mm ? { ...j, match: { score: mm.score, explanation: mm.explanation, matchingSkills: mm.matchingSkills ?? [], missingSkills: mm.missingSkills ?? [] } } : j;
          }),
        );
      } catch (err: any) {
        console.error('match error:', err);
        setMatchError('AI scoring failed. Showing jobs without match scores.');
      } finally {
        setMatchLoading(false);
      }
    } finally {
      setJobsLoading(false);
    }
  }

  useEffect(() => {
    void loadMe();
  }, []);

  useEffect(() => {
    if (!me?.hasResume) return;
    void loadJobs();
  }, [me?.hasResume]);

  const hasScores = jobs.some((j) => typeof j.match?.score === 'number');

  const filtered = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const role = norm(filters.roleTitle.trim());
    const loc = norm(filters.location.trim());
    const skills = filters.skills.map((s) => norm(s));

    const now = Date.now();
    const minPosted =
      filters.datePosted === '24h'
        ? now - 24 * 60 * 60 * 1000
        : filters.datePosted === 'week'
          ? now - 7 * 24 * 60 * 60 * 1000
          : filters.datePosted === 'month'
            ? now - 30 * 24 * 60 * 60 * 1000
            : null;

    const roleWords = role.split(/\s+/).filter((w) => w.length >= 2);

    return jobs
      .filter((j) => {
        const blob = norm(`${j.title}\n${j.companyName}\n${j.location}\n${j.description}`);
        if (roleWords.length && !roleWords.every((w) => blob.includes(w))) return false;
        if (loc && !norm(j.location).includes(loc)) return false;
        if (filters.jobType !== 'Any' && j.jobType !== 'Unknown' && j.jobType !== filters.jobType) return false;
        if (filters.workMode !== 'Any' && j.workMode !== 'Unknown' && j.workMode !== filters.workMode) return false;
        if (skills.length && !skills.some((s) => blob.includes(s))) return false;
        if (minPosted !== null) {
          const posted = Date.parse(j.postedAt);
          if (!Number.isFinite(posted) || posted < minPosted) return false;
        }
        const score = j.match?.score ?? 0;
        if (filters.matchScoreBand === 'High' && score <= 70) return false;
        if (filters.matchScoreBand === 'Medium' && (score < 40 || score > 70)) return false;
        return true;
      })
      .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
  }, [jobs, filters]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="h1">Job feed</h1>
          <p className="muted">AI-matched jobs ranked by relevance to your resume.</p>
        </div>
        <div className="pill">{me?.email || '\u2026'}</div>
      </div>

      {loading ? <div className="skeleton">Loading profile\u2026</div> : null}

      {me ? (
        <div className="card">
          <div className="rowBetween">
            <div>
              <div className="h2">Resume</div>
              <div className="muted">
                {me.hasResume ? `Uploaded ${me.resumeUpdatedAt || ''}` : 'Not uploaded yet'}
              </div>
            </div>
            <button className="btn btnSecondary" onClick={() => setMe({ ...me, hasResume: false })}>
              {me.hasResume ? 'Replace resume' : 'Upload resume'}
            </button>
          </div>
        </div>
      ) : null}

      {me?.hasResume ? (
        <div className="jobLayout">
          <FiltersPanel
            filters={filters}
            onApply={(next) => setFilters(next)}
            onClear={clearFilters}
          />

          <div className="jobList">
            {matchLoading ? (
              <div className="matchingBanner">
                <span className="spinner" /> Scoring {jobs.length} jobs with AI \u2014 this may take a moment\u2026
              </div>
            ) : null}

            {matchError ? (
              <div className="errorBox" style={{ marginBottom: 10 }}>{matchError}</div>
            ) : null}

            <BestMatches
              jobs={jobs}
              matchLoading={matchLoading}
              onApply={(j) => {
                markPendingApply(j);
                window.open(j.applyUrl, '_blank', 'noopener,noreferrer');
              }}
            />

            <div className="rowBetween" style={{ marginBottom: 10 }}>
              <div className="muted">
                Showing <b>{filtered.length}</b> of {jobs.length}
                {hasScores && !matchLoading ? ' \u00b7 sorted by match score' : ''}
              </div>
              <button className="btn btnSecondary" onClick={loadJobs} disabled={jobsLoading || matchLoading}>
                {jobsLoading ? 'Refreshing\u2026' : matchLoading ? 'Scoring\u2026' : 'Refresh jobs'}
              </button>
            </div>

            {jobsLoading && !jobs.length ? <div className="skeleton">Loading jobs\u2026</div> : null}
            {!jobsLoading && !jobs.length ? (
              <div className="card">
                No jobs yet. If you haven't set Adzuna keys, you'll see a small mock feed.
              </div>
            ) : null}

            {filtered.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onApply={(j) => {
                  markPendingApply(j);
                  window.open(j.applyUrl, '_blank', 'noopener,noreferrer');
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      <ResumeUploadModal
        open={Boolean(me && !me.hasResume)}
        onUploaded={(resumeUpdatedAt) => {
          setMe((prev) => (prev ? { ...prev, hasResume: true, resumeUpdatedAt } : prev));
        }}
      />

      <ApplyReturnPopup
        onTracked={() => {
          // no-op; applications page reads fresh
        }}
      />

      <AssistantChat
        filters={filters}
        setFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        clearFilters={clearFilters}
        navigate={(to) => navigate(to)}
      />
    </div>
  );
}
