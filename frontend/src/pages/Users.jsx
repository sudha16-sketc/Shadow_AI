import { useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useApi } from '../hooks/useAuth';

// ─── Sub-components ───────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  const styles = {
    admin:   'bg-red-500/15 text-red-400 border-red-500/25',
    manager: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    viewer:  'bg-gray-500/15 text-gray-400 border-gray-500/25',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${styles[role] ?? styles.viewer}`}>
      {role}
    </span>
  );
}

function SeverityBadge({ severity }) {
  const s = {
    HIGH:   'bg-red-500/15 text-red-400 border-red-500/25',
    MEDIUM: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    LOW:    'bg-green-500/15 text-green-400 border-green-500/25',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${s[severity] ?? s.LOW}`}>
      {severity}
    </span>
  );
}

function StatusDot({ isActive }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${isActive ? 'bg-green-400' : 'bg-gray-600'}`} />
  );
}

function RiskBar({ score }) {
  const color = score >= 70 ? 'bg-red-500' : score >= 40 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score ?? 0}%` }} />
      </div>
      <span className="text-xs tabular-nums text-gray-400 w-6 text-right">{Math.round(score ?? 0)}</span>
    </div>
  );
}

// ─── Create / Edit User Modal ─────────────────────────────────────────────────

function UserModal({ user, onClose, onSaved }) {
  const api = useApi();
  const isEdit = !!user;
  const [form, setForm] = useState({
    name:       user?.name       ?? '',
    email:      user?.email      ?? '',
    password:   '',
    role:       user?.role       ?? 'viewer',
    department: user?.department ?? '',
    extensionUserId: user?.extensionUserId ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit() {
    setError('');
    setSaving(true);
    try {
      if (isEdit) {
        const updates = {
          name: form.name, role: form.role,
          department: form.department, extensionUserId: form.extensionUserId,
        };
        await api(`/api/users/${user._id}`, { method: 'PATCH', body: JSON.stringify(updates) });
        if (form.password.trim()) {
          await api(`/api/users/${user._id}/password`, {
            method: 'PATCH', body: JSON.stringify({ newPassword: form.password }),
          });
        }
      } else {
        await api('/api/users', { method: 'POST', body: JSON.stringify(form) });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">
            {isEdit ? 'Edit User' : 'Create User'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>

        <div className="space-y-3">
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Full Name</label>
            <input value={form.name} onChange={set('name')} placeholder="Jane Smith"
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20" />
          </div>

          {/* Email — read-only when editing */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Email</label>
            <input value={form.email} onChange={set('email')} placeholder="jane@company.com"
              disabled={isEdit}
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed" />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Password {isEdit && <span className="text-gray-600">(leave blank to keep current)</span>}
            </label>
            <input value={form.password} onChange={set('password')} type="password" placeholder="••••••••"
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20" />
          </div>

          {/* Role + Department */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Role</label>
              <select value={form.role} onChange={set('role')}
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-white/20">
                <option value="viewer">Viewer</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Department</label>
              <input value={form.department} onChange={set('department')} placeholder="Engineering"
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20" />
            </div>
          </div>

          {/* Extension User ID */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Extension User ID
              <span className="text-gray-600 ml-1">— links browser extension events to this account</span>
            </label>
            <input value={form.extensionUserId} onChange={set('extensionUserId')} placeholder="user_abc123"
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20 font-mono text-xs" />
          </div>
        </div>

        {error && (
          <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose}
            className="flex-1 bg-white/[0.05] border border-white/10 text-gray-300 text-sm font-medium py-2.5 rounded-xl hover:bg-white/[0.09] transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 bg-indigo-600 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-indigo-500 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── User Detail Drawer ───────────────────────────────────────────────────────

function UserDrawer({ userId, onClose }) {
  const api = useApi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/api/users/${userId}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-gray-900 border-l border-white/[0.07] h-full overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="px-6 py-5 border-b border-white/[0.07] flex items-center justify-between sticky top-0 bg-gray-900 z-10">
          <h2 className="text-base font-semibold text-white">User Profile</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {data && (
          <div className="px-6 py-5 space-y-6">
            {/* Avatar + basics */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-500/20 flex items-center justify-center text-indigo-300 text-2xl font-bold flex-shrink-0">
                {data.user.name[0]?.toUpperCase()}
              </div>
              <div>
                <p className="text-lg font-semibold text-white">{data.user.name}</p>
                <p className="text-sm text-gray-400">{data.user.email}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <RoleBadge role={data.user.role} />
                  {data.user.department && (
                    <span className="text-xs text-gray-500">{data.user.department}</span>
                  )}
                  <span className="text-xs text-gray-600">
                    <StatusDot isActive={data.user.isActive} />
                    {data.user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>

            {/* 30-day stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Events', value: data.stats.total ?? 0, color: 'text-white' },
                { label: 'High Risk',    value: data.stats.highRisk ?? 0, color: 'text-red-400' },
                { label: 'Avg Score',    value: Math.round(data.stats.avgScore ?? 0), color: 'text-amber-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white/[0.04] border border-white/[0.07] rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Opt-out status */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-200">Extension Monitoring</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {data.user.optedOut ? 'User has opted out — events are not captured' : 'Active — events are being monitored'}
                </p>
              </div>
              <div className={`w-2 h-2 rounded-full ${data.user.optedOut ? 'bg-gray-600' : 'bg-green-400'}`} />
            </div>

            {/* Recent events */}
            <div>
              <p className="text-sm font-medium text-white mb-3">Recent Events</p>
              {data.recentEvents.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">No events recorded</p>
              )}
              <div className="space-y-2">
                {data.recentEvents.slice(0, 10).map(ev => (
                  <div key={ev._id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 flex items-center gap-3">
                    <SeverityBadge severity={ev.severity} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300 font-mono truncate">{ev.domain}</p>
                      {ev.maskedPreview && (
                        <p className="text-[10px] text-gray-600 font-mono truncate">{ev.maskedPreview}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-bold text-gray-300">{ev.riskScore}</p>
                      <p className="text-[10px] text-gray-600">{format(new Date(ev.timestamp), 'MMM d')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Extension user ID */}
            {data.user.extensionUserId && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Extension User ID</p>
                <code className="text-xs font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-3 py-1.5 block">
                  {data.user.extensionUserId}
                </code>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Users Page ──────────────────────────────────────────────────────────

export default function UsersPage() {
  const api = useApi();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [departments, setDepartments] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [drawerUserId, setDrawerUserId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const LIMIT = 20;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, page });
      if (search)     params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      if (deptFilter) params.set('department', deptFilter);
      const data = await api(`/api/users?${params}`);
      setUsers(data.users);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, deptFilter]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { setPage(1); }, [search, roleFilter, deptFilter]);

  useEffect(() => {
    api('/api/users/departments')
      .then(d => setDepartments(d.departments))
      .catch(() => {});
  }, []);

  async function handleDeactivate(user) {
    try {
      await api(`/api/users/${user._id}`, { method: 'DELETE' });
      loadUsers();
    } catch (e) {
      console.error(e);
    } finally {
      setConfirmDelete(null);
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="px-8 py-7 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-sm text-gray-500 mt-1">{total.toLocaleString()} accounts</p>
        </div>
        <button
          onClick={() => { setEditUser(null); setShowModal(true); }}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
        >
          <span>+</span> Add User
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <input
          type="text"
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-white/[0.05] border border-white/10 text-gray-200 text-sm rounded-xl px-3 py-2 outline-none focus:border-white/20 placeholder:text-gray-600 w-64"
        />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="bg-white/[0.05] border border-white/10 text-gray-300 text-sm rounded-xl px-3 py-2 outline-none focus:border-white/20">
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="viewer">Viewer</option>
        </select>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="bg-white/[0.05] border border-white/10 text-gray-300 text-sm rounded-xl px-3 py-2 outline-none focus:border-white/20">
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button onClick={loadUsers}
          className="bg-white/[0.05] border border-white/10 text-gray-400 hover:text-white text-sm rounded-xl px-3 py-2 transition-colors">
          ↻
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/[0.03] border-b border-white/[0.07]">
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">User</th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Role</th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Department</th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">High Risk</th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider w-40">Avg Score</th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Total Events</th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Status</th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Joined</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {loading && (
              <tr><td colSpan={9} className="px-5 py-8 text-center text-gray-500">Loading…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={9} className="px-5 py-8 text-center text-gray-500">No users found</td></tr>
            )}
            {!loading && users.map(u => (
              <tr key={u._id} className="hover:bg-white/[0.02] transition-colors cursor-pointer group"
                onClick={() => setDrawerUserId(u._id)}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300 text-xs font-semibold flex-shrink-0">
                      {u.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div>
                      <p className="text-gray-200 font-medium text-sm leading-tight">{u.name}</p>
                      <p className="text-gray-500 text-xs">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3"><RoleBadge role={u.role} /></td>
                <td className="px-5 py-3 text-gray-400 text-xs">{u.department || '—'}</td>
                <td className="px-5 py-3">
                  <span className={`text-sm font-bold ${u.stats.highRisk > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                    {u.stats.highRisk ?? 0}
                  </span>
                </td>
                <td className="px-5 py-3 w-40">
                  <RiskBar score={u.stats.avgScore ?? 0} />
                </td>
                <td className="px-5 py-3 text-gray-400 text-sm">{u.stats.total ?? 0}</td>
                <td className="px-5 py-3">
                  <span className="flex items-center text-xs">
                    <StatusDot isActive={u.isActive} />
                    <span className={u.isActive ? 'text-green-400' : 'text-gray-500'}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {u.optedOut && (
                      <span className="ml-2 text-[10px] text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">opted out</span>
                    )}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                  {format(new Date(u.createdAt), 'MMM d, yyyy')}
                </td>
                <td className="px-5 py-3" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditUser(u); setShowModal(true); }}
                      className="text-xs text-gray-400 hover:text-white bg-white/[0.05] hover:bg-white/[0.10] border border-white/10 rounded-lg px-2.5 py-1 transition-colors"
                    >
                      Edit
                    </button>
                    {u.isActive && (
                      <button
                        onClick={() => setConfirmDelete(u)}
                        className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg px-2.5 py-1 transition-colors"
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500">
            Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-400 bg-white/[0.05] border border-white/10 disabled:opacity-30 hover:bg-white/[0.09] transition-colors">
              ← Prev
            </button>
            <span className="px-3 py-1.5 text-xs text-gray-400">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-400 bg-white/[0.05] border border-white/10 disabled:opacity-30 hover:bg-white/[0.09] transition-colors">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Modals and drawers */}
      {showModal && (
        <UserModal
          user={editUser}
          onClose={() => { setShowModal(false); setEditUser(null); }}
          onSaved={() => { setShowModal(false); setEditUser(null); loadUsers(); }}
        />
      )}

      {drawerUserId && (
        <UserDrawer userId={drawerUserId} onClose={() => setDrawerUserId(null)} />
      )}

      {/* Deactivate confirm dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-gray-900 border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-white mb-2">Deactivate User?</h2>
            <p className="text-sm text-gray-400 mb-5">
              <span className="font-medium text-white">{confirmDelete.name}</span> will no longer be able to log in. Their event history is preserved.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 bg-white/[0.05] border border-white/10 text-gray-300 text-sm py-2.5 rounded-xl hover:bg-white/[0.09] transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDeactivate(confirmDelete)}
                className="flex-1 bg-red-600 text-white text-sm py-2.5 rounded-xl hover:bg-red-500 transition-colors">
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}