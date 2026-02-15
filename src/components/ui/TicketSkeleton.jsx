import React from "react";

const TicketSkeleton = ({ count = 5, showProgress = false, progress = 0 }) => {
  return (
    <div className="space-y-6 animate-in fade-in pb-20">
      {/* Progress Bar */}
      {showProgress && progress < 100 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Loading tickets...
            </span>
            <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
              {progress}%
            </span>
          </div>
          <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 dark:from-indigo-400 dark:to-indigo-500 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
            Showing initial tickets while loading complete data...
          </p>
        </div>
      )}

      {/* Skeleton Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1400px]">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
              <tr className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                <th className="p-4 w-[300px]">Ticket</th>
                <th className="p-4 w-[150px]">Region</th>
                <th className="p-4 w-[180px]">Owner</th>
                <th className="p-4 w-[180px]">CSM</th>
                <th className="p-4 w-[180px]">TAM</th>
                <th className="p-4 w-[120px]">Team</th>
                <th className="p-4 w-[140px]">Assignee</th>
                <th className="p-4 w-[120px]">Stage</th>
                <th className="p-4 w-[100px]">RWT</th>
                <th className="p-4 w-[100px]">Iter</th>
                <th className="p-4 w-[100px]">Age</th>
                <th className="p-4 w-[180px]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {[...Array(count)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {/* Ticket */}
                  <td className="p-4">
                    <div className="space-y-2">
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-20" />
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-32" />
                    </div>
                  </td>
                  {/* Region */}
                  <td className="p-4">
                    <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-16" />
                  </td>
                  {/* Owner */}
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-slate-200 dark:bg-slate-700 rounded-full" />
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-20" />
                    </div>
                  </td>
                  {/* CSM */}
                  <td className="p-4">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24" />
                  </td>
                  {/* TAM */}
                  <td className="p-4">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24" />
                  </td>
                  {/* Team */}
                  <td className="p-4">
                    <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-16" />
                  </td>
                  {/* Assignee */}
                  <td className="p-4">
                    <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-20" />
                  </td>
                  {/* Stage */}
                  <td className="p-4">
                    <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-20" />
                  </td>
                  {/* RWT */}
                  <td className="p-4">
                    <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-12" />
                  </td>
                  {/* Iter */}
                  <td className="p-4">
                    <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-8" />
                  </td>
                  {/* Age */}
                  <td className="p-4">
                    <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-12" />
                  </td>
                  {/* Status */}
                  <td className="p-4">
                    <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-24" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TicketSkeleton;
