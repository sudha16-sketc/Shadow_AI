import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export default function AcceptInvitation() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('This invitation link is missing its token.');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API}/api/platform-admin/invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Invitation could not be accepted');
      }
      setDone(true);
    } catch (err) {
      setError(err.message || 'Invitation could not be accepted');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-100 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-white mb-1">Set up your administrator account</h1>
        <p className="text-xs text-gray-500 mb-5">
          Choose a password for your tenant administrator account.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {done ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            <p className="mb-2">Your account is active.</p>
            <Link to="/login" className="text-emerald-100 underline text-xs">
              Continue to tenant sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-red-500/50"
              />
              <p className="mt-1 text-[10px] text-gray-500">Minimum 12 characters.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-red-500/50"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
            >
              {busy ? 'Activating…' : 'Activate account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
