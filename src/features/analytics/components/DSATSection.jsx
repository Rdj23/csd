// ============================================================================
// DSAT ALERTS COMPONENT (Only for GST users, only active/unsolved)
// ============================================================================
import React, { useState } from "react";
import { AlertCircle, Eye, EyeOff, ExternalLink, Frown } from "lucide-react";

const DSATAlerts = ({ badTickets = [], isLoading, isGSTUser }) => {
  const [showAll, setShowAll] = useState(false);

  // Filter to only show active (unsolved) DSAT tickets
  const activeBAD = badTickets.filter((t) => {
    const stage = t.stage?.name?.toLowerCase() || "";
    return !stage.includes("solved") && !stage.includes("closed");
  });

  const displayTickets = showAll ? activeBAD : activeBAD.slice(0, 6);

  // Only show for GST users
  if (!isGSTUser || (!activeBAD.length && !isLoading)) return null;

  return (
    <div className="bg-gradient-to-br from-rose-50 to-white dark:from-rose-900/10 dark:to-slate-900 border border-rose-200 dark:border-rose-900/50 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-rose-100 dark:border-rose-900/30 flex justify-between items-center">
        <h3 className="text-base font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> Active Negative Feedback (
          {activeBAD.length})
        </h3>
        {activeBAD.length > 6 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs font-semibold text-rose-600 flex items-center gap-1"
          >
            {showAll ? (
              <EyeOff className="w-3 h-3" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            {showAll ? "Show Less" : `Show All`}
          </button>
        )}
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayTickets.map((t) => (
          <div
            key={t.id || t.display_id}
            className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-rose-100 dark:border-rose-900/30 group"
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                {t.display_id}
              </span>
              <a
                href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 line-clamp-2 mb-3">
              {t.title}
            </p>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-600 bg-rose-50 dark:bg-rose-900/30 px-2 py-1 rounded-full">
                <Frown className="w-3 h-3" /> BAD
              </div>
              <span className="text-[10px] text-slate-400">{t.owner}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DSATAlerts;
