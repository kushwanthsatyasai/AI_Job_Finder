import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { LoginPage } from './pages/LoginPage';
import { JobFeedPage } from './pages/JobFeedPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { getToken, logout } from './lib/auth';

function RequireAuth({ children }: { children: ReactElement }) {
  const token = getToken();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export default function App() {
  const navigate = useNavigate();
  const token = getToken();
  const [nowToken, setNowToken] = useState(token);

  useEffect(() => {
    const onStorage = () => setNowToken(getToken());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const links = useMemo(
    () => [
      { to: '/jobs', label: 'Jobs' },
      { to: '/applications', label: 'Applications' },
    ],
    [],
  );

  return (
    <div className="appShell">
      <header className="topNav">
        <div className="brand" onClick={() => navigate('/jobs')} role="button" tabIndex={0}>
          Job Finder AI
        </div>
        {nowToken ? (
          <nav className="navLinks">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className="navLink">
                {l.label}
              </NavLink>
            ))}
            <button
              className="btn btnSecondary"
              onClick={() => {
                logout();
                setNowToken(null);
                navigate('/login');
              }}
            >
              Log out
            </button>
          </nav>
        ) : null}
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to={nowToken ? '/jobs' : '/login'} replace />} />
          <Route path="/login" element={<LoginPage onLoggedIn={() => setNowToken(getToken())} />} />
          <Route
            path="/jobs"
            element={
              <RequireAuth>
                <JobFeedPage />
              </RequireAuth>
            }
          />
          <Route
            path="/applications"
            element={
              <RequireAuth>
                <ApplicationsPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

