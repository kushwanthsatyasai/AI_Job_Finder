import type { Job } from '../types';
import { JobCard } from './JobCard';

export function BestMatches({
  jobs,
  matchLoading,
  onApply,
}: {
  jobs: Job[];
  matchLoading: boolean;
  onApply: (job: Job) => void;
}) {
  if (matchLoading) {
    return (
      <div className="bestMatches">
        <div className="h2">Best matches</div>
        <div className="bestSkeletonGrid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bestSkeletonCard">
              <div className="skelLine skelW60" />
              <div className="skelLine skelW40" />
              <div className="skelLine skelW80" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const scored = jobs.filter((j) => typeof j.match?.score === 'number' && j.match.score > 0);
  const sorted = [...scored].sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0)).slice(0, 6);

  if (!sorted.length) return null;

  return (
    <div className="bestMatches">
      <div className="rowBetween" style={{ marginBottom: 12 }}>
        <div className="h2">Best matches for your resume</div>
        <div className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Top {sorted.length} by AI score
        </div>
      </div>
      <div className="bestGrid">
        {sorted.map((j) => (
          <div key={j.id} className="bestItem">
            <JobCard job={j} onApply={onApply} compact />
          </div>
        ))}
      </div>
    </div>
  );
}
