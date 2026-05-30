import React, { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

/**
 * CompositionChart — a donut showing the ticket composition of the CURRENT context
 * (the selected node's children, or products at the top). It does not restate the
 * tree; it shows proportion within whatever section you're in, and drives the tree:
 * clicking a slice drills down. Legend doubles as a clickable list.
 */

const RAMP = ["#6366f1", "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#a855f7", "#14b8a6"];
const OTHERS = "#475569";
const MAX_SLICES = 9;

const ChartTooltip = ({ active, payload, total }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/95 px-3 py-2 shadow-xl backdrop-blur">
      <div className="text-xs font-semibold text-slate-100">{d.name}</div>
      <div className="text-[11px] text-slate-300">
        <span className="font-bold text-indigo-300 tabular-nums">{d.count.toLocaleString()}</span> tickets · {pct}%
      </div>
    </div>
  );
};

const CompositionChart = ({ slices = [], contextName, total = 0, onSlice }) => {
  const data = useMemo(() => {
    const sorted = [...slices].sort((a, b) => b.count - a.count).filter((s) => s.count > 0);
    if (sorted.length <= MAX_SLICES) {
      return sorted.map((s, i) => ({ ...s, color: RAMP[i % RAMP.length] }));
    }
    const head = sorted.slice(0, MAX_SLICES - 1).map((s, i) => ({ ...s, color: RAMP[i % RAMP.length] }));
    const tail = sorted.slice(MAX_SLICES - 1);
    head.push({ id: "__others__", name: `Others (${tail.length})`, count: tail.reduce((a, b) => a + b.count, 0), color: OTHERS });
    return head;
  }, [slices]);

  const sliceSum = useMemo(() => data.reduce((a, b) => a + b.count, 0), [data]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-[200px] text-xs text-slate-400">
        This part has no sub-parts to break down.
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      {/* Donut with center total */}
      <div className="relative shrink-0" style={{ width: 196, height: 196 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="name"
              innerRadius={62}
              outerRadius={92}
              paddingAngle={1.5}
              stroke="none"
              isAnimationActive={false}
              onClick={(d) => d?.id && d.id !== "__others__" && onSlice(d.id)}
            >
              {data.map((d) => (
                <Cell key={d.id} fill={d.color} cursor={d.id === "__others__" ? "default" : "pointer"} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip total={sliceSum} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums leading-none">{total.toLocaleString()}</span>
          <span className="mt-1 text-[10px] uppercase tracking-wide text-slate-400 max-w-[120px] text-center truncate">{contextName}</span>
        </div>
      </div>

      {/* Clickable legend */}
      <div className="flex-1 min-w-0 w-full grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-1 max-h-[176px] overflow-y-auto custom-scrollbar pr-1">
        {data.map((d) => {
          const pct = sliceSum > 0 ? Math.round((d.count / sliceSum) * 100) : 0;
          const clickable = d.id !== "__others__";
          return (
            <button
              key={d.id}
              onClick={() => clickable && onSlice(d.id)}
              disabled={!clickable}
              className={`flex items-center gap-2 text-left rounded px-1.5 py-1 ${clickable ? "hover:bg-slate-100 dark:hover:bg-slate-800/60 cursor-pointer" : "cursor-default"}`}
            >
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
              <span className="flex-1 min-w-0 truncate text-[12px] text-slate-600 dark:text-slate-300">{d.name}</span>
              <span className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{d.count.toLocaleString()}</span>
              <span className="text-[10px] tabular-nums text-slate-400 w-8 text-right">{pct}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CompositionChart;
