import React, { useState } from "react";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function HourlyChart({ hourly = {}, onBarClick, isDark, visibilityFilter = { external: true, internal: true } }) {
  const showExt = visibilityFilter.external;
  const showInt = visibilityFilter.internal;
  const [hoveredHour, setHoveredHour] = useState(null);

  // Find max value for scaling
  let maxVal = 1;
  for (const h of HOURS) {
    const data = hourly[h] || {};
    const total = (showExt ? (data.ext || 0) : 0) + (showInt ? (data.int || 0) : 0);
    if (total > maxVal) maxVal = total;
  }

  // Compute hovered bar data
  const hoveredData = hoveredHour !== null ? (hourly[hoveredHour] || {}) : null;
  const hoveredExt = hoveredData && showExt ? (hoveredData.ext || 0) : 0;
  const hoveredInt = hoveredData && showInt ? (hoveredData.int || 0) : 0;
  const hoveredTotal = hoveredExt + hoveredInt;

  return (
    <div className="relative">
      {/* Persistent stats bar at the top */}
      <div className="flex items-center gap-4 mb-3">
        {hoveredHour !== null ? (
          <>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {String(hoveredHour).padStart(2, "0")}:00
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Total: {hoveredTotal}
              </span>
            </div>
            {showExt && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                <div className="w-2.5 h-2.5 rounded-sm bg-blue-400 dark:bg-blue-500" />
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  Ext: {hoveredExt}
                </span>
              </div>
            )}
            {showInt && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400 dark:bg-emerald-500" />
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  Int: {hoveredInt}
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
      <div className="flex items-end gap-[3px] h-56">
        {HOURS.map((h) => {
          const data = hourly[h] || {};
          const intVal = showInt ? (data.int || 0) : 0;
          const extVal = showExt ? (data.ext || 0) : 0;
          const total = intVal + extVal;
          const pct = (total / maxVal) * 100;
          const intPct = total > 0 ? (intVal / total) * pct : 0;
          const extPct = total > 0 ? (extVal / total) * pct : 0;
          const isHovered = hoveredHour === h;

          return (
            <div
              key={h}
              className={`flex-1 flex flex-col items-center gap-0.5 cursor-pointer transition-opacity ${
                hoveredHour !== null && !isHovered ? "opacity-40" : ""
              }`}
              onClick={() => total > 0 && onBarClick(h)}
              onMouseEnter={() => setHoveredHour(h)}
              onMouseLeave={() => setHoveredHour(null)}
            >
              {/* Count label above bar */}
              {total > 0 && (
                <span className={`text-[11px] font-semibold -mb-0.5 ${
                  isHovered ? "text-slate-700 dark:text-slate-200" : "text-slate-400 dark:text-slate-500"
                }`}>
                  {total}
                </span>
              )}

              {/* Bar container */}
              <div className="w-full flex flex-col-reverse items-stretch" style={{ height: "190px" }}>
                {/* Internal (bottom) */}
                {showInt && (
                  <div
                    className={`w-full rounded-t-sm transition-all ${
                      isHovered
                        ? "bg-emerald-500 dark:bg-emerald-400"
                        : "bg-emerald-400 dark:bg-emerald-500"
                    }`}
                    style={{ height: `${intPct}%`, minHeight: intVal > 0 ? "3px" : 0 }}
                  />
                )}
                {/* External (top) */}
                {showExt && (
                  <div
                    className={`w-full transition-all ${
                      isHovered
                        ? "bg-blue-500 dark:bg-blue-400"
                        : "bg-blue-400 dark:bg-blue-500"
                    }`}
                    style={{
                      height: `${extPct}%`,
                      minHeight: extVal > 0 ? "3px" : 0,
                      borderRadius: (!showInt || intVal === 0) ? "2px 2px 0 0" : 0,
                    }}
                  />
                )}
              </div>

              {/* Hour label */}
              <span className={`text-[10px] mt-0.5 ${
                isHovered
                  ? "font-bold text-slate-700 dark:text-slate-200"
                  : "text-slate-400 dark:text-slate-500"
              }`}>
                {h}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
