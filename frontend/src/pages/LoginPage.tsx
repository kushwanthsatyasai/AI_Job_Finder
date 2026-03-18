import { useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { setToken } from '../lib/auth';
import { useLocation, useNavigate } from 'react-router-dom';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from || '/jobs';

  const [email, setEmail] = useState('test@gmail.com');
  const [password, setPassword] = useState('test@123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => email.trim() && password.trim(), [email, password]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      onLoggedIn();
      navigate(from, { replace: true });
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="centerCard">
      <h1 className="h1">Sign in</h1>
      <p className="muted">Use the provided test credentials to continue.</p>
      <form onSubmit={onSubmit} className="form">
        <label className="label">
          Email
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="label">
          Password
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <div className="errorBox">{error}</div> : null}
        <button className="btn" disabled={!canSubmit || loading} type="submit">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

