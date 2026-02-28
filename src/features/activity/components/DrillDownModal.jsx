import React from "react";
import { X, ExternalLink, Eye, EyeOff, Users, Zap } from "lucide-react";

const DEVREV_BASE = "https://app.devrev.ai/clevertapsupport/works";

export default function DrillDownModal({ entries = [], hour, date, dateRange, user, coopCount, onClose, isDark }) {
  const dateDisplay = dateRange
    ? `${dateRange.start} to ${dateRange.end}`
    : date;

  const title =
    hour === "coop"
      ? `Co-op Tickets — ${user} — ${dateDisplay}`
      : `Activity — ${user} — ${dateDisplay} ${hour !== null && hour !== undefined && hour !== "coop" ? `@ ${String(hour).padStart(2, "0")}:00` : ""}`;

  const coopEntries = entries.filter((e) => e.is_coop);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-5xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <div className="flex items-center gap-3">
            {/* Co-op count badge */}
            {coopCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/30 text-xs font-semibold text-purple-700 dark:text-purple-300">
                <Users className="w-3.5 h-3.5 text-purple-500" />
                {coopCount} co-op
              </span>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
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
                  <th className="pb-2 font-medium">Co-op</th>
                  <th className="pb-2 font-medium">Cohort</th>
                  <th className="pb-2 font-medium">Team</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr
                    key={e.entry_id || i}
                    className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    {/* Clickable ticket link */}
                    <td className="py-2.5">
                      <a
                        href={`${DEVREV_BASE}/${e.ticket_display_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline"
                      >
                        {e.ticket_display_id || "—"}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </a>
                    </td>
                    <td className="py-2.5">
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
                    <td className="py-2.5 text-xs text-slate-500 dark:text-slate-400">
                      {e.created_date ? new Date(e.created_date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—"}
                    </td>
                    <td className="py-2.5 text-center">
                      {e.points > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                          <Zap className="w-3 h-3" />{e.points}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">0</span>
                      )}
                    </td>
                    {/* Co-op: show owner name */}
                    <td className="py-2.5">
                      {e.is_coop ? (
                        <span className="inline-flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 font-medium">
                          <Users className="w-3 h-3 text-purple-500" />
                          {e.coop_with || "Yes"}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
                      {e.account_cohort || "—"}
                    </td>
                    {/* Dependency team */}
                    <td className="py-2.5">
                      {e.dep_team ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300">
                          {e.dep_team}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-400">
          <span>
            {coopEntries.length > 0 && (
              <span className="text-purple-500 font-medium mr-3">
                {coopEntries.length} co-op entr{coopEntries.length === 1 ? "y" : "ies"}
              </span>
            )}
          </span>
          <span>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
        </div>
      </div>
    </div>
  );
}
