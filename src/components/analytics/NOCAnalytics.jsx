// ============================================================================
// NOC ANALYTICS COMPONENT
// Shows tickets reported to NOC with filtering and pie charts
// ============================================================================
import { useState, useEffect, useMemo, useRef, useCallback } from "react";

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
  CheckCircle,
  XCircle,
  Check,
  ShieldCheck,
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

// ============================================================================
// Multi-Select Dropdown with Checkboxes and Search
// ============================================================================
const MultiSelectDropdown = ({
  label,
  icon: Icon,
  options,
  selected, // array of selected values, empty = all
  onSelectionChange,
  colorClass, // e.g., "indigo", "violet", "emerald", "cyan"
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  const colorMap = {
    indigo: {
      active: "bg-indigo-600 text-white border-indigo-600",
      hover: "hover:border-indigo-500",
      highlight: "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600",
      check: "text-indigo-600",
    },
    violet: {
      active: "bg-violet-600 text-white border-violet-600",
      hover: "hover:border-violet-500",
      highlight: "bg-violet-50 dark:bg-violet-900/30 text-violet-600",
      check: "text-violet-600",
    },
    emerald: {
      active: "bg-emerald-600 text-white border-emerald-600",
      hover: "hover:border-emerald-500",
      highlight: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600",
      check: "text-emerald-600",
    },
    cyan: {
      active: "bg-cyan-600 text-white border-cyan-600",
      hover: "hover:border-cyan-500",
      highlight: "bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600",
      check: "text-cyan-600",
    },
    amber: {
      active: "bg-amber-600 text-white border-amber-600",
      hover: "hover:border-amber-500",
      highlight: "bg-amber-50 dark:bg-amber-900/30 text-amber-600",
      check: "text-amber-600",
    },
  };

  const colors = colorMap[colorClass] || colorMap.indigo;
  const isActive = selected.length > 0;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearchTerm("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-focus search when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const term = searchTerm.toLowerCase();
    return options.filter((opt) => opt.toLowerCase().includes(term));
  }, [options, searchTerm]);

  const toggleOption = (value) => {
    if (selected.includes(value)) {
      onSelectionChange(selected.filter((v) => v !== value));
    } else {
      onSelectionChange([...selected, value]);
    }
  };

  const selectAll = () => {
    onSelectionChange([]);
    setIsOpen(false);
    setSearchTerm("");
  };

  const getButtonLabel = () => {
    if (selected.length === 0) return "All";
    if (selected.length === 1) {
      const name = selected[0];
      return name.length > 15 ? name.slice(0, 15) + "..." : name;
    }
    return `${selected.length} selected`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg border transition-all ${
          isActive
            ? colors.active
            : `bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 ${colors.hover}`
        }`}
      >
        <Icon className="w-3.5 h-3.5" />
        {label}: {getButtonLabel()}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50">
          {/* Search input */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-700">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="max-h-52 overflow-y-auto">
            {/* All option */}
            <button
              onClick={selectAll}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                selected.length === 0 ? colors.highlight : ""
              }`}
            >
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center ${
                  selected.length === 0
                    ? `border-current ${colors.check} bg-current`
                    : "border-slate-300 dark:border-slate-600"
                }`}
              >
                {selected.length === 0 && <Check className="w-3 h-3 text-white" />}
              </div>
              <span>All {label}</span>
            </button>

            {/* Options */}
            {filteredOptions.map((option) => {
              const isChecked = selected.includes(option);
              return (
                <button
                  key={option}
                  onClick={() => toggleOption(option)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                    isChecked ? colors.highlight : ""
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      isChecked
                        ? `border-current ${colors.check} bg-current`
                        : "border-slate-300 dark:border-slate-600"
                    }`}
                  >
                    {isChecked && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="truncate text-left">{option}</span>
                </button>
              );
            })}

            {filteredOptions.length === 0 && (
              <div className="px-4 py-3 text-xs text-slate-400 text-center">No results found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main NOCAnalytics Component
// ============================================================================
const NOCAnalytics = ({ isLoading: parentLoading }) => {
  const [nocData, setNocData] = useState({
    tickets: [],
    filters: { rcaOptions: [], reporterOptions: [], ownerOptions: [], confirmationByOptions: [] },
    stats: { total: 0, byReporter: [], byRca: [], byOwner: [], byConfirmation: [] },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Multi-select: empty array means "All"
  const [selectedRca, setSelectedRca] = useState([]);
  const [selectedReporter, setSelectedReporter] = useState([]);
  const [selectedOwner, setSelectedOwner] = useState([]);
  const [selectedConfirmationBy, setSelectedConfirmationBy] = useState([]);
  const [showL2Only, setShowL2Only] = useState(false);

  const [activePieChart, setActivePieChart] = useState("reporter");
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch NOC data
  useEffect(() => {
    const fetchNocData = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedRca.length > 0) params.append("rca", selectedRca.join(","));
        if (selectedReporter.length > 0) params.append("reporter", selectedReporter.join(","));
        if (selectedOwner.length > 0) params.append("owner", selectedOwner.join(","));
        if (selectedConfirmationBy.length > 0) params.append("confirmationBy", selectedConfirmationBy.join(","));
        if (showL2Only) params.append("showL2Only", "true");

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
  }, [selectedRca, selectedReporter, selectedOwner, selectedConfirmationBy, showL2Only]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedRca, selectedReporter, selectedOwner, selectedConfirmationBy, showL2Only]);

  // Filter tickets based on search term (server already handles other filters)
  const filteredTickets = useMemo(() => {
    let tickets = nocData.tickets || [];

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
          t.noc_confirmation_by?.toLowerCase().includes(term) ||
          t.title?.toLowerCase().includes(term)
      );
    }

    return tickets;
  }, [nocData.tickets, searchTerm]);

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
      "NOC Confirmation",
      "Confirmed By",
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
      t.has_l2_noc_confirmation
        ? t.is_noc ? "Confirmed" : "Rejected"
        : t.is_noc ? "N/A" : "-",
      t.noc_confirmation_by || "",
      t.closed_date ? new Date(t.closed_date).toLocaleDateString() : "",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
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
      case "confirmation":
        return nocData.stats.byConfirmation || [];
      default:
        return [];
    }
  };

  const pieChartData = getPieChartData();

  // Handle pie chart slice click - adds to multi-select
  const handlePieClick = (data) => {
    if (!data || !data.name) return;
    switch (activePieChart) {
      case "reporter":
        if (!selectedReporter.includes(data.name)) setSelectedReporter([...selectedReporter, data.name]);
        break;
      case "rca":
        if (!selectedRca.includes(data.name)) setSelectedRca([...selectedRca, data.name]);
        break;
      case "owner":
        if (!selectedOwner.includes(data.name)) setSelectedOwner([...selectedOwner, data.name]);
        break;
      case "confirmation":
        if (!selectedConfirmationBy.includes(data.name)) setSelectedConfirmationBy([...selectedConfirmationBy, data.name]);
        break;
    }
  };

  // Handle legend item click
  const handleLegendClick = (name) => {
    switch (activePieChart) {
      case "reporter":
        if (!selectedReporter.includes(name)) setSelectedReporter([...selectedReporter, name]);
        break;
      case "rca":
        if (!selectedRca.includes(name)) setSelectedRca([...selectedRca, name]);
        break;
      case "owner":
        if (!selectedOwner.includes(name)) setSelectedOwner([...selectedOwner, name]);
        break;
      case "confirmation":
        if (!selectedConfirmationBy.includes(name)) setSelectedConfirmationBy([...selectedConfirmationBy, name]);
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
  const hasActiveFilters =
    selectedRca.length > 0 ||
    selectedReporter.length > 0 ||
    selectedOwner.length > 0 ||
    selectedConfirmationBy.length > 0 ||
    showL2Only ||
    searchTerm;

  const clearAllFilters = useCallback(() => {
    setSelectedRca([]);
    setSelectedReporter([]);
    setSelectedOwner([]);
    setSelectedConfirmationBy([]);
    setShowL2Only(false);
    setSearchTerm("");
  }, []);

  // Get NOC confirmation status for display
  const getConfirmationStatus = (ticket) => {
    if (ticket.has_l2_noc_confirmation) {
      if (ticket.is_noc) {
        return { label: "Confirmed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" };
      }
      return { label: "Rejected", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" };
    }
    if (ticket.is_noc) {
      return { label: "N/A", color: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" };
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
          <MultiSelectDropdown
            label="RCA"
            icon={Filter}
            options={nocData.filters.rcaOptions || []}
            selected={selectedRca}
            onSelectionChange={setSelectedRca}
            colorClass="indigo"
          />

          {/* Reporter Filter */}
          <MultiSelectDropdown
            label="Reporter"
            icon={Users}
            options={nocData.filters.reporterOptions || []}
            selected={selectedReporter}
            onSelectionChange={setSelectedReporter}
            colorClass="violet"
          />

          {/* Owner Filter */}
          <MultiSelectDropdown
            label="Owner"
            icon={UserCircle}
            options={nocData.filters.ownerOptions || []}
            selected={selectedOwner}
            onSelectionChange={setSelectedOwner}
            colorClass="emerald"
          />

          {/* NOC Confirmation By Filter */}
          <MultiSelectDropdown
            label="NOC Confirmation"
            icon={ShieldCheck}
            options={nocData.filters.confirmationByOptions || []}
            selected={selectedConfirmationBy}
            onSelectionChange={setSelectedConfirmationBy}
            colorClass="cyan"
          />

          {/* L2 Only Toggle */}
          <button
            onClick={() => setShowL2Only(!showL2Only)}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg border transition-all ${
              showL2Only
                ? "bg-amber-600 text-white border-amber-600"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-500"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            L2 NOC Only
          </button>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
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
                    <th className="text-left px-4 py-3 font-bold text-slate-600 dark:text-slate-300">
                      NOC Confirmation
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {paginatedTickets.map((ticket) => {
                    const confirmStatus = getConfirmationStatus(ticket);
                    return (
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
                              onClick={() => {
                                if (!selectedReporter.includes(ticket.noc_reported_by))
                                  setSelectedReporter([...selectedReporter, ticket.noc_reported_by]);
                              }}
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
                              onClick={() => {
                                if (!selectedRca.includes(ticket.noc_rca))
                                  setSelectedRca([...selectedRca, ticket.noc_rca]);
                              }}
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
                        <td className="px-4 py-3">
                          {confirmStatus ? (
                            <div className="flex flex-col gap-1">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold w-fit ${confirmStatus.color}`}
                              >
                                {confirmStatus.label === "Confirmed" ? (
                                  <CheckCircle className="w-3 h-3" />
                                ) : confirmStatus.label === "Rejected" ? (
                                  <XCircle className="w-3 h-3" />
                                ) : null}
                                {confirmStatus.label}
                              </span>
                              {ticket.noc_confirmation_by && (
                                <button
                                  onClick={() => {
                                    if (!selectedConfirmationBy.includes(ticket.noc_confirmation_by))
                                      setSelectedConfirmationBy([...selectedConfirmationBy, ticket.noc_confirmation_by]);
                                  }}
                                  className="text-cyan-600 hover:text-cyan-800 hover:underline text-xs"
                                >
                                  {ticket.noc_confirmation_by}
                                </button>
                              )}
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
                    { id: "confirmation", label: "By Confirmation" },
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
                        : activePieChart === "owner"
                          ? "Top Owners"
                          : "NOC Confirmation By"}
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
