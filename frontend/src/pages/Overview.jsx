import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
} from 'recharts';
import { useApi } from '../hooks/useAuth';
import { format, parseISO } from 'date-fns';

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] p-5">
      <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-3xl font-bold ${accent ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function SeverityBadge({ severity }) {
  const styles = {
    HIGH:   'bg-red-500/15 text-red-400 border-red-500/20',
    MEDIUM: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    LOW:    'bg-green-500/15 text-green-400 border-green-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${styles[severity] ?? styles.LOW}`}>
      {severity}
    </span>
  );
}

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

export default function OverviewPage() {
  const api = useApi();
  const [overview, setOverview] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [ov, tl, ev] = await Promise.all([
          api('/api/analytics/overview'),
          api('/api/analytics/risk-timeline'),
          api('/api/events?limit=8&severity=HIGH'),
        ]);
        setOverview(ov);
        setTimeline(tl.timeline.map(d => ({
          ...d,
          date: format(parseISO(d.date), 'MMM d'),
        })));
        setEvents(ev.events);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const score = overview?.securityScore ?? 100;
  const scoreColor = score >= 75 ? 'text-green-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  const scoreRing  = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-8 py-7 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="text-sm text-gray-500 mt-1">Last 30 days · Real-time</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-gray-400">Live monitoring</span>
        </div>
      </div>

      {/* Security Score + Stat Cards */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {/* Security Score — spans 1 col, taller */}
        <div className="col-span-1 rounded-xl bg-white/[0.04] border border-white/[0.07] p-5 flex flex-col items-center justify-center">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-4">Security Score</p>
          {/* SVG gauge */}
          <svg width="100" height="60" viewBox="0 0 100 60">
            <path d="M10 55 A 40 40 0 0 1 90 55" fill="none" stroke="#ffffff12" strokeWidth="8" strokeLinecap="round" />
            <path
              d="M10 55 A 40 40 0 0 1 90 55"
              fill="none"
              stroke={scoreRing}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(score / 100) * 125.7} 125.7`}
            />
          </svg>
          <p className={`text-3xl font-bold -mt-2 ${scoreColor}`}>{score}</p>
          <p className="text-[10px] text-gray-600 mt-1">/ 100</p>
        </div>

        {/* Stats */}
        <div className="col-span-4 grid grid-cols-4 gap-4">
          <StatCard
            label="Total Events"
            value={overview?.totalEvents?.toLocaleString() ?? '—'}
            sub="Last 30 days"
          />
          <StatCard
            label="High Risk"
            value={overview?.highRiskEvents?.toLocaleString() ?? '—'}
            sub="Flagged events"
            accent="text-red-400"
          />
          <StatCard
            label="Active Users"
            value={overview?.uniqueUsers?.toLocaleString() ?? '—'}
            sub="Used AI tools"
          />
          <StatCard
            label="Top AI Tool"
            value={overview?.topDomains?.[0]?._id?.replace('chat.openai.com','ChatGPT').replace('claude.ai','Claude') ?? '—'}
            sub={`${overview?.topDomains?.[0]?.count ?? 0} events`}
          />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {/* Risk timeline - 2 cols */}
        <div className="col-span-2 rounded-xl bg-white/[0.04] border border-white/[0.07] p-5">
          <p className="text-sm font-medium text-white mb-1">Risk Score Over Time</p>
          <p className="text-xs text-gray-500 mb-4">Average daily risk score</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={timeline} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#ffffff08" strokeDasharray="0" />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="avgScore" name="Avg Score" stroke="#ef4444" strokeWidth={2} fill="url(#riskGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Severity breakdown */}
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] p-5">
          <p className="text-sm font-medium text-white mb-1">Events by Severity</p>
          <p className="text-xs text-gray-500 mb-5">Last 30 days</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={timeline} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#ffffff08" />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} interval={6} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="high"   name="HIGH"   stroke="#ef4444" strokeWidth={1.5} fill="#ef444420" dot={false} stackId="1" />
              <Area type="monotone" dataKey="medium" name="MEDIUM" stroke="#f59e0b" strokeWidth={1.5} fill="#f59e0b20" dot={false} stackId="1" />
              <Area type="monotone" dataKey="low"    name="LOW"    stroke="#22c55e" strokeWidth={1.5} fill="#22c55e20" dot={false} stackId="1" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent High-Risk Events */}
      <div className="rounded-xl bg-white/[0.04] border border-white/[0.07]">
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
          <p className="text-sm font-medium text-white">Recent High-Risk Events</p>
          <a href="/events" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</a>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {events.length === 0 && (
            <p className="px-5 py-6 text-sm text-gray-500 text-center">No high-risk events — great job! 🎉</p>
          )}
          {events.map((ev) => (
            <div key={ev._id} className="px-5 py-3 flex items-center gap-4">
              <SeverityBadge severity={ev.severity} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">{ev.domain}</p>
                {ev.maskedPreview && (
                  <p className="text-xs text-gray-500 truncate font-mono">{ev.maskedPreview}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-gray-400">{ev.eventType}</p>
                <p className="text-xs text-gray-600">{format(new Date(ev.timestamp), 'MMM d, HH:mm')}</p>
              </div>
              <div className="w-10 text-right">
                <span className="text-sm font-semibold text-red-400">{ev.riskScore}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}