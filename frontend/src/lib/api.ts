import { getToken, logout } from './auth';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:4000';
const DEBUG_API = Boolean((import.meta as any).env?.VITE_DEBUG_API);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseJsonOrText(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return await res.json();
  return await res.text();
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers || {});
  if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const started = performance.now();
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (DEBUG_API) {
    // Never log auth header; only method/path/status and timing.
    console.debug('[api]', init?.method || 'GET', path, res.status, `${Math.round(performance.now() - started)}ms`);
  }
  if (!res.ok) {
    const body = await parseJsonOrText(res);
    const msg = typeof body === 'string' ? body : body?.error || 'Request failed';
    if (res.status === 401) {
      // Backend sessions are in-memory; a restart invalidates old tokens.
      logout();
    }
    throw new ApiError(res.status, msg);
  }
  return (await parseJsonOrText(res)) as T;
}

