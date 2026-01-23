// ============================================================================
// NOC ANALYTICS COMPONENT
// Shows tickets reported to NOC with filtering and pie charts
// ============================================================================
import { useState, useEffect, useMemo } from "react";
import {
  Search,
  Download,
  Filter,
  ExternalLink,
  AlertTriangle,
  Users,
  PieChart as PieChartIcon,
  ChevronDown,
  X,
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
  const [showRcaDropdown, setShowRcaDropdown] = useState(false);
  const [showReporterDropdown, setShowReporterDropdown] = useState(false);
  const [activePieChart, setActivePieChart] = useState("reporter"); // 'reporter', 'rca', 'owner'

  // Fetch NOC data - no date filter, show all NOC tickets
  useEffect(() => {
    const fetchNocData = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedRca !== "all") params.append("rca", selectedRca);
        if (selectedReporter !== "all") params.append("reporter", selectedReporter);

        const response = await fetch(`/api/tickets/noc?${params}`);
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

  // Filter tickets based on search term
  const filteredTickets = useMemo(() => {
    if (!searchTerm) return nocData.tickets;
    const term = searchTerm.toLowerCase();
    return nocData.tickets.filter(
      (t) =>
        t.display_id?.toLowerCase().includes(term) ||
        t.owner?.toLowerCase().includes(term) ||
        t.noc_issue_id?.toLowerCase().includes(term) ||
        t.noc_assignee?.toLowerCase().includes(term) ||
        t.noc_rca?.toLowerCase().includes(term) ||
        t.title?.toLowerCase().includes(term)
    );
  }, [nocData.tickets, searchTerm]);

  // Download CSV
  const downloadCSV = () => {
    const headers = [
      "Ticket ID",
      "Title",
      "Owner",
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
      t.noc_issue_id || "",
      t.noc_assignee || "",
      t.noc_rca || "",
      t.noc_jira_key ? `https://jira.clevertap.com/browse/${t.noc_jira_key}` : "",
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
        </div>
      );
    }
    return null;
  };

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

          {/* Clear Filters */}
          {(selectedRca !== "all" || selectedReporter !== "all" || searchTerm) && (
            <button
              onClick={() => {
                setSelectedRca("all");
                setSelectedReporter("all");
                setSearchTerm("");
              }}
              className="text-xs text-rose-500 hover:text-rose-600 font-medium"
            >
              Clear filters
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
                  {filteredTickets.slice(0, 50).map((ticket) => (
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
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {ticket.noc_issue_id || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {ticket.noc_assignee || "-"}
                      </td>
                      <td className="px-4 py-3">
                        {ticket.noc_rca ? (
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              ticket.noc_rca.toLowerCase().includes("understanding")
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : ticket.noc_rca.toLowerCase().includes("non")
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {ticket.noc_rca}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {ticket.noc_jira_key ? (
                          <a
                            href={`https://jira.clevertap.com/browse/${ticket.noc_jira_key}`}
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
              {filteredTickets.length > 50 && (
                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 text-center text-xs text-slate-500">
                  Showing 50 of {filteredTickets.length} tickets. Export CSV for full list.
                </div>
              )}
            </div>

            {/* Pie Charts Section */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <PieChartIcon className="w-4 h-4 text-indigo-500" />
                  Distribution Analysis
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
                          label={({ name, percent }) =>
                            percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ""
                          }
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {pieChartData.map((entry, index) => (
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
                      <div
                        key={item.name}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{
                              backgroundColor:
                                CHART_COLORS[index % CHART_COLORS.length],
                            }}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-[180px]">
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
                      </div>
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
