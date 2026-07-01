// ============================================================================
// DRILL DOWN MODAL - Shows tickets for a specific data point
// ============================================================================
import React, { useState, useEffect } from "react";
import { format, parseISO, differenceInDays } from "date-fns";
import {
  X,
  ChevronLeft,
  AlertCircle,
  ExternalLink,
  Search,
  Download,
} from "lucide-react";
import {
  FLAT_TEAM_MAP,
  DEPENDENCY_EXPORT_HEADERS,
  getDependencyExportCells,
} from "../../../../utils";

const DrillDownModal = ({
  isOpen,
  onClose,
  title,
  tickets,
  metricKey,
  summary,
  dependencies = {},
}) => {
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({
    key: "created_date",
    direction: "desc",
  });
  const pageSize = 25;

  // Reset state when modal opens with new data
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1);
      setSearch("");
    }
  }, [isOpen, tickets]);

  if (!isOpen) return null;

  const getMetricValue = (t) => {
    switch (metricKey) {
      case "avgRWT":
      case "rwt":
        return t.custom_fields?.tnt__rwt_business_hours || t.rwt || 0;
      case "avgFRT":
        return t.custom_fields?.tnt__frt_hours || t.frt || 0;
      case "frrPercent":
        return t.custom_fields?.tnt__frr === true ||
          t.custom_fields?.tnt__iteration_count === 1 ||
          t.frr === 1
          ? 1
          : 0;
      case "csat":
        return t.custom_fields?.tnt__csatrating || t.csat || 0;
      case "avgIterations":
        return t.custom_fields?.tnt__iteration_count || t.iterations || 0;
      case "volume":
        return new Date(t.created_date || 0).getTime();
      case "solved":
        return new Date(t.actual_close_date || t.closed_date || 0).getTime();
      case "backlog":
        if (t.created_date && (t.actual_close_date || t.closed_date)) {
          return differenceInDays(
            parseISO(t.actual_close_date || t.closed_date),
            parseISO(t.created_date),
          );
        }
        return 0;
      default:
        return 0;
    }
  };

  const getMetricDisplay = (t) => {
    switch (metricKey) {
      case "avgRWT":
      case "rwt":
        const rwt = t.custom_fields?.tnt__rwt_business_hours || t.rwt;
        return rwt ? `${Number(rwt).toFixed(1)} hrs` : "-";
      case "avgFRT":
        const frt = t.custom_fields?.tnt__frt_hours || t.frt;
        return frt ? `${Number(frt).toFixed(1)} hrs` : "-";
      case "frrPercent":
        return t.custom_fields?.tnt__frr === true ||
          t.custom_fields?.tnt__iteration_count === 1 ||
          t.frr === 1 ? (
          <span className="text-emerald-600">✓ Yes</span>
        ) : (
          <span className="text-rose-500">✗ No</span>
        );
      case "csat":
        const rating = t.custom_fields?.tnt__csatrating || t.csat;
        return rating === 2 ? (
          <span className="text-emerald-600">👍 Good</span>
        ) : rating === 1 ? (
          <span className="text-rose-500">👎 Bad</span>
        ) : (
          "-"
        );
      case "avgIterations":
        return t.custom_fields?.tnt__iteration_count || t.iterations || "-";
      case "volume":
        return t.created_date
          ? format(parseISO(t.created_date), "MMM dd")
          : "-";
      case "solved":
        const closedDate = t.actual_close_date || t.closed_date;
        return closedDate ? format(parseISO(closedDate), "MMM dd") : "-";
      case "backlog":
        if (t.created_date && (t.actual_close_date || t.closed_date)) {
          const age = differenceInDays(
            parseISO(t.actual_close_date || t.closed_date),
            parseISO(t.created_date),
          );
          return `${age} days`;
        }
        return "-";
      default:
        return "-";
    }
  };

  // Filter tickets
  const searchedTickets = (tickets || []).filter((t) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    const owner =
      FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
      t.owned_by?.[0]?.display_name ||
      t.owner ||
      "";
    return (
      t.display_id?.toLowerCase().includes(searchLower) ||
      t.title?.toLowerCase().includes(searchLower) ||
      (t.custom_fields?.tnt__instance_account_name || t.account_name || "")
        .toLowerCase()
        .includes(searchLower) ||
      owner.toLowerCase().includes(searchLower)
    );
  });

  // Sort tickets
  const sortedTickets = [...searchedTickets].sort((a, b) => {
    let aVal, bVal;

    switch (sortConfig.key) {
      case "created_date":
        aVal = new Date(a.created_date || 0).getTime();
        bVal = new Date(b.created_date || 0).getTime();
        break;
      case "solved_date":
        aVal = new Date(a.actual_close_date || a.closed_date || 0).getTime();
        bVal = new Date(b.actual_close_date || b.closed_date || 0).getTime();
        break;
      case "metric":
        aVal = getMetricValue(a);
        bVal = getMetricValue(b);
        break;
      case "owner":
        aVal =
          FLAT_TEAM_MAP[a.owned_by?.[0]?.display_id] ||
          a.owned_by?.[0]?.display_name ||
          a.owner ||
          "";
        bVal =
          FLAT_TEAM_MAP[b.owned_by?.[0]?.display_id] ||
          b.owned_by?.[0]?.display_name ||
          b.owner ||
          "";
        break;
      default:
        aVal = a[sortConfig.key] || "";
        bVal = b[sortConfig.key] || "";
    }

    if (sortConfig.direction === "asc") {
      return aVal > bVal ? 1 : -1;
    }
    return aVal < bVal ? 1 : -1;
  });

  const totalPages = Math.ceil(sortedTickets.length / pageSize);
  const paginatedTickets = sortedTickets.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
  };

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column)
      return <span className="text-slate-300 ml-1">↕</span>;
    return (
      <span className="text-indigo-500 ml-1">
        {sortConfig.direction === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const getMetricColumnLabel = () => {
    switch (metricKey) {
      case "avgRWT":
      case "rwt":
        return "RWT";
      case "avgFRT":
        return "FRT";
      case "frrPercent":
        return "FRR";
      case "csat":
        return "CSAT";
      case "avgIterations":
        return "Iterations";
      case "volume":
        return "Created";
      case "solved":
        return "Solved";
      case "backlog":
        return "Age";
      default:
        return "Value";
    }
  };

  // Plain-text metric for CSV (getMetricDisplay returns JSX for FRR/CSAT).
  const getMetricCsvValue = (t) => {
    switch (metricKey) {
      case "avgRWT":
      case "rwt": {
        const rwt = t.custom_fields?.tnt__rwt_business_hours || t.rwt;
        return rwt ? `${Number(rwt).toFixed(1)} hrs` : "-";
      }
      case "avgFRT": {
        const frt = t.custom_fields?.tnt__frt_hours || t.frt;
        return frt ? `${Number(frt).toFixed(1)} hrs` : "-";
      }
      case "frrPercent":
        return t.custom_fields?.tnt__frr === true ||
          t.custom_fields?.tnt__iteration_count === 1 ||
          t.frr === 1
          ? "Yes"
          : "No";
      case "csat": {
        const rating = t.custom_fields?.tnt__csatrating || t.csat;
        return rating === 2 ? "Good" : rating === 1 ? "Bad" : "-";
      }
      case "avgIterations":
        return String(
          t.custom_fields?.tnt__iteration_count || t.iterations || "-",
        );
      case "volume":
        return t.created_date
          ? format(parseISO(t.created_date), "MMM d, yyyy")
          : "-";
      case "solved": {
        const cd = t.actual_close_date || t.closed_date;
        return cd ? format(parseISO(cd), "MMM d, yyyy") : "-";
      }
      case "backlog":
        if (t.created_date && (t.actual_close_date || t.closed_date)) {
          return `${differenceInDays(
            parseISO(t.actual_close_date || t.closed_date),
            parseISO(t.created_date),
          )} days`;
        }
        return "-";
      default:
        return "-";
    }
  };

  // Export the full filtered/sorted set (not just the visible page) to CSV.
  const handleExport = () => {
    if (!sortedTickets.length) return;
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = [
      "Ticket ID",
      "Title",
      "Account",
      "Assignee",
      "Stage",
      "Created Date",
      "Solved Date",
      getMetricColumnLabel(),
      ...DEPENDENCY_EXPORT_HEADERS,
    ];
    const rows = sortedTickets.map((t) => {
      const owner =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        t.owner ||
        "Unassigned";
      const account =
        t.custom_fields?.tnt__instance_account_name ||
        t.account_name ||
        t.account?.display_name ||
        "-";
      const stage = t.stage?.name || t.stage_name || "-";
      const created = t.created_date
        ? format(parseISO(t.created_date), "MMM d, yyyy")
        : "-";
      const closed = t.actual_close_date || t.closed_date;
      const solved = closed ? format(parseISO(closed), "MMM d, yyyy") : "-";
      return [
        t.display_id || t.ticket_id || "-",
        q(t.title || ""),
        q(account),
        q(owner),
        q(stage),
        q(created),
        q(solved),
        q(getMetricCsvValue(t)),
        ...getDependencyExportCells(dependencies, t.display_id || t.ticket_id),
      ].join(",");
    });
    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const safeTitle = (title || "analytics")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "");
    link.download = `Analytics_${safeTitle}_${format(new Date(), "yyyy-MM-dd_HHmm")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800">
        {/* Header with Back Button */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-indigo-50 to-white dark:from-slate-800 dark:to-slate-900">
          <div className="flex items-center gap-4">
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1 text-sm font-medium text-slate-600 dark:text-slate-400"
            >
              <ChevronLeft className="w-5 h-5" />
              Back
            </button>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                {title}
              </h2>
              {summary && (
                <p className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">
                  {summary}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={!sortedTickets.length}
              className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Export these tickets to CSV"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            <span className="text-sm font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
              {sortedTickets.length} tickets
            </span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by ticket ID, title, account, or assignee..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0">
              <tr className="text-xs uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4 text-left font-semibold">Ticket</th>
                <th className="py-3 px-3 text-left font-semibold">Account</th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("owner")}
                >
                  Assignee <SortIcon column="owner" />
                </th>
                <th className="py-3 px-3 text-left font-semibold">Stage</th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("created_date")}
                >
                  Created <SortIcon column="created_date" />
                </th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("solved_date")}
                >
                  Solved <SortIcon column="solved_date" />
                </th>
                <th
                  className="py-3 px-3 text-right font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("metric")}
                >
                  {getMetricColumnLabel()}
                  <SortIcon column="metric" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedTickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle className="w-8 h-8 opacity-50" />
                      <span>No tickets found for this selection</span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedTickets.map((t, idx) => {
                  const owner =
                    FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
                    t.owned_by?.[0]?.display_name ||
                    t.owner ||
                    "Unassigned";
                  return (
                    <tr
                      key={t.id || t.display_id || idx}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <a
                          href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1"
                        >
                          {t.display_id}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <div className="text-xs text-slate-500 truncate max-w-[280px] mt-0.5">
                          {t.title}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400 max-w-[150px] truncate">
                        {t.custom_fields?.tnt__instance_account_name ||
                          t.account_name ||
                          "-"}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {owner}
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                          {t.stage?.name || "Solved"}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-500">
                        {t.created_date
                          ? format(parseISO(t.created_date), "MMM dd, yyyy")
                          : "-"}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-500">
                        {t.actual_close_date || t.closed_date
                          ? format(
                              parseISO(t.actual_close_date || t.closed_date),
                              "MMM dd, yyyy",
                            )
                          : "-"}
                      </td>
                      <td className="py-3 px-3 text-right text-xs font-semibold">
                        {getMetricDisplay(t)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Showing {(currentPage - 1) * pageSize + 1} -{" "}
              {Math.min(currentPage * pageSize, sortedTickets.length)} of{" "}
              {sortedTickets.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 disabled:opacity-50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                First
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 disabled:opacity-50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 disabled:opacity-50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Next
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 disabled:opacity-50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Last
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DrillDownModal;
