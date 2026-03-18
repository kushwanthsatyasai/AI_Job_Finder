import { useEffect, useMemo, useState } from 'react';
import type { JobType, WorkMode } from '../types';

export type DatePostedFilter = '24h' | 'week' | 'month' | 'any';
export type MatchScoreBand = 'High' | 'Medium' | 'All';

export type Filters = {
  roleTitle: string;
  skills: string[];
  datePosted: DatePostedFilter;
  jobType: JobType | 'Any';
  workMode: WorkMode | 'Any';
  location: string;
  matchScoreBand: MatchScoreBand;
};

const SKILLS = [
  'React', 'Node.js', 'TypeScript', 'Python', 'JavaScript', 'Fastify', 'Next.js',
  'SQL', 'Docker', 'AWS', 'LangChain', 'MongoDB', 'Kubernetes', 'Java', 'Go',
  'C++', 'Angular', 'Vue', 'Flutter', 'GraphQL',
];

export function FiltersPanel({
  filters: applied,
  onApply,
  onClear,
}: {
  filters: Filters;
  onApply: (next: Filters) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<Filters>(applied);
  useEffect(() => setDraft(applied), [applied]);

  const selected = useMemo(() => new Set(draft.skills), [draft.skills]);

  function toggleSkill(skill: string) {
    const next = new Set(selected);
    if (next.has(skill)) next.delete(skill);
    else next.add(skill);
    setDraft((d) => ({ ...d, skills: Array.from(next) }));
  }

  return (
    <div className="filters">
      <div className="filtersBody">
        <div className="filtersHeader">
          <div className="h2">Filters</div>
        </div>

        <label className="label">
          Role / title
          <input
            className="input"
            value={draft.roleTitle}
            onChange={(e) => setDraft((d) => ({ ...d, roleTitle: e.target.value }))}
            placeholder="e.g. Frontend Developer"
          />
        </label>

        <label className="label">
          Location
          <input className="input" value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} placeholder="e.g. London, Remote" />
        </label>

        <label className="label">
          Date posted
          <select className="input" value={draft.datePosted} onChange={(e) => setDraft((d) => ({ ...d, datePosted: e.target.value as any }))}>
            <option value="24h">Last 24 hours</option>
            <option value="week">Last week</option>
            <option value="month">Last month</option>
            <option value="any">Any time</option>
          </select>
        </label>

        <label className="label">
          Job type
          <select className="input" value={draft.jobType} onChange={(e) => setDraft((d) => ({ ...d, jobType: e.target.value as any }))}>
            <option value="Any">Any</option>
            <option value="Full-time">Full-time</option>
            <option value="Part-time">Part-time</option>
            <option value="Contract">Contract</option>
            <option value="Internship">Internship</option>
          </select>
        </label>

        <label className="label">
          Work mode
          <select className="input" value={draft.workMode} onChange={(e) => setDraft((d) => ({ ...d, workMode: e.target.value as any }))}>
            <option value="Any">Any</option>
            <option value="Remote">Remote</option>
            <option value="Hybrid">Hybrid</option>
            <option value="On-site">On-site</option>
          </select>
        </label>

        <div className="label">
          Skills
          <div className="skillsGrid">
            {SKILLS.map((s) => (
              <button
                key={s}
                className={selected.has(s) ? 'chip chipOn' : 'chip'}
                onClick={() => toggleSkill(s)}
                type="button"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <label className="label">
          Match score
          <select
            className="input"
            value={draft.matchScoreBand}
            onChange={(e) => setDraft((d) => ({ ...d, matchScoreBand: e.target.value as any }))}
          >
            <option value="High">High (&gt;70%)</option>
            <option value="Medium">Medium (40-70%)</option>
            <option value="All">All</option>
          </select>
        </label>
      </div>

      <div className="filtersActions">
        <button className="btn btnSecondary" onClick={() => onClear()} type="button">
          Clear all
        </button>
        <button className="btn" onClick={() => onApply(draft)} type="button">
          Apply filters
        </button>
      </div>
    </div>
  );
}
