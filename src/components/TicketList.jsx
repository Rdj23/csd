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
  Briefcase,
  UserCircle,
} from "lucide-react";
import { useTicketStore } from "../store";
import { FLAT_TEAM_MAP, STAGE_MAP, displayRWT } from "../utils";
import RemarkPopover from "./RemarkPopover";

const ITEMS_PER_PAGE = 20;

const TicketList = ({ tickets, isCSDView }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({
    key: "priority",
    direction: "desc",
  });
  const [openRemarkId, setOpenRemarkId] = useState(null); // Track WHICH ticket has the popover open

  const sortedTickets = [...tickets].sort((a, b) => {
    if (sortConfig.key === "days")
      return sortConfig.direction === "asc" ? a.days - b.days : b.days - a.days;
    if (sortConfig.key === "rwt")
      return sortConfig.direction === "asc"
        ? a.rwtMs - b.rwtMs
        : b.rwtMs - a.rwtMs;
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

  return (
    <div className="space-y-6 animate-in fade-in pb-20">
      {/* STATS CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-emerald-50 border border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20 p-5 rounded-xl flex justify-between shadow-sm">
          <div>
            <p className="text-[10px] font-bold text-emerald-800 dark:text-emerald-400 uppercase">
              Healthy <span className="opacity-70">({labels.green})</span>
            </p>
            <p className="text-3xl font-bold mt-1 text-emerald-700 dark:text-emerald-300">
              {stats.green}
            </p>
          </div>
          <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="bg-amber-50 border border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20 p-5 rounded-xl flex justify-between shadow-sm">
          <div>
            <p className="text-[10px] font-bold text-amber-800 dark:text-amber-400 uppercase">
              Attention <span className="opacity-70">({labels.yellow})</span>
            </p>
            <p className="text-3xl font-bold mt-1 text-amber-700 dark:text-amber-300">
              {stats.yellow}
            </p>
          </div>
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="bg-rose-50 border border-rose-100 dark:bg-rose-500/10 dark:border-rose-500/20 p-5 rounded-xl flex justify-between shadow-sm">
          <div>
            <p className="text-[10px] font-bold text-rose-800 dark:text-rose-400 uppercase">
              Action <span className="opacity-70">({labels.red})</span>
            </p>
            <p className="text-3xl font-bold mt-1 text-rose-700 dark:text-rose-300">
              {stats.red}
            </p>
          </div>
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-visible flex flex-col transition-colors">
        <div className="overflow-x-auto min-h-[400px]">
          {" "}
          {/* Min height to allow popover expansion if last row */}
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-4 w-[22%] align-middle">Ticket</th>
                <th className="p-4 w-[8%] align-middle">Region</th>
                <th className="p-4 w-[10%] align-middle">Owner</th>
                <th className="p-4 w-[10%] align-middle">CSM</th>
                <th className="p-4 w-[10%] align-middle">TAM</th>
                <th
                  className="p-4 w-[10%] align-middle cursor-pointer hover:text-slate-800 dark:hover:text-slate-200"
                  onClick={() => handleSort("rwt")}
                >
                  <div className="flex items-center gap-1">
                    Wait Time <ArrowUpDown className="w-3 h-3 text-slate-300" />
                  </div>
                </th>
                <th className="p-4 w-[10%] align-middle">Stage</th>
                <th
                  className="p-4 w-[8%] align-middle cursor-pointer hover:text-slate-800 dark:hover:text-slate-200"
                  onClick={() => handleSort("days")}
                >
                  <div className="flex items-center gap-1">
                    Age <ArrowUpDown className="w-3 h-3 text-slate-300" />
                  </div>
                </th>
                <th className="p-4 w-[12%] align-middle">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {paginatedTickets.map((t) => {
                const ownerName =
                  FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "Unassigned";
                const stageLabel =
                  STAGE_MAP[t.stage?.name]?.label || t.stage?.name;
                const stageStyle =
                  STAGE_MAP[t.stage?.name]?.color ||
                  "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
                const StatusIcon = t.uiIcon;
                const csmName =
                  t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "-";
                const tamName = t.tam && t.tam !== "Unknown" ? t.tam : "-";

                return (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors group text-sm"
                  >
                    {/* TICKET DETAILS */}
                    <td className="p-4 align-middle">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 font-bold">
                          {t.display_id}
                        </span>
                        <a
                          href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                          target="_blank"
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-indigo-600"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        {t.isCSD && (
                          <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-500/30">
                            CSD
                          </span>
                        )}
                      </div>
                      <div
                        className="text-xs text-slate-900 dark:text-slate-200 font-medium line-clamp-2 leading-relaxed"
                        title={t.title}
                      >
                        {t.title}
                      </div>
                      {t.accountName && (
                        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-slate-600 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded border border-slate-100 dark:border-slate-700 w-fit">
                          <Building2 className="w-3 h-3 text-slate-400 dark:text-slate-500" />{" "}
                          {t.accountName}
                        </div>
                      )}
                    </td>

                    <td className="p-4 align-middle">
                      <span className="text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 whitespace-nowrap">
                        {t.region}
                      </span>
                    </td>

                    <td className="p-4 align-middle">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          {ownerName[0]}
                        </div>
                        <span className="text-sm text-slate-700 dark:text-slate-300">
                          {ownerName}
                        </span>
                      </div>
                    </td>

                    <td className="p-4 align-middle text-slate-600 dark:text-slate-400 text-xs">
                      {csmName !== "-" ? (
                        <div className="flex items-center gap-1">
                          <Briefcase className="w-3 h-3 text-slate-300 dark:text-slate-600" />{" "}
                          {csmName}
                        </div>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">
                          -
                        </span>
                      )}
                    </td>

                    <td className="p-4 align-middle text-slate-600 dark:text-slate-400 text-xs">
                      {tamName !== "-" ? (
                        <div className="flex items-center gap-1">
                          <UserCircle className="w-3 h-3 text-slate-300 dark:text-slate-600" />{" "}
                          {tamName}
                        </div>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">
                          -
                        </span>
                      )}
                    </td>

                    <td className="p-4 align-middle text-slate-600 dark:text-slate-300 text-xs font-medium">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />{" "}
                        {displayRWT(t.rwtMs)}
                      </div>
                    </td>
                    <td className="p-4 align-middle">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${stageStyle}`}
                      >
                        {stageLabel}
                      </span>
                    </td>
                    <td className="p-4 align-middle text-sm text-slate-600 dark:text-slate-300 font-medium tabular-nums whitespace-nowrap">
                      {t.days} Days
                    </td>

                    <td className="p-4 align-middle">
                      <div className="flex items-center gap-2 relative">
                        <span
                          className={`flex items-center w-fit gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap ${t.uiColor}`}
                        >
                          <StatusIcon className="w-3 h-3" /> {t.uiStatus}
                          {t.isCSD && t.priority <= 2 && (
                            <span className="ml-1 pl-1 border-l border-current opacity-75">
                              ⚡
                            </span>
                          )}
                        </span>

                        {/* POPUP TRIGGER & CONTAINER */}
                        {t.priority === 1 && (
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect =
                                  e.currentTarget.getBoundingClientRect();
                                setOpenRemarkId(
                                  openRemarkId === t.id
                                    ? null
                                    : { id: t.id, rect }
                                );
                              }}
                              className={`p-1.5 rounded-md transition-colors ${
                                openRemarkId === t.id
                                  ? "bg-indigo-600 text-white"
                                  : "text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
                              }`}
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                            </button>

                            {openRemarkId?.id === t.id && (
                              <RemarkPopover
                                ticket={t}
                                anchorRect={openRemarkId.rect}
                                onClose={() => setOpenRemarkId(null)}
                              />
                            )}
                          </div>
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
        {sortedTickets.length === 0 && (
          <div className="p-12 text-center text-slate-400 text-sm">
            No tickets found.
          </div>
        )}
      </div>
    </div>
  );
};

export default TicketList;
