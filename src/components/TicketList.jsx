import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  ExternalLink,
  Clock,
  ArrowUpDown,
  CheckCircle,
  AlertTriangle,
  Building2,
} from "lucide-react";
import { FLAT_TEAM_MAP, STAGE_MAP } from "../utils";
import RemarkPopover from "./RemarkPopover";

const ITEMS_PER_PAGE = 20;

// ✅ NEW: Added 'onProfileClick' prop
const TicketList = ({
  tickets,
  isCSDView,
  onCardClick,
  onProfileClick,
  dependencies,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({
    key: "priority",
    direction: "desc",
  });

  const [openRemarkData, setOpenRemarkData] = useState(null);

  // ✅ FIX: Auto-reset to Page 1 when filters/search change the data
  React.useEffect(() => {
    setCurrentPage(1);
  }, [tickets]);

  const sortedTickets = [...tickets].sort((a, b) => {
    if (sortConfig.key === "days")
      return sortConfig.direction === "asc" ? a.days - b.days : b.days - a.days;
    if (sortConfig.key === "rwt") {
      const valA = a.rwt || 0;
      const valB = b.rwt || 0;
      return sortConfig.direction === "asc" ? valA - valB : valB - valA;
    }

    return b.priority - a.priority || a.days - b.days;
  });
  const handleSort = (key) =>
    setSortConfig((c) => ({
      key,
      direction: c.key === key && c.direction === "desc" ? "asc" : "desc",
    }));

  const totalPages = Math.ceil(sortedTickets.length / ITEMS_PER_PAGE);
  const paginatedTickets = sortedTickets.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const stats = {
    red: tickets.filter((t) => t.priority === 1).length,
    yellow: tickets.filter((t) => t.priority === 2).length,
    green: tickets.filter((t) => t.priority === 3).length,
  };

  const labels = isCSDView
    ? { red: "> 7 Days", yellow: "3-7 Days", green: "< 3 Days" }
    : { red: "> 15 Days", yellow: "10-15 Days", green: "< 10 Days" };

  const KPICard = ({
    count,
    label,
    borderClass,
    icon: Icon,
    filterVal,
    textClassLight,
    textClassDark,
  }) => (
    <button
      onClick={() => onCardClick(filterVal)}
      className={`relative overflow-hidden group transition-all duration-200 p-5 rounded-xl border flex justify-between shadow-sm hover:shadow-md text-left w-full 
      bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 ${borderClass}`}
    >
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 text-slate-500 dark:text-slate-400 mb-1">
          {label}
        </p>
        <p
          className={`text-3xl font-extrabold tracking-tight ${textClassLight} ${textClassDark}`}
        >
          {count}
        </p>
      </div>
      <div className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-700 flex items-center justify-center group-hover:scale-110 transition-transform">
        <Icon className="w-5 h-5 text-slate-400 dark:text-slate-300" />
      </div>
    </button>
  );
 

  return (
    <div className="space-y-6 animate-in fade-in pb-20 relative">
      {/* 2. TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-colors relative">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse min-w-[1400px]">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
              <tr>
                {/* 1. Ticket (Sticky Left) */}
                <th className="p-4 w-[300px] align-middle sticky left-0 z-20 bg-slate-50 dark:bg-slate-800 border-r border-slate-100 dark:border-slate-800 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                  Ticket
                </th>
                {/* 2. Region */}
                <th className="p-4 w-[150px] align-middle">Region</th>
                {/* 3. Owner */}
                <th className="p-4 w-[180px] align-middle">Owner</th>
                {/* 4. CSM */}
                <th className="p-4 w-[180px] align-middle">CSM</th>
                {/* 5. TAM */}
                <th className="p-4 w-[180px] align-middle">TAM</th>
                <th className="p-3 font-medium text-center w-[120px]">
                  <div className="flex items-center justify-center gap-1">
                    Team
                  </div>
                </th>
                <th className="p-3 font-medium text-center w-[140px]">
                  <div className="flex items-center justify-center gap-1">
                    Assignee
                  </div>
                </th>
                {/* 8. Stage */}
                <th className="p-4 w-[120px] align-middle">Stage</th>

                {/* 9. Age (Sticky Right 1) */}
                <th
                  className="p-4 w-[100px] align-middle sticky right-[180px] z-20 bg-slate-50 dark:bg-slate-800 border-l border-slate-100 dark:border-slate-800 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)] cursor-pointer"
                  onClick={() => handleSort("days")}
                >
                  <div className="flex items-center gap-1">
                    Age <ArrowUpDown className="w-3 h-3 text-slate-300" />
                  </div>
                </th>

                {/* 10. Status (Sticky Right 2) */}
                <th className="p-4 w-[180px] min-w-[180px] align-middle sticky right-0 z-20 bg-slate-50 dark:bg-slate-800 shadow-[-5px_0_5px_-5px_rgba(0,0,0,0.1)]">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {paginatedTickets.map((t) => {
                const ownerName =
                  FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "Unassigned";
                const csmName =
                  t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "-";
                const tamName = t.tam && t.tam !== "Unknown" ? t.tam : "-";
                const ticketId = t.display_id?.replace("TKT-", "");
                const dep = dependencies[ticketId];
                const primary = dep?.primary;

                return (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors group text-sm"
                  >
                    {/* 1. Ticket (Sticky Left) */}
                    <td className="p-4 align-middle sticky left-0 z-20 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 border-r border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-slate-500 font-bold">
                          {t.display_id}
                        </span>
                        <a
                          href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-400 hover:text-indigo-600"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div
                        className="text-sm font-semibold text-slate-900 dark:text-slate-200 line-clamp-2"
                        title={t.title}
                      >
                        {t.title}
                      </div>
                      {t.accountName && (
                        <div className="mt-2 text-[10px] text-slate-500 flex items-center gap-1">
                          <Building2 className="w-3 h-3" /> {t.accountName}
                        </div>
                      )}
                    </td>

                    {/* 2. Region */}
                    <td className="px-4 py-3 align-middle">
                      <span className="text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                        {t.region}
                      </span>
                    </td>

                    {/* 3. Owner (Clickable) */}
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                          {ownerName[0]}
                        </div>
                        <button
                          onClick={() =>
                            onProfileClick &&
                            onProfileClick({ name: ownerName })
                          }
                          className="text-sm text-slate-700 dark:text-slate-300 hover:text-indigo-600 hover:underline text-left font-medium"
                        >
                          {ownerName}
                        </button>
                      </div>
                    </td>

                    {/* 4. CSM */}
                    <td className="p-4 align-middle text-slate-600 dark:text-slate-400 text-xs">
                      {csmName}
                    </td>

                    {/* 5. TAM */}
                    <td className="p-4 align-middle text-slate-600 dark:text-slate-400 text-xs">
                      {tamName}
                    </td>

                    {/* 6. RWT */}
                    <td className="p-3 text-center">
                      {dep?.hasDependency ? (
                        <span
                          className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                            primary?.team === "NOC"
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                              : primary?.team === "Whatsapp"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : primary?.team === "Billing"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : primary?.team === "Email"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {primary?.team || "Unknown"}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">-</span>
                      )}
                    </td>

                    {/* Dependency Assignee */}
                    <td className="p-3 text-center">
                      {dep?.hasDependency && primary ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                            {primary.owner}
                          </span>
                          {primary.issueId && (
                            <a
                              href={`https://app.devrev.ai/clevertapsupport/works/${primary.issueId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-indigo-500 hover:underline font-mono"
                            >
                              {primary.issueId}
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">-</span>
                      )}
                    </td>

                    {/* 7. Iterations */}

                    {/* 8. Stage */}
                    <td className="px-4 py-3 align-middle">
                      <span className="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800">
                        {STAGE_MAP[t.stage?.name]?.label || t.stage?.name}
                      </span>
                    </td>

                    {/* 9. Age (Sticky Right 1) */}
                    <td className="px-2 align-middle sticky right-[180px] z-20 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 border-l border-slate-100 dark:border-slate-800">
                      <span className="text-sm font-medium">{t.days} Days</span>
                    </td>

                    {/* 10. Status (Sticky Right 2) */}
                    <td className="p-4 align-middle min-w-[180px] w-[180px] sticky right-0 z-20 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 shadow-[-5px_0_10px_-5px_rgba(0,0,0,0.1)] border-l border-transparent">
                      <div className="flex items-center gap-2 relative">
                        <span
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap ${t.uiColor}`}
                        >
                          <t.uiIcon className="w-3 h-3" /> {t.uiStatus}
                        </span>

                        {t.priority === 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect =
                                e.currentTarget.getBoundingClientRect();
                              setOpenRemarkData({ ticket: t, rect });
                            }}
                            className={`p-1.5 rounded-md transition-colors text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20`}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* PAGINATION */}
        {sortedTickets.length > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Page {currentPage} of {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-md hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 disabled:opacity-30 text-slate-500 dark:text-slate-400"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-md hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 disabled:opacity-30 text-slate-500 dark:text-slate-400"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* POPUP */}
      {openRemarkData && (
        <RemarkPopover
          ticket={openRemarkData.ticket}
          anchorRect={openRemarkData.rect}
          onClose={() => setOpenRemarkData(null)}
        />
      )}
    </div>
  );
};

export default TicketList;
