import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, usePlatformApi } from '../hooks/useAuth';

function inviteLink(token) {
  return `${window.location.origin}/accept-invitation?token=${encodeURIComponent(token)}`;
}

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    pending_admin: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    suspended: 'bg-red-500/15 text-red-300 border-red-500/30',
  };
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-medium ${styles[status] ?? styles.pending_admin}`}>
      {status}
    </span>
  );
}

export default function PlatformAdmin() {
  const platformAdmin = useAuthStore((s) => s.platformAdmin);
  const platformLogout = useAuthStore((s) => s.platformLogout);
  const platformFetch = usePlatformApi();
  const navigate = useNavigate();

  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', adminName: '', adminEmail: '' });

  const loadTenants = useCallback(async () => {
    setError('');
    try {
      const data = await platformFetch('/api/platform-admin/tenants');
      setTenants(data.tenants ?? []);
    } catch (err) {
      setError(err.message || 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, [platformFetch]);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  function handleLogout() {
    platformLogout();
    navigate('/platform/login');
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setNotice(null);
    setBusy(true);
    try {
      const data = await platformFetch('/api/platform-admin/tenants', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setNotice({
        kind: 'invite',
        email: data.invitation.email,
        token: data.invitation.token,
      });
      setForm({ name: '', adminName: '', adminEmail: '' });
      await loadTenants();
    } catch (err) {
      setError(err.message || 'Tenant provisioning failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleReissue(tenant) {
    setError('');
    setNotice(null);
    setBusy(true);
    try {
      const data = await platformFetch(`/api/platform-admin/tenants/${tenant.id}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ name: tenant.name, email: tenant.pendingInvitationEmail ?? '' }),
      });
      setNotice({ kind: 'invite', email: data.email, token: data.token });
      await loadTenants();
    } catch (err) {
      setError(err.message || 'Invitation could not be re-issued');
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(tenant, lifecycleStatus) {
    setError('');
    setBusy(true);
    try {
      await platformFetch(`/api/platform-admin/tenants/${tenant.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ lifecycleStatus }),
      });
      await loadTenants();
    } catch (err) {
      setError(err.message || 'Status update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 text-sm">
            ⚔
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-none">Shadow AI</p>
            <p className="text-[10px] text-gray-500 mt-0.5 leading-none">Platform Console</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{platformAdmin?.email}</span>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200 space-y-2">
            <p>
              Invitation ready for <span className="font-semibold">{notice.email}</span>. It expires in
              24 hours and can be used once. Share this link with the tenant administrator:
            </p>
            <code className="block break-all rounded bg-black/40 px-2 py-1 text-[11px] text-emerald-100">
              {inviteLink(notice.token)}
            </code>
            <button
              type="button"
              className="text-[11px] underline text-emerald-200"
              onClick={() => navigator.clipboard?.writeText(inviteLink(notice.token))}
            >
              Copy link
            </button>
          </div>
        )}

        <section className="rounded-xl border border-white/[0.07] p-5">
          <h2 className="text-sm font-semibold text-white mb-1">Provision a tenant</h2>
          <p className="text-xs text-gray-500 mb-4">
            Creates the tenant and a single-use onboarding invitation for its first administrator.
          </p>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-3">
            <input
              required
              placeholder="Tenant name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Admin name"
              value={form.adminName}
              onChange={(e) => setForm({ ...form, adminName: e.target.value })}
              className="rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm"
            />
            <input
              required
              type="email"
              placeholder="Admin email"
              value={form.adminEmail}
              onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              className="rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="sm:col-span-3 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
            >
              {busy ? 'Working…' : 'Create tenant & invite admin'}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-white/[0.07]">
          <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Tenants</h2>
            <button onClick={loadTenants} className="text-xs text-gray-500 hover:text-gray-300">
              Refresh
            </button>
          </div>
          {loading ? (
            <p className="px-5 py-6 text-xs text-gray-500">Loading…</p>
          ) : tenants.length === 0 ? (
            <p className="px-5 py-6 text-xs text-gray-500">No tenants yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-white/[0.07]">
                  <th className="px-5 py-2 font-medium">Name</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium">Pending invite</th>
                  <th className="px-5 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-5 py-3 text-gray-200">{tenant.name}</td>
                    <td className="px-5 py-3"><StatusBadge status={tenant.lifecycleStatus} /></td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {tenant.pendingInvitationEmail ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right space-x-3">
                      {tenant.lifecycleStatus === 'pending_admin' && tenant.pendingInvitationEmail && (
                        <button
                          disabled={busy}
                          onClick={() => handleReissue(tenant)}
                          className="text-xs text-amber-300 hover:text-amber-200 disabled:opacity-50"
                        >
                          Re-issue invite
                        </button>
                      )}
                      {tenant.lifecycleStatus === 'active' && (
                        <button
                          disabled={busy}
                          onClick={() => handleStatus(tenant, 'suspended')}
                          className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                        >
                          Suspend
                        </button>
                      )}
                      {tenant.lifecycleStatus === 'suspended' && (
                        <button
                          disabled={busy}
                          onClick={() => handleStatus(tenant, 'active')}
                          className="text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
