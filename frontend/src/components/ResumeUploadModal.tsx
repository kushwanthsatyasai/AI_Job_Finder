import { useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';

export function ResumeUploadModal({
  open,
  onUploaded,
}: {
  open: boolean;
  onUploaded: (resumeUpdatedAt: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a PDF or TXT resume.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('resume', file);
      const res = await apiFetch<{ ok: true; resumeUpdatedAt: string }>('/resume', {
        method: 'POST',
        body: form,
      });
      onUploaded(res.resumeUpdatedAt);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2 className="h2">Upload your resume</h2>
        <p className="muted">
          Upload a PDF or TXT resume. We’ll extract text and use it to compute match scores for jobs.
        </p>
        <input ref={fileRef} className="input" type="file" accept=".pdf,.txt,application/pdf,text/plain" />
        {error ? <div className="errorBox">{error}</div> : null}
        <div className="rowEnd">
          <button className="btn" onClick={upload} disabled={loading}>
            {loading ? 'Uploading…' : 'Upload resume'}
          </button>
        </div>
      </div>
    </div>
  );
}

