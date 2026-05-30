import React, { useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, Tooltip } from "recharts";

/**
 * OverviewChart — the single overview. It does NOT restate the tree; it DRIVES it.
 * Clicking a product bar scopes the tree to that product (click again / the active
 * bar to clear). Styled well off Recharts defaults: no grid, no axis lines, a custom
 * brand ramp, rounded caps, and a themed tooltip.
 */

// Indigo→violet brand ramp; the scoped bar stays vivid while the rest dim.
const RAMP = ["#6366f1", "#6d6ff0", "#7773ef", "#8177ee", "#8b5cf6", "#9466f0", "#9d6ff1", "#a678f2", "#b081f3", "#b98af4"];

const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/95 px-3 py-2 shadow-xl backdrop-blur">
      <div className="text-xs font-semibold text-slate-100">{d.fullName}</div>
      <div className="text-[11px] text-slate-300">
        <span className="font-bold text-indigo-300 tabular-nums">{d.count.toLocaleString()}</span> tickets
        {d.delta !== 0 && (
          <span className={d.delta > 0 ? "text-rose-400 ml-1.5" : "text-emerald-400 ml-1.5"}>
            {d.delta > 0 ? "▲" : "▼"}{Math.abs(d.delta)} /7d
          </span>
        )}
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{d.scoped ? "Scoped — click to clear" : "Click to scope the tree"}</div>
    </div>
  );
};

const OverviewChart = ({ products = [], scopedId, onScope, isDark = true }) => {
  const data = useMemo(
    () =>
      products
        .filter((p) => p.type === "product" && p.count > 0)
        .slice(0, 10)
        .map((p) => ({
          id: p.id,
          fullName: p.name,
          name: p.name.length > 24 ? p.name.slice(0, 23) + "…" : p.name,
          count: p.count,
          delta: p.delta || 0,
          scoped: p.id === scopedId,
        })),
    [products, scopedId],
  );

  if (!data.length) return null;
  const axisColor = isDark ? "#64748b" : "#94a3b8";

  return (
    <ResponsiveContainer width="100%" height={Math.max(150, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 2, right: 36, left: 6, bottom: 2 }} barCategoryGap={5}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={158}
          tick={{ fontSize: 11, fill: axisColor, fontWeight: 500 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip cursor={{ fill: isDark ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.06)" }} content={<ChartTooltip />} />
        <Bar
          dataKey="count"
          radius={[0, 5, 5, 0]}
          onClick={(d) => d?.id && onScope(d.id === scopedId ? null : d.id)}
          label={{ position: "right", fontSize: 11, fill: axisColor, fontWeight: 600, formatter: (v) => v.toLocaleString() }}
          isAnimationActive={false}
        >
          {data.map((entry, i) => (
            <Cell
              key={entry.id}
              fill={RAMP[i % RAMP.length]}
              cursor="pointer"
              fillOpacity={!scopedId || entry.scoped ? 1 : 0.32}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

export default OverviewChart;
