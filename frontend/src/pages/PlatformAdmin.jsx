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

function SeverityBadge({ severity }) {
  const styles = {
    CRITICAL: 'bg-red-500/20 text-red-300 border-red-500/40',
    HIGH: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    MEDIUM: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    LOW: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
  };
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-medium ${styles[severity] ?? styles.LOW}`}>
      {severity ?? '—'}
    </span>
  );
}

function StatCard({ label, value, tone = 'default' }) {
  const tones = {
    default: 'text-white',
    warn: 'text-amber-300',
    danger: 'text-red-300',
  };
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
    </div>
  );
}

export default function PlatformAdmin() {
  const platformAdmin = useAuthStore((s) => s.platformAdmin);
  const platformLogout = useAuthStore((s) => s.platformLogout);
  const platformFetch = usePlatformApi();
  const navigate = useNavigate();

  const isSuperAdmin = (platformAdmin?.role ?? 'super_admin') === 'super_admin';

  const [tenants, setTenants] = useState([]);
  const [tenantMetrics, setTenantMetrics] = useState({});
  const [overview, setOverview] = useState(null);
  const [events, setEvents] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', adminName: '', adminEmail: '' });
  const [mgrForm, setMgrForm] = useState({ email: '', password: '' });

  const loadTenants = useCallback(async () => {
    const [list, metrics] = await Promise.all([
      platformFetch('/api/platform-admin/tenants'),
      platformFetch('/api/platform-admin/monitoring/tenants'),
    ]);
    setTenants(list.tenants ?? []);
    setTenantMetrics(Object.fromEntries(
      (metrics.tenants ?? []).map((t) => [String(t.id), t.metrics ?? {}]),
    ));
  }, [platformFetch]);

  const loadOverview = useCallback(async () => {
    const data = await platformFetch('/api/platform-admin/monitoring/overview?days=7');
    setOverview(data);
  }, [platformFetch]);

  const loadEvents = useCallback(async () => {
    const data = await platformFetch('/api/platform-admin/monitoring/events?limit=10');
    setEvents(data.events ?? []);
  }, [platformFetch]);

  const loadManagers = useCallback(async () => {
    if (!isSuperAdmin) return;
    const data = await platformFetch('/api/platform-admin/managers');
    setManagers(data.managers ?? []);
  }, [platformFetch, isSuperAdmin]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([
      loadTenants(), loadOverview(), loadEvents(), loadManagers(),
    ]);
    const failure = results.find((r) => r.status === 'rejected');
    if (failure) setError(failure.reason?.message || 'Failed to load platform data');
    setLoading(false);
  }, [loadTenants, loadOverview, loadEvents, loadManagers]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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
      setNotice({ kind: 'invite', email: data.invitation.email, token: data.invitation.token });
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

  async function handleCreateManager(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await platformFetch('/api/platform-admin/managers', {
        method: 'POST',
        body: JSON.stringify(mgrForm),
      });
      setMgrForm({ email: '', password: '' });
      await loadManagers();
    } catch (err) {
      setError(err.message || 'Manager creation failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleManagerActive(manager, isActive) {
    setError('');
    setBusy(true);
    try {
      await platformFetch(`/api/platform-admin/managers/${manager.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      });
      await loadManagers();
    } catch (err) {
      setError(err.message || 'Manager update failed');
    } finally {
      setBusy(false);
    }
  }

  const stats = [
    { label: 'Tenants', value: overview?.tenants?.total ?? '—' },
    { label: 'Active users', value: overview?.users?.active ?? overview?.users?.total ?? '—' },
    { label: 'Active devices', value: overview?.devices?.active ?? '—' },
    { label: 'High risk (7d)', value: overview?.events?.highRisk ?? '—', tone: 'warn' },
    { label: 'Blocked (7d)', value: overview?.events?.prevented ?? '—', tone: 'danger' },
    { label: 'Auth failures (7d)', value: overview?.authentication?.failures ?? '—', tone: 'warn' },
  ];

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
          <span className="text-[10px] uppercase tracking-wide text-gray-500">
            {isSuperAdmin ? 'Super admin' : 'Manager'}
          </span>
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

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">At a glance</h2>
            <button onClick={loadAll} className="text-xs text-gray-500 hover:text-gray-300">
              Refresh
            </button>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} tone={s.tone} />
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-white/[0.07]">
          <div className="px-5 py-4 border-b border-white/[0.07]">
            <h2 className="text-sm font-semibold text-white">Recent high-risk activity</h2>
          </div>
          {loading ? (
            <p className="px-5 py-6 text-xs text-gray-500">Loading…</p>
          ) : (overview?.recentIncidents ?? []).length === 0 ? (
            <p className="px-5 py-6 text-xs text-gray-500">No high-risk activity in the last 7 days.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-white/[0.07]">
                  <th className="px-5 py-2 font-medium">Severity</th>
                  <th className="px-5 py-2 font-medium">Application</th>
                  <th className="px-5 py-2 font-medium">Decision</th>
                  <th className="px-5 py-2 font-medium">Findings</th>
                  <th className="px-5 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.recentIncidents ?? []).map((incident) => (
                  <tr key={incident.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-5 py-3"><SeverityBadge severity={incident.severity} /></td>
                    <td className="px-5 py-3 text-gray-200">{incident.application ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-300 text-xs">{incident.policyDecision ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {(incident.findingLabels ?? []).slice(0, 3).join(', ') || '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {incident.timestamp ? new Date(incident.timestamp).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl border border-white/[0.07]">
          <div className="px-5 py-4 border-b border-white/[0.07]">
            <h2 className="text-sm font-semibold text-white">Recent event activity</h2>
          </div>
          {loading ? (
            <p className="px-5 py-6 text-xs text-gray-500">Loading…</p>
          ) : events.length === 0 ? (
            <p className="px-5 py-6 text-xs text-gray-500">No events recorded yet.</p>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {events.map((event) => (
                <li key={event.id} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-200 truncate">
                      {event.tenantName ?? 'Unknown tenant'} · {event.application ?? '—'}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">{event.maskedPreview ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <SeverityBadge severity={event.severity} />
                    <span className="text-[10px] text-gray-500">{event.policyDecision ?? '—'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {(overview?.authentication?.recentFailures ?? []).length > 0 && (
          <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03]">
            <div className="px-5 py-4 border-b border-amber-500/20">
              <h2 className="text-sm font-semibold text-amber-200">Recent authentication failures</h2>
            </div>
            <ul className="divide-y divide-amber-500/10">
              {overview.authentication.recentFailures.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className="px-5 py-2.5 flex items-center justify-between text-xs">
                  <span className="text-gray-300">
                    {entry.emailMasked || '—'} <span className="text-gray-600">({entry.scope})</span>
                  </span>
                  <span className="text-gray-500">{entry.reason ?? 'invalid credentials'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {isSuperAdmin && (
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
        )}

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
                  <th className="px-5 py-2 font-medium">Users</th>
                  <th className="px-5 py-2 font-medium">Events</th>
                  <th className="px-5 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-5 py-3 text-gray-200">{tenant.name}</td>
                    <td className="px-5 py-3"><StatusBadge status={tenant.lifecycleStatus} /></td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{tenantMetrics[tenant.id]?.users ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{tenantMetrics[tenant.id]?.events ?? '—'}</td>
                    <td className="px-5 py-3 text-right space-x-3">
                      {isSuperAdmin && tenant.lifecycleStatus === 'pending_admin' && tenant.pendingInvitationEmail && (
                        <button
                          disabled={busy}
                          onClick={() => handleReissue(tenant)}
                          className="text-xs text-amber-300 hover:text-amber-200 disabled:opacity-50"
                        >
                          Re-issue invite
                        </button>
                      )}
                      {isSuperAdmin && tenant.lifecycleStatus === 'active' && (
                        <button
                          disabled={busy}
                          onClick={() => handleStatus(tenant, 'suspended')}
                          className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                        >
                          Suspend
                        </button>
                      )}
                      {isSuperAdmin && tenant.lifecycleStatus === 'suspended' && (
                        <button
                          disabled={busy}
                          onClick={() => handleStatus(tenant, 'active')}
                          className="text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      )}
                      {!isSuperAdmin && <span className="text-xs text-gray-600">View only</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {isSuperAdmin && (
          <section className="rounded-xl border border-white/[0.07]">
            <div className="px-5 py-4 border-b border-white/[0.07]">
              <h2 className="text-sm font-semibold text-white">Platform access</h2>
              <p className="text-xs text-gray-500 mt-1">
                Platform managers can monitor activity and annotate investigations, but cannot manage
                tenants or platform accounts.
              </p>
            </div>

            <form onSubmit={handleCreateManager} className="grid gap-3 sm:grid-cols-3 px-5 py-4 border-b border-white/[0.07]">
              <input
                required
                type="email"
                placeholder="Manager email"
                value={mgrForm.email}
                onChange={(e) => setMgrForm({ ...mgrForm, email: e.target.value })}
                className="rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm"
              />
              <input
                required
                type="password"
                minLength={16}
                placeholder="Password (16+ characters)"
                value={mgrForm.password}
                onChange={(e) => setMgrForm({ ...mgrForm, password: e.target.value })}
                className="rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
              >
                Add manager
              </button>
            </form>

            {managers.length === 0 ? (
              <p className="px-5 py-6 text-xs text-gray-500">No platform managers yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-white/[0.07]">
                    <th className="px-5 py-2 font-medium">Email</th>
                    <th className="px-5 py-2 font-medium">Role</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((manager) => (
                    <tr key={manager.id} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-5 py-3 text-gray-200">{manager.email}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{manager.role}</td>
                      <td className="px-5 py-3 text-xs">
                        <span className={manager.isActive ? 'text-emerald-300' : 'text-gray-500'}>
                          {manager.isActive ? 'active' : 'disabled'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          disabled={busy}
                          onClick={() => handleManagerActive(manager, !manager.isActive)}
                          className="text-xs text-gray-300 hover:text-white disabled:opacity-50"
                        >
                          {manager.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
