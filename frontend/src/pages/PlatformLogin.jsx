import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../hooks/useAuth';

export default function PlatformLogin() {
  const platformLogin = useAuthStore((s) => s.platformLogin);
  const platformToken = useAuthStore((s) => s.platformToken);
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (platformToken) navigate('/platform', { replace: true });
  }, [platformToken, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await platformLogin(email, password);
      navigate('/platform', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-100 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
            ⚔
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-none">Shadow AI</p>
            <p className="text-[10px] text-gray-500 mt-0.5 leading-none">Platform Console</p>
          </div>
        </div>

        <h1 className="text-lg font-semibold text-white mb-1">Platform administrator</h1>
        <p className="text-xs text-gray-500 mb-5">
          Sign in to provision tenants and manage onboarding.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-red-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-red-500/50"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-xs text-gray-500">
          Tenant user?{' '}
          <Link to="/login" className="text-gray-300 hover:text-white underline">
            Use the tenant login
          </Link>
        </p>
      </div>
    </div>
  );
}
