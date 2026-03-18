import type { Job } from '../types';

function badge(score?: number) {
  if (typeof score !== 'number') return { label: 'Pending', cls: 'badge badgePending' };
  if (score > 70) return { label: `${score}%`, cls: 'badge badgeGreen' };
  if (score >= 40) return { label: `${score}%`, cls: 'badge badgeYellow' };
  return { label: `${score}%`, cls: 'badge badgeGray' };
}

function scoreTier(score?: number): 'green' | 'yellow' | 'gray' {
  if (typeof score !== 'number') return 'gray';
  if (score > 70) return 'green';
  if (score >= 40) return 'yellow';
  return 'gray';
}

const ACCENT_COLORS = { green: '#16a34a', yellow: '#f59e0b', gray: '#9ca3af' };

export function JobCard({
  job,
  onApply,
  compact,
  isSaved,
  onToggleSave,
  onHide,
}: {
  job: Job;
  onApply: (job: Job) => void;
  compact?: boolean;
  isSaved?: boolean;
  onToggleSave?: (job: Job) => void;
  onHide?: (job: Job) => void;
}) {
  const b = badge(job.match?.score);
  const tier = scoreTier(job.match?.score);
  const accent = ACCENT_COLORS[tier];

  return (
    <div className="jobCard" style={{ borderLeftColor: accent, borderLeftWidth: 4 }}>
      <div className="rowBetween" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="jobTitle">{job.title}</div>
          <div className="jobMeta">
            <span>{job.companyName}</span>
            <span className="dot" />
            <span>{job.location}</span>
            <span className="dot" />
            <span>{job.workMode}</span>
            <span className="dot" />
            <span>{job.jobType}</span>
          </div>
        </div>
        <div className={b.cls} title={`Match score: ${job.match?.score ?? 'pending'}`}>
          {b.label}
        </div>
      </div>

      {!compact && <div className="jobDesc">{job.description}</div>}

      {job.match?.explanation ? (
        <div className="jobReason">
          <span className="jobReasonLabel">Why this job?</span>
          <span>{job.match.explanation}</span>
        </div>
      ) : null}

      {(job.match?.matchingSkills?.length || job.match?.missingSkills?.length) ? (
        <div className="skillChipsRow">
          {job.match?.matchingSkills?.map((sk) => (
            <span key={sk} className="skillChip skillChipMatch">{sk}</span>
          ))}
          {job.match?.missingSkills?.map((sk) => (
            <span key={sk} className="skillChip skillChipMissing">{sk}</span>
          ))}
        </div>
      ) : null}

      <div className="jobActions">
        {typeof isSaved === 'boolean' && onToggleSave ? (
          <button className="btn btnSecondary btnSm" onClick={() => onToggleSave(job)} type="button">
            {isSaved ? 'Saved' : 'Save'}
          </button>
        ) : null}
        {onHide ? (
          <button className="btn btnSecondary btnSm" onClick={() => onHide(job)} type="button">
            Hide
          </button>
        ) : null}
        <button className="btn" onClick={() => onApply(job)}>
          Apply
        </button>
      </div>
    </div>
  );
}
