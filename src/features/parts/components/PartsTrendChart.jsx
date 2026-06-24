import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";
import { TrendingUp, Loader2, AlertCircle } from "lucide-react";
import { fetchPartsTrend } from "../../../api/partsApi";

/**
 * PartsTrendChart — analytics-style ticket-volume trendline for the Parts tab.
 *
 * Mirrors the Analytics dashboard's AreaChart (gradient fill, faint grid, hover tooltip)
 * but is driven by the cold parts data: GET /api/parts-trend aggregates solved tickets in
 * analyticstickets by created_date bucket. The line is scoped to whatever part the
 * Breakdown is focused on (`partId`); with no part it shows all products.
 *
 * It owns its own daily/weekly/monthly toggle so changing the bucket size re-queries
 * without disturbing the tree. The chart re-fetches whenever partId, filters, or the
 * grouping change.
 */

const GROUPINGS = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Turn a backend bucket key into a compact axis/tooltip label. */
const formatLabel = (key, groupBy) => {
  if (!key) return "";
  if (groupBy === "monthly") {
    const [, m] = key.split("-");
    return MONTHS[Number(m) - 1] || key;
  }
  if (groupBy === "weekly") {
    const [, w] = key.split("-W");
    return w ? `W${w}` : key;
  }
  // daily: "YYYY-MM-DD"
  const [, m, d] = key.split("-");
  return m && d ? `${MONTHS[Number(m) - 1]} ${Number(d)}` : key;
};

const PartsTrendChart = ({ partId = null, contextName = "All products", filters }) => {
  const [groupBy, setGroupBy] = useState("daily");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Monotonic request id: only the latest in-flight fetch is allowed to write state,
  // so a slow response for a stale partId/groupBy can't clobber a newer one.
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPartsTrend(partId, filters, { groupBy });
      if (id === reqId.current) setData(res);
    } catch {
      if (id === reqId.current) setError("Couldn't load the trend");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [partId, filters, groupBy]);

  useEffect(() => { load(); }, [load]);

  const points = useMemo(
    () => (data?.trend || []).map((t) => ({ name: formatLabel(t.date, groupBy), value: t.count })),
    [data, groupBy],
  );

  const total = data?.total || 0;
  const hasData = points.some((p) => p.value > 0);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pt-3 pb-2"
         style={{ boxShadow: "var(--shadow-card)" }}>
      {/* Header: title + grouping toggle */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="w-4 h-4 text-indigo-500 shrink-0" />
          <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 truncate">
            Ticket volume · <span className="text-slate-500 dark:text-slate-400 font-medium">{contextName}</span>
          </span>
          {!loading && !error && (
            <span className="hidden sm:inline text-[11px] font-medium text-slate-400 tabular-nums shrink-0">
              {total.toLocaleString()} tickets
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 shrink-0">
          {GROUPINGS.map((g) => (
            <button
              key={g.key}
              onClick={() => setGroupBy(g.key)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                groupBy === g.key
                  ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart body */}
      <div className="h-44 w-full">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center">
            <AlertCircle className="w-5 h-5 text-rose-400" />
            <span className="text-[12px] text-slate-500 dark:text-slate-400">{error}</span>
          </div>
        ) : !hasData ? (
          <div className="h-full flex items-center justify-center text-center px-4">
            <span className="text-[12px] text-slate-400">No tickets in this window for the current filters.</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="partsTrendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b833" />
              <XAxis
                dataKey="name"
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={20}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={32}
              />
              <RechartsTooltip
                formatter={(value) => [`${value}`, "Tickets"]}
                contentStyle={{
                  backgroundColor: "rgba(15,23,42,0.95)",
                  borderRadius: "10px",
                  border: "none",
                  boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
                  padding: "8px 12px",
                }}
                labelStyle={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600 }}
                itemStyle={{ color: "#a5b4fc", fontSize: 11 }}
                cursor={{ stroke: "#6366f1", strokeWidth: 1, strokeDasharray: "3 3" }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#6366f1"
                fill="url(#partsTrendGrad)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default PartsTrendChart;
