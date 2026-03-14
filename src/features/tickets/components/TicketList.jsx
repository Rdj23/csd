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

const SENTIMENT_EMOJI = {
  delighted: "😄",
  happy: "😊",
  neutral: "😐",
  frustrated: "😤",
  unhappy: "😞",
};
const getSentimentEmoji = (label) =>
  label ? SENTIMENT_EMOJI[label.toLowerCase()] : null;
import { FLAT_TEAM_MAP, STAGE_MAP } from "../../../utils";
import RemarkPopover from "../../remarks/components/RemarkPopover";

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
    if (sortConfig.key === "itr") {
      const valA = a.iterations || 0;
      const valB = b.iterations || 0;
      return sortConfig.direction === "asc" ? valA - valB : valB - valA;
    }
    if (sortConfig.key === "ct_updated") {
      const valA = new Date(a.custom_fields?.tnt__last_devu_message_ts || 0).getTime();
      const valB = new Date(b.custom_fields?.tnt__last_devu_message_ts || 0).getTime();
      return sortConfig.direction === "asc" ? valA - valB : valB - valA;
    }
    if (sortConfig.key === "cust_updated") {
      const valA = new Date(a.custom_fields?.tnt__last_revu_message_ts || 0).getTime();
      const valB = new Date(b.custom_fields?.tnt__last_revu_message_ts || 0).getTime();
      return sortConfig.direction === "asc" ? valA - valB : valB - valA;
    }
    if (sortConfig.key === "sentiment") {
      const sentimentOrder = { delighted: 5, happy: 4, neutral: 3, frustrated: 2, unhappy: 1 };
      const valA = sentimentOrder[a.sentimentLabel?.toLowerCase()] || 0;
      const valB = sentimentOrder[b.sentimentLabel?.toLowerCase()] || 0;
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
      className={`relative group text-left w-full rounded-xl border overflow-hidden
        transition-all duration-200 hover:-translate-y-0.5
        bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800
        hover:shadow-md`}
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      {/* Color accent bar (left) */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${borderClass.replace('border-l-4 border-l-', 'bg-')}`} />
      <div className="pl-5 pr-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5">
            {label}
          </p>
          <p className={`text-3xl font-bold tracking-tight leading-none ${textClassLight} ${textClassDark}`}>
            {count}
          </p>
        </div>
        <div className="w-9 h-9 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
          <Icon className={`w-4.5 h-4.5 ${textClassLight} ${textClassDark} opacity-70`} />
        </div>
      </div>
    </button>
  );
 

  return (
    <div className="space-y-3 animate-fade-in pb-20 relative">
      {/* TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-all duration-300"
           style={{ boxShadow: 'var(--shadow-card)' }}>
        {paginatedTickets.length === 0 && sortedTickets.length === 0 ? (
          // Empty state
          <div className="min-h-[400px] flex flex-col items-center justify-center px-6 py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Inbox className="w-8 h-8 text-slate-400 dark:text-slate-500" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-slate-700 dark:text-slate-300">No tickets found</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Adjust your filters or try a different search</p>
              </div>
            </div>
          </div>
        ) : (
        <div className="overflow-x-auto min-h-[400px] scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent hover:scrollbar-thumb-slate-400 dark:hover:scrollbar-thumb-slate-500">
          <table className="w-full text-left border-collapse min-w-[1600px]">
            <thead className="bg-gradient-to-b from-slate-50 to-slate-40 dark:from-slate-800/80 dark:to-slate-800/50 border-b border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-widest font-semibold sticky top-0 z-10">
              <tr>
                {/* 1. Ticket (Sticky Left) */}
                <th className="px-4 py-3 w-[320px] align-middle sticky left-0 z-30 bg-slate-50 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700/60 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.1)]">
                  Ticket
                </th>
                <th className={`px-4 py-3 w-[100px] align-middle cursor-pointer select-none transition-colors duration-200 ${
                  sortConfig.key === "sentiment"
                    ? "text-slate-700 dark:text-slate-200 bg-indigo-50/30 dark:bg-indigo-900/20"
                    : "hover:text-slate-600 dark:hover:text-slate-300"
                }`} onClick={() => handleSort("sentiment")}>
                  <div className="flex items-center gap-1">
                    Sentiment <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === "sentiment" ? "opacity-100" : "opacity-50"}`} />
                  </div>
                </th>
                <th className="px-4 py-3 w-[150px] align-middle">Region</th>
                <th className="px-4 py-3 w-[120px] align-middle">Cohort</th>
                <th className="px-4 py-3 w-[180px] align-middle">Owner</th>
                <th className="px-4 py-3 w-[180px] align-middle">CSM</th>
                <th className="px-4 py-3 w-[180px] align-middle">TAM</th>
                <th className="px-3 py-3 text-center w-[120px]">Team</th>
                <th className="px-3 py-3 text-center w-[140px]">Assignee</th>
                <th className="px-4 py-3 w-[120px] align-middle">Stage</th>
                <th className={`px-4 py-3 w-[100px] align-middle text-center cursor-pointer select-none transition-colors duration-200 ${
                  sortConfig.key === "rwt"
                    ? "text-slate-700 dark:text-slate-200 bg-indigo-50/30 dark:bg-indigo-900/20"
                    : "hover:text-slate-600 dark:hover:text-slate-300"
                }`} onClick={() => handleSort("rwt")}>
                  <div className="flex items-center justify-center gap-1">
                    RWT <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === "rwt" ? "opacity-100" : "opacity-50"}`} />
                  </div>
                </th>
                <th className={`px-4 py-3 w-[100px] align-middle text-center cursor-pointer select-none transition-colors duration-200 ${
                  sortConfig.key === "itr"
                    ? "text-slate-700 dark:text-slate-200 bg-indigo-50/30 dark:bg-indigo-900/20"
                    : "hover:text-slate-600 dark:hover:text-slate-300"
                }`} onClick={() => handleSort("itr")}>
                  <div className="flex items-center justify-center gap-1">
                    ITR <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === "itr" ? "opacity-100" : "opacity-50"}`} />
                  </div>
                </th>

                {/* Age (Sticky Right 1) */}
                <th
                  className={`px-3 py-3 w-[85px] align-middle sticky right-[360px] z-20 border-l border-slate-200 dark:border-slate-700/60 shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.08)] cursor-pointer select-none transition-colors duration-200 ${
                    sortConfig.key === "days"
                      ? "bg-indigo-50/50 dark:bg-indigo-900/20 text-slate-700 dark:text-slate-200"
                      : "bg-slate-50 dark:bg-slate-800/80 hover:text-slate-600 dark:hover:text-slate-300"
                  }`}
                  onClick={() => handleSort("days")}
                >
                  <div className="flex items-center gap-1">
                    Age <ArrowUpDown className={`w-3 h-3 ${sortConfig.key === "days" ? "opacity-100" : "opacity-50"}`} />
                  </div>
                </th>

                {/* CT Updated (Sticky Right 2) */}
                <th
                  className={`px-3 py-3 w-[120px] align-middle sticky right-[275px] z-20 border-l border-slate-200 dark:border-slate-700/60 cursor-pointer select-none transition-colors duration-200 ${
                    sortConfig.key === "ct_updated"
                      ? "bg-indigo-50/50 dark:bg-indigo-900/20 text-slate-700 dark:text-slate-200"
                      : "bg-slate-50 dark:bg-slate-800/80 hover:text-slate-600 dark:hover:text-slate-300"
                  }`}
                  onClick={() => handleSort("ct_updated")}
                >
                  <div className="flex items-center gap-1 text-[9px]">
                    CT Reply <ArrowUpDown className={`w-2.5 h-2.5 ${sortConfig.key === "ct_updated" ? "opacity-100" : "opacity-50"}`} />
                  </div>
                </th>

                {/* Customer Updated (Sticky Right 3) */}
                <th
                  className={`px-3 py-3 w-[120px] align-middle sticky right-[155px] z-20 border-l border-slate-200 dark:border-slate-700/60 cursor-pointer select-none transition-colors duration-200 ${
                    sortConfig.key === "cust_updated"
                      ? "bg-indigo-50/50 dark:bg-indigo-900/20 text-slate-700 dark:text-slate-200"
                      : "bg-slate-50 dark:bg-slate-800/80 hover:text-slate-600 dark:hover:text-slate-300"
                  }`}
                  onClick={() => handleSort("cust_updated")}
                >
                  <div className="flex items-center gap-1 text-[9px]">
                    Cust Reply <ArrowUpDown className={`w-2.5 h-2.5 ${sortConfig.key === "cust_updated" ? "opacity-100" : "opacity-50"}`} />
                  </div>
                </th>

                {/* Status (Sticky Right 4) */}
                <th className="px-3 py-3 w-[155px] min-w-[155px] align-middle sticky right-0 z-20 bg-slate-50 dark:bg-slate-800/80 shadow-[-4px_0_4px_-2px_rgba(0,0,0,0.08)]">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
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
                    className="hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10 transition-colors duration-150 group text-sm hover:shadow-sm"
                  >
                    {/* 1. Ticket (Sticky Left) */}
                    <td className="px-4 py-3.5 w-[320px] align-middle sticky left-0 z-30 bg-white dark:bg-slate-900 group-hover:bg-indigo-50/40 dark:group-hover:bg-indigo-900/10 border-r border-slate-100 dark:border-slate-800 transition-colors duration-150 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.05)]">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                          {t.display_id}
                        </span>
                        <a
                          href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-300 dark:text-slate-600 hover:text-indigo-500 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div
                        className="text-[13px] font-medium text-slate-900 dark:text-slate-100 line-clamp-2 leading-snug"
                        title={t.title}
                      >
                        {t.title}
                      </div>
                      {t.accountName && (
                        <div className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                          <Building2 className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{t.accountName}</span>
                        </div>
                      )}
                    </td>

                    {/* Sentiment Column */}
                    <td className="px-4 py-3.5 align-middle text-center">
                      {getSentimentEmoji(t.sentimentLabel) ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-2xl leading-none" title={t.sentimentLabel}>
                            {getSentimentEmoji(t.sentimentLabel)}
                          </span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 capitalize font-medium">
                            {t.sentimentLabel || "—"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>
                      )}
                    </td>

                    {/* 2. Region */}
                    <td className="px-4 py-3.5 align-middle">
                      <span className="badge badge-neutral text-[10px]">
                        {t.region}
                      </span>
                    </td>

                    {/* 2b. Cohort */}
                    <td className="px-4 py-3.5 align-middle">
                      {(() => {
                        const label = t.cohort
                          ? t.cohort.replace(/\s*Accounts?\s*$/i, "")
                          : "c4s";
                        const cohortColor =
                          label === "Enterprise"
                            ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                            : label === "Key Commercial"
                              ? "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
                              : label === "Commercial"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
                        return (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${cohortColor}`}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>

                    {/* 3. Owner (Clickable) */}
                    <td className="px-4 py-3.5 align-middle">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 flex-shrink-0">
                          {ownerName[0]}
                        </div>
                        <button
                          onClick={() =>
                            onProfileClick &&
                            onProfileClick({ name: ownerName })
                          }
                          className="text-[13px] text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline text-left font-medium transition-colors"
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

                    {/* 8. Stage */}
                    <td className="px-4 py-3 align-middle">
                      <span className="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800">
                        {STAGE_MAP[t.stage?.name]?.label || t.stage?.name}
                      </span>
                    </td>

                    {/* 9. RWT */}
                    <td className="px-4 py-3 align-middle text-center">
                      {t.rwt != null ? (
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          t.rwt > 24
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                            : t.rwt > 12
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        }`}>
                          {Number(t.rwt).toFixed(1)}h
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">-</span>
                      )}
                    </td>

                    {/* 10. Iterations */}
                    <td className="px-4 py-3 align-middle text-center">
                      {t.iterations != null ? (
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          t.iterations > 5
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                            : t.iterations > 3
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}>
                          {t.iterations}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">-</span>
                      )}
                    </td>

                    {/* 11. Age (Sticky Right 1) */}
                    <td className="px-2 py-3.5 align-middle sticky right-[360px] z-20 bg-white dark:bg-slate-900 group-hover:bg-indigo-50/40 dark:group-hover:bg-indigo-900/10 border-l border-slate-100 dark:border-slate-800 transition-colors duration-150">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{t.days}d</span>
                    </td>

                    {/* 12. CT Updated (Sticky Right 2) */}
                    <td className="px-2 py-3.5 align-middle sticky right-[275px] z-20 bg-white dark:bg-slate-900 group-hover:bg-indigo-50/40 dark:group-hover:bg-indigo-900/10 border-l border-slate-100 dark:border-slate-800 transition-colors duration-150">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap block text-center">
                        {t.custom_fields?.tnt__last_devu_message_ts
                          ? new Date(t.custom_fields.tnt__last_devu_message_ts).toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            }).replace(/,/g, " ")
                          : "-"}
                      </span>
                    </td>

                    {/* 13. Customer Updated (Sticky Right 3) */}
                    <td className="px-2 py-3.5 align-middle sticky right-[155px] z-20 bg-white dark:bg-slate-900 group-hover:bg-indigo-50/40 dark:group-hover:bg-indigo-900/10 border-l border-slate-100 dark:border-slate-800 transition-colors duration-150">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap block text-center">
                        {t.custom_fields?.tnt__last_revu_message_ts
                          ? new Date(t.custom_fields.tnt__last_revu_message_ts).toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            }).replace(/,/g, " ")
                          : "-"}
                      </span>
                    </td>

                    {/* 14. Status (Sticky Right 4) */}
                    <td className="p-3 align-middle min-w-[155px] w-[155px] sticky right-0 z-20 bg-white dark:bg-slate-900 group-hover:bg-indigo-50/40 dark:group-hover:bg-indigo-900/10 shadow-[-5px_0_10px_-5px_rgba(0,0,0,0.1)] border-l border-transparent transition-colors duration-150">
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
        )}


        {/* PAGINATION */}
        {sortedTickets.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800/60 bg-gradient-to-r from-slate-50 to-slate-40/50 dark:from-slate-800/30 dark:to-slate-900/20">
            <div className="text-[11px] text-slate-400 dark:text-slate-500 font-medium tabular-nums">
              {(currentPage - 1) * 20 + 1}–{Math.min(currentPage * 20, sortedTickets.length)} of {sortedTickets.length} tickets
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 disabled:opacity-30 text-slate-500 dark:text-slate-400 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 px-2 tabular-nums">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 disabled:opacity-30 text-slate-500 dark:text-slate-400 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
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
