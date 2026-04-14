import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { useApi } from "../hooks/useAuth";

const SEVERITY_OPTIONS = ["", "HIGH", "MEDIUM", "LOW"];

function SeverityBadge({ severity }) {
  const s = {
    HIGH: "bg-red-500/15 text-red-400 border-red-500/25",
    MEDIUM: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    LOW: "bg-green-500/15 text-green-400 border-green-500/25",
  };
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${s[severity] ?? s.LOW}`}
    >
      {severity}
    </span>
  );
}

function ScorePill({ score }) {
  const color =
    score >= 70
      ? "text-red-400"
      : score >= 40
        ? "text-amber-400"
        : "text-green-400";
  return (
    <span className={`text-sm font-bold tabular-nums ${color}`}>{score}</span>
  );
}

export default function EventsPage() {
  const api = useApi();
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState("");
  const [domain, setDomain] = useState("");
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, page });
      if (severity) params.set("severity", severity);
      if (domain) params.set("domain", domain);
      const data = await api(`/api/events?${params}`);
      setEvents(data.events);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    const data = await api(`/api/events?${params}`);
    console.log("EVENT DATA:", data);
  }, [page, severity, domain]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [severity, domain]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="px-8 py-7 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Events</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total.toLocaleString()} total events
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="bg-white/[0.05] border border-white/10 text-gray-300 text-sm rounded-lg px-3 py-2 outline-none focus:border-white/20"
          >
            <option value="">All severities</option>
            {SEVERITY_OPTIONS.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filter by domain…"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="bg-white/[0.05] border border-white/10 text-gray-300 text-sm rounded-lg px-3 py-2 outline-none focus:border-white/20 w-48 placeholder:text-gray-600"
          />
          <button
            onClick={load}
            className="bg-white/[0.05] border border-white/10 text-gray-400 hover:text-white text-sm rounded-lg px-3 py-2 transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/[0.03] border-b border-white/[0.07]">
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">
                Severity
              </th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">
                Score
              </th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">
                Domain
              </th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">
                Type
              </th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">
                User
              </th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">
                Patterns
              </th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">
                Preview
              </th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {loading && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-gray-500">
                  No events found
                </td>
              </tr>
            )}
            {!loading &&
              events.map((ev) => (
                <tr
                  key={ev._id}
                  className="hover:bg-white/[0.02] transition-colors group"
                >
                  <td className="px-5 py-3">
                    <SeverityBadge severity={ev.severity} />
                  </td>
                  <td className="px-5 py-3">
                    <ScorePill score={ev.riskScore} />
                  </td>
                  <td className="px-5 py-3 text-gray-300 font-mono text-xs">
                    {ev.domain}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-gray-400 bg-white/[0.05] px-2 py-0.5 rounded">
                      {ev.eventType}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-xs">
                    {ev.userRef?.name ?? ev.userId?.slice(0, 8) ?? "—"}
                    {ev.userRef?.department && (
                      <span className="text-gray-600 ml-1">
                        · {ev.userRef.department}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {ev.findingLabels?.slice(0, 2).map((l) => (
                      <span
                        key={l}
                        className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 rounded px-1.5 py-0.5 mr-1"
                      >
                        {l}
                      </span>
                    ))}
                    {(ev.findingLabels?.length ?? 0) > 2 && (
                      <span className="text-[10px] text-gray-500">
                        +{ev.findingLabels.length - 2}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 max-w-[200px]">
                    {ev.maskedPreview && (
                      <code className="text-[10px] text-gray-500 truncate block font-mono">
                        {ev.maskedPreview}
                      </code>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {format(new Date(ev.timestamp), "MMM d, HH:mm:ss")}
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
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of{" "}
            {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-400 bg-white/[0.05] border border-white/10 disabled:opacity-30 hover:bg-white/[0.09] transition-colors"
            >
              ← Prev
            </button>
            <span className="px-3 py-1.5 text-xs text-gray-400">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-400 bg-white/[0.05] border border-white/10 disabled:opacity-30 hover:bg-white/[0.09] transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
