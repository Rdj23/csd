// ============================================================================
// THIS WEEK STATS - Weekly performance summary cards
// ============================================================================
import React, { useMemo } from "react";

const ThisWeekStats = ({ tickets, isGSTUser }) => {
  // Calculate week start (Monday 12:00 AM)
  const getWeekStart = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const weekStart = getWeekStart();

  const weekStats = useMemo(() => {
    if (!tickets || tickets.length === 0)
      return { csat: 0, open: 0, solved: 0 };

    const weekTickets = tickets.filter((t) => {
      const createdDate = t.created_date ? new Date(t.created_date) : null;
      return createdDate && createdDate >= weekStart;
    });

    // CSAT count (positive ratings this week)
    const csatCount = weekTickets.filter((t) => {
      const rating = Number(t.custom_fields?.tnt__csatrating);
      return rating === 2;
    }).length;

    // Open tickets this week
    const openCount = weekTickets.filter((t) => {
      const stage = t.stage?.name?.toLowerCase() || "";
      return !stage.includes("solved") && !stage.includes("closed");
    }).length;

    // Solved tickets this week
    const solvedCount = weekTickets.filter((t) => {
      const closedDate = t.actual_close_date
        ? new Date(t.actual_close_date)
        : null;
      return closedDate && closedDate >= weekStart;
    }).length;

    return { csat: csatCount, open: openCount, solved: solvedCount };
  }, [tickets, weekStart]);

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
      <span className="text-xs font-medium text-slate-400">This Month</span>
      <div className="flex items-center gap-6">
        <div className="text-center">
          <div className="text-lg font-bold text-emerald-600">
            {weekStats.csat}
          </div>
          <div className="text-[10px] text-slate-400 uppercase">DSAT</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-blue-600">
            {weekStats.open}
          </div>
          <div className="text-[10px] text-slate-400 uppercase">Open</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-indigo-600">
            {weekStats.solved}
          </div>
          <div className="text-[10px] text-slate-400 uppercase">Solved</div>
        </div>
      </div>
    </div>
  );
};

export default ThisWeekStats;
