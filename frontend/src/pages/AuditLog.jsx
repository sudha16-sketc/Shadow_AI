import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../hooks/useAuth';

const AuditLog = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const token = useAuthStore((s) => s.token);
  const loadLogs = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page, limit: 30 });
      if (actionFilter) query.append('action', actionFilter);

      const res = await fetch(`${API}/api/audit-log?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    loadLogs();
  }, [page, actionFilter]);
  const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';



  const downloadExport = async (format) => {
    try {
      const res = await fetch(`${API}/api/audit-log/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${Date.now()}.${format}`;
      a.click();
    } catch {
      alert('Failed to download export');
    }
  };

  const actions = [
    'user_created',
    'user_updated',
    'user_deactivated',
    'event_blocked',
    'justification_approved',
    'justification_rejected',
    'policy_changed',
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Audit Log</h1>
          <div className="flex gap-2">
            <button
              onClick={() => downloadExport('json')}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
            >
              Export JSON
            </button>
            <button
              onClick={() => downloadExport('csv')}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filter by Action
          </label>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
          >
            <option value="">All Actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12">Loading...</div>
        ) : error ? (
          <div className="bg-red-50 p-4 rounded-lg text-red-700">{error}</div>
        ) : logs.length === 0 ? (
          <div className="bg-white p-8 rounded-lg border border-gray-200 text-center text-gray-500">
            No audit logs found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-700 text-sm">
                    Timestamp
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700 text-sm">
                    Action
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700 text-sm">
                    Actor
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700 text-sm">
                    Target
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700 text-sm">
                    IP Address
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {log.actor?.email || log.actor?.name || 'System'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                      {log.target || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                      {log.ip || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-2 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <span className="px-4 py-2 text-gray-700">Page {page}</span>
          <button
            onClick={() => setPage(page + 1)}
            className="px-3 py-2 bg-yellow-400 text-black rounded hover:bg-yellow-500"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuditLog;
