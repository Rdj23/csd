import React, { useState, useMemo } from "react";

/**
 * DailyChart — bar chart showing per-day totals across a date range.
 * Rendered when a multi-day range is selected (instead of HourlyChart).
 */
export default function DailyChart({
  days = [],
  onDayClick,
  isDark,
  visibilityFilter = { external: true, internal: true },
}) {
  const showExt = visibilityFilter.external;
  const showInt = visibilityFilter.internal;
  const [hoveredIdx, setHoveredIdx] = useState(null);

  // Compute bar values
  const bars = useMemo(() => {
    return days.map((d) => {
      const ext = showExt ? (d.external_count || 0) : 0;
      const int_ = showInt ? (d.internal_count || 0) : 0;
      return { ...d, ext, int: int_, total: ext + int_ };
    });
  }, [days, showExt, showInt]);

  const maxVal = useMemo(() => Math.max(1, ...bars.map((b) => b.total)), [bars]);

  const hoveredBar = hoveredIdx !== null ? bars[hoveredIdx] : null;

  // Format date for display: "Feb 15" or "Jan 1"
  const fmtDate = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  };

  // Show every Nth label so they don't overlap
  const labelInterval = bars.length <= 14 ? 1 : bars.length <= 31 ? 2 : Math.ceil(bars.length / 15);

  return (
    <div className="relative">
      {/* Stats bar */}
      <div className="flex items-center gap-4 mb-3">
        {hoveredBar ? (
          <>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {fmtDate(hoveredBar.date_bucket)}
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Total: {hoveredBar.total}
              </span>
            </div>
            {showExt && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                <div className="w-2.5 h-2.5 rounded-sm bg-blue-400 dark:bg-blue-500" />
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  Ext: {hoveredBar.ext}
                </span>
              </div>
            )}
            {showInt && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400 dark:bg-emerald-500" />
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  Int: {hoveredBar.int}
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/40">
              <span className="text-xs text-slate-400 dark:text-slate-500">Hover a bar to see details</span>
            </div>
            {showExt && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-blue-400 dark:bg-blue-500" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">External</span>
              </div>
            )}
            {showInt && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400 dark:bg-emerald-500" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Internal</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-[2px] h-56 overflow-x-auto no-scrollbar">
        {bars.map((bar, i) => {
          const pct = (bar.total / maxVal) * 100;
          const intPct = bar.total > 0 ? (bar.int / bar.total) * pct : 0;
          const extPct = bar.total > 0 ? (bar.ext / bar.total) * pct : 0;
          const isHovered = hoveredIdx === i;
          const showLabel = i % labelInterval === 0 || i === bars.length - 1;

          return (
            <div
              key={bar.date_bucket}
              className={`flex-1 min-w-[8px] flex flex-col items-center gap-0.5 cursor-pointer transition-opacity ${
                hoveredIdx !== null && !isHovered ? "opacity-40" : ""
              }`}
              onClick={() => bar.total > 0 && onDayClick?.(bar.date_bucket)}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Count label above bar */}
              {bar.total > 0 && (bars.length <= 31 || isHovered) && (
                <span
                  className={`text-[10px] font-semibold -mb-0.5 whitespace-nowrap ${
                    isHovered
                      ? "text-slate-700 dark:text-slate-200"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {bar.total}
                </span>
              )}

              {/* Bar */}
              <div className="w-full flex flex-col-reverse items-stretch" style={{ height: "190px" }}>
                {showInt && (
                  <div
                    className={`w-full rounded-t-sm transition-all ${
                      isHovered
                        ? "bg-emerald-500 dark:bg-emerald-400"
                        : "bg-emerald-400 dark:bg-emerald-500"
                    }`}
                    style={{ height: `${intPct}%`, minHeight: bar.int > 0 ? "3px" : 0 }}
                  />
                )}
                {showExt && (
                  <div
                    className={`w-full transition-all ${
                      isHovered
                        ? "bg-blue-500 dark:bg-blue-400"
                        : "bg-blue-400 dark:bg-blue-500"
                    }`}
                    style={{
                      height: `${extPct}%`,
                      minHeight: bar.ext > 0 ? "3px" : 0,
                      borderRadius: (!showInt || bar.int === 0) ? "2px 2px 0 0" : 0,
                    }}
                  />
                )}
              </div>

              {/* Date label */}
              {showLabel ? (
                <span
                  className={`text-[9px] mt-0.5 whitespace-nowrap ${
                    isHovered
                      ? "font-bold text-slate-700 dark:text-slate-200"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {fmtDate(bar.date_bucket)}
                </span>
              ) : (
                <span className="text-[9px] mt-0.5 invisible">.</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
