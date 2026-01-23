// ============================================================================
// NOC ANALYTICS COMPONENT
// Shows tickets reported to NOC with filtering and pie charts
// ============================================================================
import { useState, useEffect, useMemo } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";

import {
  Search,
  Download,
  Filter,
  ExternalLink,
  AlertTriangle,
  Users,
  PieChart as PieChartIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  UserCircle,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const CHART_COLORS = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#84cc16", // lime
];

const ITEMS_PER_PAGE = 15;

const NOCAnalytics = ({ isLoading: parentLoading }) => {
  const [nocData, setNocData] = useState({
    tickets: [],
    filters: { rcaOptions: [], reporterOptions: [] },
    stats: { total: 0, byReporter: [], byRca: [], byOwner: [] },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRca, setSelectedRca] = useState("all");
  const [selectedReporter, setSelectedReporter] = useState("all");
  const [selectedOwner, setSelectedOwner] = useState("all");
  const [showRcaDropdown, setShowRcaDropdown] = useState(false);
  const [showReporterDropdown, setShowReporterDropdown] = useState(false);
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false);
  const [activePieChart, setActivePieChart] = useState("reporter"); // 'reporter', 'rca', 'owner'
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch NOC data - no date filter, show all NOC tickets
  useEffect(() => {
    const fetchNocData = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedRca !== "all") params.append("rca", selectedRca);
        if (selectedReporter !== "all") params.append("reporter", selectedReporter);

        const response = await fetch(`${API_URL}/api/tickets/noc?${params}`);
        const data = await response.json();
        setNocData(data);
      } catch (error) {
        console.error("Error fetching NOC data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNocData();
  }, [selectedRca, selectedReporter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedRca, selectedReporter, selectedOwner]);

  // Compute owner options from tickets
  const ownerOptions = useMemo(() => {
    const owners = new Set();
    (nocData.tickets || []).forEach(t => {
      if (t.owner) owners.add(t.owner);
    });
    return Array.from(owners).sort();
  }, [nocData.tickets]);

  // Filter tickets based on search term and owner (for pie chart click)
  const filteredTickets = useMemo(() => {
    let tickets = nocData.tickets || [];

    // Filter by owner (from pie chart click)
    if (selectedOwner !== "all") {
      tickets = tickets.filter(t => t.owner === selectedOwner);
    }

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      tickets = tickets.filter(
        (t) =>
          t.display_id?.toLowerCase().includes(term) ||
          t.owner?.toLowerCase().includes(term) ||
          t.noc_issue_id?.toLowerCase().includes(term) ||
          t.noc_assignee?.toLowerCase().includes(term) ||
          t.noc_rca?.toLowerCase().includes(term) ||
          t.noc_reported_by?.toLowerCase().includes(term) ||
          t.title?.toLowerCase().includes(term)
      );
    }

    return tickets;
  }, [nocData.tickets, searchTerm, selectedOwner]);

  // Pagination
  const totalPages = Math.ceil(filteredTickets.length / ITEMS_PER_PAGE);
  const paginatedTickets = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredTickets.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredTickets, currentPage]);

  // Download CSV
  const downloadCSV = () => {
    const headers = [
      "Ticket ID",
      "Title",
      "Owner",
      "Reported By",
      "ISS ID",
      "NOC Assignee",
      "RCA",
      "SUC Link",
      "Closed Date",
    ];
    const rows = filteredTickets.map((t) => [
      t.display_id || "",
      `"${(t.title || "").replace(/"/g, '""')}"`,
      t.owner || "",
      t.noc_reported_by || "",
      t.noc_issue_id || "",
      t.noc_assignee || "",
      t.noc_rca || "",
      t.noc_jira_key ? `https://wizrocket.atlassian.net/browse/${t.noc_jira_key}` : "",
      t.closed_date ? new Date(t.closed_date).toLocaleDateString() : "",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join(
      "\n"
    );
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `noc_tickets_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  // Get pie chart data based on active selection
  const getPieChartData = () => {
    switch (activePieChart) {
      case "reporter":
        return nocData.stats.byReporter || [];
      case "rca":
        return nocData.stats.byRca || [];
      case "owner":
        return nocData.stats.byOwner || [];
      default:
        return [];
    }
  };

  const pieChartData = getPieChartData();

  // Handle pie chart slice click
  const handlePieClick = (data) => {
    if (!data || !data.name) return;

    switch (activePieChart) {
      case "reporter":
        setSelectedReporter(data.name);
        break;
      case "rca":
        setSelectedRca(data.name);
        break;
      case "owner":
        setSelectedOwner(data.name);
        break;
    }
  };

  // Handle legend item click
  const handleLegendClick = (name) => {
    switch (activePieChart) {
      case "reporter":
        setSelectedReporter(name);
        break;
      case "rca":
        setSelectedRca(name);
        break;
      case "owner":
        setSelectedOwner(name);
        break;
    }
  };

  // Custom tooltip for pie chart
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="bg-slate-900 text-white px-3 py-2 rounded-lg shadow-xl text-xs">
          <p className="font-bold">{data.name}</p>
          <p>
            Count: <span className="text-indigo-400">{data.value}</span>
          </p>
          <p>
            Percentage:{" "}
            <span className="text-emerald-400">
              {((data.value / nocData.stats.total) * 100).toFixed(1)}%
            </span>
          </p>
          <p className="text-[10px] text-slate-400 mt-1">Click to filter</p>
        </div>
      );
    }
    return null;
  };

  // Check if any filter is active
  const hasActiveFilters = selectedRca !== "all" || selectedReporter !== "all" || selectedOwner !== "all" || searchTerm;

  if (parentLoading || isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 animate-pulse">
        <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-4"></div>
        <div className="h-64 bg-slate-100 dark:bg-slate-800 rounded"></div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-orange-50 to-transparent dark:from-orange-900/20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            NOC Tickets
            <span className="text-sm font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
              {nocData.stats.total} total
            </span>
            {filteredTickets.length !== nocData.stats.total && (
              <span className="text-sm font-normal text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-full">
                {filteredTickets.length} filtered
              </span>
            )}
          </h3>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={downloadCSV}
              disabled={filteredTickets.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search tickets, owners, RCA..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* RCA Filter */}
          <div className="relative">
            <button
              onClick={() => {
                setShowRcaDropdown(!showRcaDropdown);
                setShowReporterDropdown(false);
              }}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg border transition-all ${
                selectedRca !== "all"
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-500"
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              RCA: {selectedRca === "all" ? "All" : selectedRca.slice(0, 20) + (selectedRca.length > 20 ? "..." : "")}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showRcaDropdown && (
              <div className="absolute top-full left-0 mt-1 w-64 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50">
                <button
                  onClick={() => {
                    setSelectedRca("all");
                    setShowRcaDropdown(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                    selectedRca === "all" ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600" : ""
                  }`}
                >
                  All RCA
                </button>
                {nocData.filters.rcaOptions.map((rca) => (
                  <button
                    key={rca}
                    onClick={() => {
                      setSelectedRca(rca);
                      setShowRcaDropdown(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                      selectedRca === rca ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600" : ""
                    }`}
                  >
                    {rca}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reporter Filter */}
          <div className="relative">
            <button
              onClick={() => {
                setShowReporterDropdown(!showReporterDropdown);
                setShowRcaDropdown(false);
              }}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg border transition-all ${
                selectedReporter !== "all"
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-violet-500"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Reporter: {selectedReporter === "all" ? "All" : selectedReporter.split(" ")[0]}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showReporterDropdown && (
              <div className="absolute top-full left-0 mt-1 w-48 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50">
                <button
                  onClick={() => {
                    setSelectedReporter("all");
                    setShowReporterDropdown(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                    selectedReporter === "all" ? "bg-violet-50 dark:bg-violet-900/30 text-violet-600" : ""
                  }`}
                >
                  All Reporters
                </button>
                {nocData.filters.reporterOptions.map((reporter) => (
                  <button
                    key={reporter}
                    onClick={() => {
                      setSelectedReporter(reporter);
                      setShowReporterDropdown(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                      selectedReporter === reporter ? "bg-violet-50 dark:bg-violet-900/30 text-violet-600" : ""
                    }`}
                  >
                    {reporter}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Owner Filter (shown when filtered from pie chart) */}
          {selectedOwner !== "all" && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg">
              <UserCircle className="w-3.5 h-3.5" />
              Owner: {selectedOwner.split(" ")[0]}
              <button
                onClick={() => setSelectedOwner("all")}
                className="ml-1 hover:bg-emerald-700 rounded p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSelectedRca("all");
                setSelectedReporter("all");
                setSelectedOwner("all");
                setSearchTerm("");
              }}
              className="text-xs text-rose-500 hover:text-rose-600 font-medium"
            >
              Clear all filters
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {filteredTickets.length === 0 ? (
          <div className="text-center py-12">
            <AlertTriangle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 dark:text-slate-400">
              No NOC tickets found for the selected filters
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50">
                    <th className="text-left px-4 py-3 font-bold text-slate-600 dark:text-slate-300">
                      Ticket ID
                    </th>
                    <th className="text-left px-4 py-3 font-bold text-slate-600 dark:text-slate-300">
                      Owner
                    </th>
                    <th className="text-left px-4 py-3 font-bold text-slate-600 dark:text-slate-300">
                      Reported By
                    </th>
                    <th className="text-left px-4 py-3 font-bold text-slate-600 dark:text-slate-300">
                      ISS ID
                    </th>
                    <th className="text-left px-4 py-3 font-bold text-slate-600 dark:text-slate-300">
                      NOC Assignee
                    </th>
                    <th className="text-left px-4 py-3 font-bold text-slate-600 dark:text-slate-300">
                      RCA
                    </th>
                    <th className="text-left px-4 py-3 font-bold text-slate-600 dark:text-slate-300">
                      SUC Link
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {paginatedTickets.map((ticket) => (
                    <tr
                      key={ticket.display_id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <a
                          href={`https://app.devrev.ai/clevertapsupport/works/${ticket.display_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-800 font-mono font-bold text-xs flex items-center gap-1"
                        >
                          {ticket.display_id}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {ticket.owner || "-"}
                      </td>
                      <td className="px-4 py-3">
                        {ticket.noc_reported_by ? (
                          <button
                            onClick={() => setSelectedReporter(ticket.noc_reported_by)}
                            className="text-violet-600 hover:text-violet-800 hover:underline text-sm"
                          >
                            {ticket.noc_reported_by}
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {ticket.noc_issue_id ? (
                          <a
                            href={`https://app.devrev.ai/clevertapsupport/works/${ticket.noc_issue_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-600 hover:text-cyan-800 font-mono font-bold text-xs flex items-center gap-1"
                          >
                            {ticket.noc_issue_id}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {ticket.noc_assignee || "-"}
                      </td>
                      <td className="px-4 py-3">
                        {ticket.noc_rca ? (
                          <button
                            onClick={() => setSelectedRca(ticket.noc_rca)}
                            className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer hover:opacity-80 ${
                              ticket.noc_rca.toLowerCase().includes("understanding")
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : ticket.noc_rca.toLowerCase().includes("non")
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {ticket.noc_rca}
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {ticket.noc_jira_key ? (
                          <a
                            href={`https://wizrocket.atlassian.net/browse/${ticket.noc_jira_key}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-600 hover:text-emerald-800 font-mono text-xs flex items-center gap-1"
                          >
                            {ticket.noc_jira_key}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-2">
                <p className="text-xs text-slate-500">
                  Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
                  {Math.min(currentPage * ITEMS_PER_PAGE, filteredTickets.length)} of{" "}
                  {filteredTickets.length} tickets
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                            currentPage === pageNum
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Pie Charts Section */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <PieChartIcon className="w-4 h-4 text-indigo-500" />
                  Distribution Analysis
                  <span className="text-[10px] font-normal text-slate-400 ml-2">
                    (Click on chart or list to filter)
                  </span>
                </h4>
                <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                  {[
                    { id: "reporter", label: "By Reporter" },
                    { id: "rca", label: "By RCA" },
                    { id: "owner", label: "By Owner" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setActivePieChart(opt.id)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                        activePieChart === opt.id
                          ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Pie Chart */}
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 h-80">
                  {pieChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieChartData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ percent }) =>
                            percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ""
                          }
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                          onClick={handlePieClick}
                          style={{ cursor: "pointer" }}
                        >
                          {pieChartData.map((_, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400">
                      No data available
                    </div>
                  )}
                </div>

                {/* Legend / Stats List */}
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 h-80 overflow-y-auto">
                  <h5 className="text-xs font-bold text-slate-500 uppercase mb-3">
                    {activePieChart === "reporter"
                      ? "Top Reporters"
                      : activePieChart === "rca"
                        ? "RCA Categories"
                        : "Top Owners"}
                  </h5>
                  <div className="space-y-2">
                    {pieChartData.slice(0, 15).map((item, index) => (
                      <button
                        key={item.name}
                        onClick={() => handleLegendClick(item.name)}
                        className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{
                              backgroundColor:
                                CHART_COLORS[index % CHART_COLORS.length],
                            }}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-[180px] text-left">
                            {item.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-800 dark:text-white">
                            {item.value}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            ({((item.value / nocData.stats.total) * 100).toFixed(1)}%)
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NOCAnalytics;
