import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useApi } from '../hooks/useAuth';

const COLORS = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#22c55e' };

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const api = useApi();
  const [topUsers, setTopUsers] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [topDomains, setTopDomains] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [usersData, bkData, ovData] = await Promise.all([
          api('/api/analytics/top-users'),
          api('/api/analytics/severity-breakdown'),
          api('/api/analytics/overview'),
        ]);
        setTopUsers(usersData.topUsers);
        setBreakdown(bkData.breakdown.map(b => ({
          name: b._id,
          value: b.count,
          fill: COLORS[b._id] ?? '#6366f1',
        })));
        setTopDomains(ovData.topDomains ?? []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="px-8 py-7 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Risk Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Last 30 days</p>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Severity Pie */}
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] p-5">
          <p className="text-sm font-medium text-white mb-4">Events by Severity</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={breakdown}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
              >
                {breakdown.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value) => <span className="text-gray-400 text-xs">{value}</span>}
                iconType="circle"
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top AI Domains */}
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] p-5">
          <p className="text-sm font-medium text-white mb-4">Events by AI Tool</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topDomains} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="_id"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={140}
                tickFormatter={v => v.replace('chat.openai.com','ChatGPT').replace('claude.ai','Claude').replace('gemini.google.com','Gemini')}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Events" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Risky Users */}
      <div className="rounded-xl bg-white/[0.04] border border-white/[0.07]">
        <div className="px-5 py-4 border-b border-white/[0.07]">
          <p className="text-sm font-medium text-white">Top Risky Users</p>
          <p className="text-xs text-gray-500 mt-0.5">Ranked by high-risk events</p>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {topUsers.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-gray-500">No data yet</p>
          )}
          {topUsers.map((u, i) => (
            <div key={u._id} className="px-5 py-4 flex items-center gap-4">
              <span className="text-xs text-gray-600 w-5 text-right">{i + 1}</span>
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300 text-sm font-semibold flex-shrink-0">
                {u.name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 font-medium">{u.name ?? u.email ?? 'Unknown'}</p>
                <p className="text-xs text-gray-500">{u.department || u.email || '—'}</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-red-400">{u.highRisk}</p>
                <p className="text-[10px] text-gray-600">high risk</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-300">{u.totalEvents}</p>
                <p className="text-[10px] text-gray-600">total</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-amber-400">{u.avgScore}</p>
                <p className="text-[10px] text-gray-600">avg score</p>
              </div>
              {/* Mini risk bar */}
              <div className="w-24">
                <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500 transition-all"
                    style={{ width: `${u.avgScore}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}