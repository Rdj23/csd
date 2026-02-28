import React from "react";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function HourlyChart({ hourly = {}, onBarClick, isDark, visibilityFilter = { external: true, internal: true } }) {
  const showExt = visibilityFilter.external;
  const showInt = visibilityFilter.internal;

  // Find max value for scaling
  let maxVal = 1;
  for (const h of HOURS) {
    const data = hourly[h] || {};
    const total = (showExt ? (data.ext || 0) : 0) + (showInt ? (data.int || 0) : 0);
    if (total > maxVal) maxVal = total;
  }

  return (
    <div className="flex items-end gap-[3px] h-72">
      {HOURS.map((h) => {
        const data = hourly[h] || {};
        const intVal = showInt ? (data.int || 0) : 0;
        const extVal = showExt ? (data.ext || 0) : 0;
        const total = intVal + extVal;
        const pct = (total / maxVal) * 100;
        const intPct = total > 0 ? (intVal / total) * pct : 0;
        const extPct = total > 0 ? (extVal / total) * pct : 0;

        return (
          <div
            key={h}
            className="flex-1 flex flex-col items-center gap-0.5 cursor-pointer group"
            onClick={() => total > 0 && onBarClick(h)}
          >
            {/* Tooltip */}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap -mb-0.5">
              {total > 0 ? [showExt && `E:${extVal}`, showInt && `I:${intVal}`].filter(Boolean).join(" ") : ""}
            </div>

            {/* Bar container */}
            <div className="w-full flex flex-col-reverse items-stretch" style={{ height: "220px" }}>
              {/* Internal (bottom) */}
              {showInt && (
                <div
                  className="w-full rounded-t-sm bg-emerald-400 dark:bg-emerald-500 transition-all group-hover:bg-emerald-500 dark:group-hover:bg-emerald-400"
                  style={{ height: `${intPct}%`, minHeight: intVal > 0 ? "2px" : 0 }}
                />
              )}
              {/* External (top) */}
              {showExt && (
                <div
                  className="w-full bg-blue-400 dark:bg-blue-500 transition-all group-hover:bg-blue-500 dark:group-hover:bg-blue-400"
                  style={{ height: `${extPct}%`, minHeight: extVal > 0 ? "2px" : 0, borderRadius: (!showInt || intVal === 0) ? "2px 2px 0 0" : 0 }}
                />
              )}
            </div>

            {/* Hour label */}
            <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              {h}
            </span>
          </div>
        );
      })}
    </div>
  );
}
