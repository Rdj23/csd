import React, { useMemo } from "react";

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarHeatmap({ days = [], quarter, selectedDate, onDayClick, isDark }) {
  // Build a lookup: date → data
  const dayMap = useMemo(() => {
    const m = {};
    for (const d of days) m[d.date_bucket] = d;
    return m;
  }, [days]);

  // Generate all dates in the quarter
  const calendarWeeks = useMemo(() => {
    const start = new Date(quarter.start + "T00:00:00");
    const end = new Date(quarter.end + "T00:00:00");
    const weeks = [];
    let current = new Date(start);

    // Align to Monday
    const dayOfWeek = current.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    current.setDate(current.getDate() + mondayOffset);

    while (current <= end || weeks.length === 0) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const dateStr = current.toISOString().slice(0, 10);
        const inRange = current >= start && current <= end;
        week.push({ date: dateStr, inRange });
        current.setDate(current.getDate() + 1);
      }
      weeks.push(week);
      if (current > end) break;
    }
    return weeks;
  }, [quarter]);

  // Max total for color scaling
  const maxTotal = useMemo(() => {
    let max = 1;
    for (const d of days) {
      const total = (d.internal_count || 0) + (d.external_count || 0);
      if (total > max) max = total;
    }
    return max;
  }, [days]);

  const getColor = (dateStr) => {
    const data = dayMap[dateStr];
    if (!data) return isDark ? "bg-slate-800" : "bg-slate-100";
    const total = (data.internal_count || 0) + (data.external_count || 0);
    if (total === 0) return isDark ? "bg-slate-800" : "bg-slate-100";
    const ratio = total / maxTotal;
    if (ratio < 0.25) return isDark ? "bg-indigo-900/60" : "bg-indigo-100";
    if (ratio < 0.5) return isDark ? "bg-indigo-800" : "bg-indigo-200";
    if (ratio < 0.75) return isDark ? "bg-indigo-600" : "bg-indigo-400";
    return isDark ? "bg-indigo-400" : "bg-indigo-600";
  };

  return (
    <div className="flex gap-2">
      {/* Day labels */}
      <div className="flex flex-col gap-[3px] pt-5">
        {DAYS_OF_WEEK.map((d) => (
          <div key={d} className="h-4 flex items-center text-[10px] text-slate-400 dark:text-slate-500 w-7">
            {d}
          </div>
        ))}
      </div>

      {/* Weeks grid */}
      <div className="flex gap-[3px] overflow-x-auto no-scrollbar">
        {calendarWeeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {/* Week number label for first day */}
            {wi % 4 === 0 && (
              <div className="text-[9px] text-slate-400 dark:text-slate-500 text-center h-4 flex items-center justify-center">
                {week[0].date.slice(5, 10)}
              </div>
            )}
            {wi % 4 !== 0 && <div className="h-4" />}
            {week.map(({ date, inRange }) => {
              const data = dayMap[date];
              const total = data ? (data.internal_count || 0) + (data.external_count || 0) : 0;
              const isSelected = date === selectedDate;
              return (
                <button
                  key={date}
                  onClick={() => inRange && onDayClick(date)}
                  disabled={!inRange}
                  title={inRange ? `${date}: ${total} comments` : ""}
                  className={`w-4 h-4 rounded-sm transition-all
                    ${inRange ? getColor(date) : "bg-transparent"}
                    ${isSelected ? "ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-slate-900" : ""}
                    ${inRange ? "cursor-pointer hover:ring-1 hover:ring-indigo-300" : "cursor-default"}
                  `}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
