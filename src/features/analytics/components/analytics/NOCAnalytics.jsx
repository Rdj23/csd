// ============================================================================
// NOC ANALYTICS COMPONENT
// Table first, then L2 confirmation insights below
// ============================================================================
import { useState, useEffect, useMemo, useRef, useCallback } from "react";

import { authFetch } from "../../../../utils/authFetch";

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
  BarChart3,
  Target,
  ArrowRight,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const CHART_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#06b6d4",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
];

const ITEMS_PER_PAGE = 15;

// ============================================================================
// Multi-Select Dropdown
// ============================================================================
const MultiSelectDropdown = ({
  label,
  icon: Icon,
  options,
  selected,
  onSelectionChange,
  colorClass,
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

  useEffect(() => {
    if (isOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const term = searchTerm.toLowerCase();
    return options.filter((opt) => opt.toLowerCase().includes(term));
  }, [options, searchTerm]);

  const toggleOption = (value) => {
    if (selected.includes(value))
      onSelectionChange(selected.filter((v) => v !== value));
    else onSelectionChange([...selected, value]);
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
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50">
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
                {selected.length === 0 && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </div>
              <span>All {label}</span>
            </button>
            {filteredOptions.map((option) => {
              const isChecked = selected.includes(option);
              return (
                <button
                  key={option}
                  onClick={() => toggleOption(option)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${isChecked ? colors.highlight : ""}`}
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
              <div className="px-4 py-3 text-xs text-slate-400 text-center">
                No results found
              </div>
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
    filters: {
      rcaOptions: [],
      reporterOptions: [],
      ownerOptions: [],
      confirmationByOptions: [],
    },
    stats: {
      total: 0,
      byReporter: [],
      byRca: [],
      byOwner: [],
      byConfirmation: [],
    },
  });
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRca, setSelectedRca] = useState([]);
  const [selectedReporter, setSelectedReporter] = useState([]);
  const [selectedOwner, setSelectedOwner] = useState([]);
  const [selectedConfirmationBy, setSelectedConfirmationBy] = useState([]);
  const [showL2Only, setShowL2Only] = useState(false);
  const [activePieChart, setActivePieChart] = useState("reporter");
  const [currentPage, setCurrentPage] = useState(1);
  const [activeView, setActiveView] = useState("table");

  // Fetch NOC data - only show skeleton on initial load, subtle indicator on filter changes
  useEffect(() => {
    const fetchNocData = async () => {
      if (isInitialLoad) setIsRefreshing(false);
      else setIsRefreshing(true);

      try {
        const params = new URLSearchParams();
        if (selectedRca.length > 0) params.append("rca", selectedRca.join(","));
        if (selectedReporter.length > 0)
          params.append("reporter", selectedReporter.join(","));
        if (selectedOwner.length > 0)
          params.append("owner", selectedOwner.join(","));
        if (selectedConfirmationBy.length > 0)
          params.append("confirmationBy", selectedConfirmationBy.join(","));
        if (showL2Only) params.append("showL2Only", "true");
        const response = await authFetch(`${API_URL}/api/tickets/noc?${params}`);
        const data = await response.json();
        if (data.stats && data.filters) {
          setNocData(data);
        }
      } catch (error) {
        console.error("Error fetching NOC data:", error);
      } finally {
        setIsInitialLoad(false);
        setIsRefreshing(false);
      }
    };
    fetchNocData();
  }, [
    selectedRca,
    selectedReporter,
    selectedOwner,
    selectedConfirmationBy,
    showL2Only,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    selectedRca,
    selectedReporter,
    selectedOwner,
    selectedConfirmationBy,
    showL2Only,
  ]);

  // ========== COMPUTED INSIGHTS (L2 confirmation raised tickets only) ==========
  const insights = useMemo(() => {
    const tickets = nocData.tickets || [];
    let confirmed = 0;
    let rejected = 0;
    let understandingGapCS = 0;
    let l2PersonMap = {};

    tickets.forEach((t) => {
      if (t.has_l2_noc_confirmation) {
        if (t.is_noc) confirmed++;
        else rejected++;
      }

      // Track Understanding Gap - CS only
      if (
        t.noc_rca &&
        t.noc_rca.toLowerCase().includes("understanding gap") &&
        t.noc_rca.toLowerCase().includes("cs")
      ) {
        understandingGapCS++;
      }

      // Per-person L2 scorecard
      if (t.noc_confirmation_by && t.has_l2_noc_confirmation) {
        if (!l2PersonMap[t.noc_confirmation_by]) {
          l2PersonMap[t.noc_confirmation_by] = { confirmed: 0, rejected: 0, ug: 0 };
        }
        if (t.is_noc) {
          l2PersonMap[t.noc_confirmation_by].confirmed++;
        } else {
          l2PersonMap[t.noc_confirmation_by].rejected++;
          // Count Understanding Gap per reviewer
          if (
            t.noc_rca &&
            t.noc_rca.toLowerCase().includes("understanding gap")
          ) {
            l2PersonMap[t.noc_confirmation_by].ug++;
          }
        }
      }
    });

    const l2Total = confirmed + rejected;
    // Rejection rate: how much got rejected out of total L2 raised
    const rejectionRate =
      l2Total > 0 ? ((rejected / l2Total) * 100).toFixed(1) : 0;

    // Sort L2 persons by total activity, rate = rejection rate
    const l2Scorecard = Object.entries(l2PersonMap)
      .map(([name, stats]) => {
        const total = stats.confirmed + stats.rejected;
        return {
          name,
          confirmed: stats.confirmed,
          rejected: stats.rejected,
          total,
          ug: stats.ug,
          rejectionRate:
            total > 0 ? ((stats.rejected / total) * 100).toFixed(0) : 0,
        };
      })
      .sort((a, b) => Number(b.rejectionRate) - Number(a.rejectionRate));

    return {
      confirmed,
      rejected,
      l2Total,
      rejectionRate,
      understandingGapCS,
      l2Scorecard,
    };
  }, [nocData.tickets]);

  // Filter tickets based on search
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
          t.title?.toLowerCase().includes(term),
      );
    }
    return tickets;
  }, [nocData.tickets, searchTerm]);

  const totalPages = Math.ceil(filteredTickets.length / ITEMS_PER_PAGE);
  const paginatedTickets = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredTickets.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredTickets, currentPage]);

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
      t.noc_jira_key
        ? `https://wizrocket.atlassian.net/browse/${t.noc_jira_key}`
        : "",
      t.has_l2_noc_confirmation ? (t.is_noc ? "Confirmed" : "Rejected") : "-",
      t.noc_confirmation_by || "",
      t.closed_date ? new Date(t.closed_date).toLocaleDateString() : "",
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `noc_tickets_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  // Pie chart
  const getPieChartData = () => {
    const stats = nocData?.stats;
    if (!stats) return [];
    switch (activePieChart) {
      case "reporter":
        return stats.byReporter || [];
      case "rca":
        return stats.byRca || [];
      case "owner":
        return stats.byOwner || [];
      case "confirmation":
        return stats.byConfirmation || [];
      default:
        return [];
    }
  };
  const pieChartData = getPieChartData();

  const handlePieClick = (data) => {
    if (!data || !data.name) return;
    switch (activePieChart) {
      case "reporter":
        if (!selectedReporter.includes(data.name))
          setSelectedReporter([...selectedReporter, data.name]);
        break;
      case "rca":
        if (!selectedRca.includes(data.name))
          setSelectedRca([...selectedRca, data.name]);
        break;
      case "owner":
        if (!selectedOwner.includes(data.name))
          setSelectedOwner([...selectedOwner, data.name]);
        break;
      case "confirmation":
        if (!selectedConfirmationBy.includes(data.name))
          setSelectedConfirmationBy([...selectedConfirmationBy, data.name]);
        break;
    }
  };

  const handleLegendClick = (name) => {
    switch (activePieChart) {
      case "reporter":
        if (!selectedReporter.includes(name))
          setSelectedReporter([...selectedReporter, name]);
        break;
      case "rca":
        if (!selectedRca.includes(name)) setSelectedRca([...selectedRca, name]);
        break;
      case "owner":
        if (!selectedOwner.includes(name))
          setSelectedOwner([...selectedOwner, name]);
        break;
      case "confirmation":
        if (!selectedConfirmationBy.includes(name))
          setSelectedConfirmationBy([...selectedConfirmationBy, name]);
        break;
    }
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="bg-slate-900 text-white px-3 py-2 rounded-lg shadow-xl text-xs border border-slate-700">
          <p className="font-bold">{data.name}</p>
          <p>
            Count: <span className="text-indigo-400">{data.value}</span>
          </p>
          <p>
            Share:{" "}
            <span className="text-emerald-400">
              {((data.value / (nocData?.stats?.total || 0)) * 100).toFixed(1)}%
            </span>
          </p>
          <p className="text-[10px] text-slate-400 mt-1">Click to filter</p>
        </div>
      );
    }
    return null;
  };

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

  // Only show Confirmed / Rejected (no Pending)
  const getConfirmationStatus = (ticket) => {
    if (ticket.has_l2_noc_confirmation) {
      if (ticket.is_noc) {
        return {
          label: "Confirmed",
          color:
            "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/20",
        };
      }
      return {
        label: "Rejected",
        color:
          "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 ring-1 ring-rose-200 dark:ring-rose-500/20",
      };
    }
    return null;
  };

  // Initial skeleton only
  if (parentLoading || isInitialLoad) {
    return (
      <div className="space-y-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 animate-pulse">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-4"></div>
          <div className="h-64 bg-slate-100 dark:bg-slate-800 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ================================================================ */}
      {/* NOC TICKETS - TABLE / DISTRIBUTION (FIRST) */}
      {/* ================================================================ */}
      <div
        className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden transition-opacity duration-200 ${isRefreshing ? "opacity-60" : "opacity-100"}`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            NOC Tickets
            <span className="text-xs font-normal text-slate-500 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
              {(nocData?.stats?.total || 0)} total
            </span>
            {filteredTickets.length !== (nocData?.stats?.total || 0) && (
              <span className="text-xs font-normal text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2.5 py-1 rounded-full">
                {filteredTickets.length} filtered
              </span>
            )}
            {isRefreshing && (
              <span className="text-[10px] text-slate-400 animate-pulse">
                updating...
              </span>
            )}
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              <button
                onClick={() => setActiveView("table")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  activeView === "table"
                    ? "bg-white dark:bg-indigo-600 text-indigo-600 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 inline mr-1.5" />
                Table
              </button>
              <button
                onClick={() => setActiveView("insights")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  activeView === "insights"
                    ? "bg-white dark:bg-indigo-600 text-indigo-600 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                <PieChartIcon className="w-3.5 h-3.5 inline mr-1.5" />
                Distribution
              </button>
            </div>
            <button
              onClick={downloadCSV}
              disabled={filteredTickets.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search tickets, owners, RCA..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <MultiSelectDropdown
              label="RCA"
              icon={Filter}
              options={nocData.filters.rcaOptions || []}
              selected={selectedRca}
              onSelectionChange={setSelectedRca}
              colorClass="indigo"
            />
            <MultiSelectDropdown
              label="Reporter"
              icon={Users}
              options={nocData.filters.reporterOptions || []}
              selected={selectedReporter}
              onSelectionChange={setSelectedReporter}
              colorClass="violet"
            />
            <MultiSelectDropdown
              label="Owner"
              icon={UserCircle}
              options={nocData.filters.ownerOptions || []}
              selected={selectedOwner}
              onSelectionChange={setSelectedOwner}
              colorClass="emerald"
            />
            <MultiSelectDropdown
              label="Confirmation"
              icon={ShieldCheck}
              options={nocData.filters.confirmationByOptions || []}
              selected={selectedConfirmationBy}
              onSelectionChange={setSelectedConfirmationBy}
              colorClass="cyan"
            />
            <button
              onClick={() => setShowL2Only(!showL2Only)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg border transition-all ${
                showL2Only
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-500"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              L2 Only
            </button>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="text-xs text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 font-medium"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {filteredTickets.length === 0 ? (
            <div className="text-center py-16">
              <AlertTriangle className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500">
                No NOC tickets found for the selected filters
              </p>
            </div>
          ) : activeView === "table" ? (
            /* ============ TABLE VIEW ============ */
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50">
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                        Ticket
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                        Owner
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                        Reporter
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                        ISS Link
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                        RCA
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                        Confirmation
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                        SUC Link
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {paginatedTickets.map((ticket) => {
                      const confirmStatus = getConfirmationStatus(ticket);
                      return (
                        <tr
                          key={ticket.display_id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <a
                              href={`https://app.devrev.ai/clevertapsupport/works/${ticket.display_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-mono font-bold text-xs flex items-center gap-1"
                            >
                              {ticket.display_id}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300 text-xs">
                            {ticket.owner || "-"}
                          </td>
                          <td className="px-4 py-3">
                            {ticket.noc_reported_by ? (
                              <button
                                onClick={() => {
                                  if (
                                    !selectedReporter.includes(
                                      ticket.noc_reported_by,
                                    )
                                  )
                                    setSelectedReporter([
                                      ...selectedReporter,
                                      ticket.noc_reported_by,
                                    ]);
                                }}
                                className="text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 text-xs hover:underline"
                              >
                                {ticket.noc_reported_by}
                              </button>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {(() => {
                              const issId = ticket.is_noc ? ticket.noc_issue_id : ticket.noc_confirmation_iss_id;
                              return issId ? (
                                <a
                                  href={`https://app.devrev.ai/clevertapsupport/works/${issId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-mono font-bold text-xs flex items-center gap-1"
                                >
                                  {issId}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-600">-</span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            {ticket.noc_rca ? (
                              <button
                                onClick={() => {
                                  if (!selectedRca.includes(ticket.noc_rca))
                                    setSelectedRca([
                                      ...selectedRca,
                                      ticket.noc_rca,
                                    ]);
                                }}
                                className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer hover:opacity-80 ring-1 ${
                                  ticket.noc_rca
                                    .toLowerCase()
                                    .includes("understanding")
                                    ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20"
                                    : ticket.noc_rca
                                          .toLowerCase()
                                          .includes("non")
                                      ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20"
                                      : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/20"
                                }`}
                              >
                                {ticket.noc_rca}
                              </button>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {ticket.noc_confirmation_by ? (
                              <button
                                onClick={() => {
                                  if (
                                    !selectedConfirmationBy.includes(
                                      ticket.noc_confirmation_by,
                                    )
                                  )
                                    setSelectedConfirmationBy([
                                      ...selectedConfirmationBy,
                                      ticket.noc_confirmation_by,
                                    ]);
                                }}
                                className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-800 dark:hover:text-cyan-300 text-xs hover:underline"
                              >
                                {ticket.noc_confirmation_by}
                              </button>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600">
                                -
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {confirmStatus ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold ${confirmStatus.color}`}
                              >
                                {confirmStatus.label === "Confirmed" ? (
                                  <CheckCircle className="w-3 h-3" />
                                ) : (
                                  <XCircle className="w-3 h-3" />
                                )}
                                {confirmStatus.label}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600">
                                -
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {ticket.noc_jira_key ? (
                              <a
                                href={`https://wizrocket.atlassian.net/browse/${ticket.noc_jira_key}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-800 dark:hover:text-cyan-300 font-mono text-xs flex items-center gap-1"
                              >
                                {ticket.noc_jira_key}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600">
                                -
                              </span>
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
                    {Math.min(
                      currentPage * ITEMS_PER_PAGE,
                      filteredTickets.length,
                    )}{" "}
                    of {filteredTickets.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from(
                        { length: Math.min(5, totalPages) },
                        (_, i) => {
                          let pageNum;
                          if (totalPages <= 5) pageNum = i + 1;
                          else if (currentPage <= 3) pageNum = i + 1;
                          else if (currentPage >= totalPages - 2)
                            pageNum = totalPages - 4 + i;
                          else pageNum = currentPage - 2 + i;
                          return (
                            <button
                              key={pageNum}
                              onClick={() => setCurrentPage(pageNum)}
                              className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                                currentPage === pageNum
                                  ? "bg-indigo-600 text-white"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                              }`}
                            >
                              {pageNum}
                            </button>
                          );
                        },
                      )}
                    </div>
                    <button
                      onClick={() =>
                        setCurrentPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={currentPage === totalPages}
                      className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ============ DISTRIBUTION VIEW ============ */
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <PieChartIcon className="w-4 h-4 text-indigo-500" />
                  Distribution Analysis
                  <span className="text-[10px] font-normal text-slate-400 ml-2">
                    (Click to filter)
                  </span>
                </h4>
                <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                  {[
                    { id: "reporter", label: "Reporter" },
                    { id: "rca", label: "RCA" },
                    { id: "owner", label: "Owner" },
                    { id: "confirmation", label: "Reviewer" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setActivePieChart(opt.id)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                        activePieChart === opt.id
                          ? "bg-white dark:bg-indigo-600 text-indigo-600 dark:text-white shadow-sm"
                          : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 h-80 border border-slate-200 dark:border-slate-800">
                  {pieChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={100}
                          paddingAngle={2}
                          labelLine={false}
                          label={({ percent }) =>
                            percent > 0.05
                              ? `${(percent * 100).toFixed(0)}%`
                              : ""
                          }
                          dataKey="value"
                          onClick={handlePieClick}
                          style={{ cursor: "pointer" }}
                          strokeWidth={0}
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
                    <div className="h-full flex items-center justify-center text-slate-500">
                      No data
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 h-80 overflow-y-auto border border-slate-200 dark:border-slate-800">
                  <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                    {activePieChart === "reporter"
                      ? "Top Reporters"
                      : activePieChart === "rca"
                        ? "RCA Categories"
                        : activePieChart === "owner"
                          ? "Top Owners"
                          : "Top Reviewers"}
                  </h5>
                  <div className="space-y-1">
                    {pieChartData.slice(0, 15).map((item, index) => (
                      <button
                        key={item.name}
                        onClick={() => handleLegendClick(item.name)}
                        className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-white dark:hover:bg-slate-700/50 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                CHART_COLORS[index % CHART_COLORS.length],
                            }}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white truncate max-w-[180px] text-left transition-colors">
                            {item.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-800 dark:text-white">
                            {item.value}
                          </span>
                          <span className="text-[10px] text-slate-400 w-12 text-right">
                            {((item.value / (nocData?.stats?.total || 0)) * 100).toFixed(
                              1,
                            )}
                            %
                          </span>
                          <ArrowRight className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* L2 NOC CONFIRMATION STATS (BELOW TABLE) */}
      {/* ================================================================ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* L2 Raised */}
        <div className="relative overflow-hidden bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500/5 dark:bg-indigo-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                NOC Raised
              </span>
            </div>
            <div className="text-3xl font-extrabold text-slate-800 dark:text-white mt-2">
              {insights.l2Total}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              NOC confirmations raised
            </div>
          </div>
        </div>

        {/* Confirmed */}
        <div className="relative overflow-hidden bg-white dark:bg-slate-900 rounded-2xl p-5 border border-emerald-100 dark:border-slate-800 shadow-sm">
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400/70 uppercase tracking-wider">
                Confirmed
              </span>
            </div>
            <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-2">
              {insights.confirmed}
            </div>
            <div className="mt-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5">
              <div
                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-700"
                style={{
                  width: `${insights.l2Total > 0 ? (insights.confirmed / insights.l2Total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {insights.l2Total > 0
                ? ((insights.confirmed / insights.l2Total) * 100).toFixed(1)
                : 0}
              % of NOC raised
            </div>
          </div>
        </div>

        {/* Rejected */}
        <div className="relative overflow-hidden bg-white dark:bg-slate-900 rounded-2xl p-5 border border-rose-100 dark:border-slate-800 shadow-sm">
          <div className="absolute top-0 right-0 w-20 h-20 bg-rose-500/5 dark:bg-rose-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-rose-500 dark:text-rose-400" />
              <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400/70 uppercase tracking-wider">
                Rejected
              </span>
            </div>
            <div className="text-3xl font-extrabold text-rose-600 dark:text-rose-400 mt-2">
              {insights.rejected}
            </div>
            <div className="mt-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5">
              <div
                className="bg-rose-500 h-1.5 rounded-full transition-all duration-700"
                style={{
                  width: `${insights.l2Total > 0 ? (insights.rejected / insights.l2Total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {insights.l2Total > 0
                ? ((insights.rejected / insights.l2Total) * 100).toFixed(1)
                : 0}
              % of NOC raised
            </div>
          </div>
        </div>

        {/* Rejection Rate */}
        <div className="relative overflow-hidden bg-white dark:bg-slate-900 rounded-2xl p-5 border border-amber-100 dark:border-slate-800 shadow-sm">
          <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/5 dark:bg-amber-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400/70 uppercase tracking-wider">
                Rejection Rate
              </span>
            </div>
            <div className="text-3xl font-extrabold text-amber-600 dark:text-amber-400 mt-2">
              {insights.rejectionRate}
              <span className="text-lg">%</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              of L2 confirmations rejected
            </div>
          </div>
        </div>

        {/* Understanding Gap - CS */}
        <div className="relative overflow-hidden bg-white dark:bg-slate-900 rounded-2xl p-5 border border-violet-100 dark:border-slate-800 shadow-sm">
          <div className="absolute top-0 right-0 w-20 h-20 bg-violet-500/5 dark:bg-violet-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-violet-500 dark:text-violet-400" />
              <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400/70 uppercase tracking-wider">
                Gap - CS
              </span>
            </div>
            <div className="text-3xl font-extrabold text-violet-600 dark:text-violet-400 mt-2">
              {insights.understandingGapCS}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Understanding Gap - CS
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* L2 CONFIRMATION SCORECARD (BELOW STATS) */}
      {/* ================================================================ */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h4 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
            NOC Confirmation Scorecard
          </h4>
        </div>
        {insights.l2Scorecard.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            No L2 confirmations yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50">
                  <th className="text-left px-5 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                    Reviewer
                  </th>
                  <th className="text-center px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                    Confirmed
                  </th>
                  <th className="text-center px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                    Rejected
                  </th>
                  <th className="text-center px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                    Total
                  </th>
                  <th className="text-center px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                    UG
                  </th>
                  <th className="text-center px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                    Rejection Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {insights.l2Scorecard.map((person) => (
                  <tr
                    key={person.name}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <button
                        onClick={() => {
                          if (!selectedConfirmationBy.includes(person.name))
                            setSelectedConfirmationBy([
                              ...selectedConfirmationBy,
                              person.name,
                            ]);
                        }}
                        className="text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        {person.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                        <CheckCircle className="w-3.5 h-3.5" />
                        {person.confirmed}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-bold text-xs">
                        <XCircle className="w-3.5 h-3.5" />
                        {person.rejected}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-slate-700 dark:text-slate-300 font-bold text-xs">
                        {person.total}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-bold ${person.ug > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-600"}`}>
                        {person.ug > 0 && <AlertTriangle className="w-3.5 h-3.5" />}
                        {person.ug}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-extrabold ${
                          Number(person.rejectionRate) <= 30
                            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/20"
                            : Number(person.rejectionRate) <= 60
                              ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-500/20"
                              : "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400 ring-1 ring-rose-200 dark:ring-rose-500/20"
                        }`}
                      >
                        {person.rejectionRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default NOCAnalytics;
