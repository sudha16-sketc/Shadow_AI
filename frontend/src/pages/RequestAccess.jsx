import { useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE as API } from '../config';

export default function RequestAccess() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/auth/access-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Access request could not be submitted');
      }
      setDone(true);
    } catch (err) {
      setError(err.message || 'Access request could not be submitted');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-100 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-white mb-1">Request access</h1>
        <p className="text-xs text-gray-500 mb-5">
          Use the email your account was provisioned with. An administrator will review the request.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {done ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            <p className="mb-2">
              If a provisioned account matches that email, a request has been recorded for review.
            </p>
            <Link to="/login" className="text-emerald-100 underline text-xs">
              Return to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-red-500/50"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
            >
              {busy ? 'Submitting…' : 'Request access'}
            </button>
          </form>
        )}

        <p className="mt-5 text-xs text-gray-500">
          Already active?{' '}
          <Link to="/login" className="text-gray-300 hover:text-white underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
