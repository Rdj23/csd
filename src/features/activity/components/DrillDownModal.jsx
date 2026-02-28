import React from "react";
import { X, ExternalLink, Eye, EyeOff, Users, Zap } from "lucide-react";

export default function DrillDownModal({ entries = [], hour, date, user, onClose, isDark }) {
  const title =
    hour === "coop"
      ? `Co-op Tickets — ${user} — ${date}`
      : `Activity — ${user} — ${date} ${hour !== null && hour !== undefined ? `@ ${String(hour).padStart(2, "0")}:00` : ""}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {entries.length === 0 ? (
            <div className="text-center text-slate-400 py-12 text-sm">No entries found</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                  <th className="pb-2 font-medium">Ticket</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium text-center">Pts</th>
                  <th className="pb-2 font-medium text-center">Co-op</th>
                  <th className="pb-2 font-medium">Cohort</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr
                    key={e.entry_id || i}
                    className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-2 font-mono text-xs text-indigo-600 dark:text-indigo-400">
                      {e.ticket_display_id || "—"}
                    </td>
                    <td className="py-2">
                      {e.visibility === "external" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                          <Eye className="w-3 h-3" /> Ext
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <EyeOff className="w-3 h-3" /> Int
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-slate-500 dark:text-slate-400">
                      {e.created_date ? new Date(e.created_date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—"}
                    </td>
                    <td className="py-2 text-center">
                      {e.points > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                          <Zap className="w-3 h-3" />{e.points}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">0</span>
                      )}
                    </td>
                    <td className="py-2 text-center">
                      {e.is_coop ? (
                        <Users className="w-3.5 h-3.5 text-purple-500 mx-auto" />
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[100px]">
                      {e.account_cohort || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-400 text-right">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </div>
      </div>
    </div>
  );
}
