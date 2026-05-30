import React from "react";

/**
 * Small, hand-rendered row primitives for the Parts tree.
 * Deliberately NOT a chart library — the magnitude bar is a div with a width %,
 * the sparkline is a raw SVG polyline. This keeps them crisp at row scale and lets
 * the styling sit exactly on the app's palette.
 */

// Depth-tinted fills — the bar carries real color + weight so heavy parts pop.
const TYPE_FILL = {
  product: "linear-gradient(90deg,#6366f1,#818cf8)",
  capability: "linear-gradient(90deg,#3b82f6,#60a5fa)",
  feature: "linear-gradient(90deg,#10b981,#34d399)",
  unknown: "linear-gradient(90deg,#f59e0b,#fbbf24)",
};

/**
 * MagnitudeBar — fill width = count / max-sibling-count, so bars are comparable
 * within a level. The count sits at the end of the bar.
 */
export const MagnitudeBar = ({ count, max, type }) => {
  const ratio = max > 0 ? count / max : 0;
  const pct = count > 0 ? Math.max(6, Math.round(ratio * 100)) : 0; // floor so tiny bars stay visible
  return (
    <div className="relative h-[20px] w-full rounded-[5px] bg-slate-100/80 dark:bg-slate-800/60 overflow-hidden ring-1 ring-inset ring-slate-200/60 dark:ring-slate-700/40">
      <div
        className="absolute inset-y-0 left-0 rounded-[5px]"
        style={{ width: `${pct}%`, background: TYPE_FILL[type] || TYPE_FILL.feature }}
      />
      <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-100">
        {(count || 0).toLocaleString()}
      </span>
    </div>
  );
};

/**
 * Sparkline — 7-day daily ticket volume as a tiny SVG line. Stroke is tinted by
 * the trend direction (rising volume = warm/concerning, falling = cool/good).
 */
export const Sparkline = ({ data = [], up = null }) => {
  const w = 58;
  const h = 18;
  const pad = 1.5;
  const max = Math.max(1, ...data);
  const n = Math.max(1, data.length - 1);
  const stroke = up == null ? "#94a3b8" : up ? "#f43f5e" : "#10b981";
  const pts = data.map((v, i) => {
    const x = pad + (i / n) * (w - 2 * pad);
    const y = h - pad - (v / max) * (h - 2 * pad);
    return [x, y];
  });
  if (!pts.length) return <svg width={w} height={h} aria-hidden="true" />;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} aria-hidden="true" className="block">
      <polyline
        points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={max > 1 || data.some(Boolean) ? 1 : 0.4}
      />
      <circle cx={last[0]} cy={last[1]} r="1.7" fill={stroke} />
    </svg>
  );
};

/**
 * TrendDelta — net change vs the prior 7 days. Rising ticket volume is the
 * concerning direction, so ▲ is warm and ▼ is cool.
 */
export const TrendDelta = ({ delta = 0 }) => {
  if (!delta) {
    return (
      <span title="No change vs prior 7 days" className="text-[11px] tabular-nums text-slate-400 dark:text-slate-600">
        –
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      title={`${up ? "+" : ""}${delta} vs prior 7 days`}
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${up ? "text-rose-500" : "text-emerald-500"}`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
};
