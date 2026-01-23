import React, { useState, useMemo, useCallback } from "react";
import {
  X,
  ArrowLeft,
  ExternalLink,
  Building2,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Filter,
  Clock,
  Inbox,
  Pause,
  CheckCircle2,
  Users,
  Globe,
  Layers,
  Briefcase,
  UserCircle,
  Calendar,
  Link2,
  LayoutGrid,
  Download,
  FileSpreadsheet,
  Plus,
  Activity,
  Check,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import {
  format,
  parseISO,
  isWithinInterval,
  startOfDay,
  endOfDay,
  subDays,
} from "date-fns";
import { FLAT_TEAM_MAP, TEAM_GROUPS, STAGE_MAP } from "../utils";

// GST Users list (for filtering)
const GST_USERS = Object.values(FLAT_TEAM_MAP).sort();

// Filter options for modal
const MODAL_FILTER_OPTIONS = [
  { key: "region", label: "Region", icon: Globe },
  { key: "assignee", label: "Assignee", icon: Users },
  { key: "account", label: "Account", icon: Building2 },
  { key: "csm", label: "CSM", icon: Briefcase },
  { key: "tam", label: "TAM", icon: UserCircle },
  { key: "stage", label: "Stage", icon: Activity },
  { key: "dependency", label: "Dependency", icon: Link2 },
];

// Color palette for pie chart slices
const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
];

// Ticket states configuration
const TICKET_STATES = {
  open: {
    key: "open",
    label: "Open",
    icon: Inbox,
    color: "#3b82f6",
    bgLight: "bg-blue-50",
    bgDark: "dark:bg-blue-900/20",
    textLight: "text-blue-700",
    textDark: "dark:text-blue-400",
    stages: ["Waiting on Assignee"],
  },
  pending: {
    key: "pending",
    label: "Pending",
    icon: Clock,
    color: "#f59e0b",
    bgLight: "bg-amber-50",
    bgDark: "dark:bg-amber-900/20",
    textLight: "text-amber-700",
    textDark: "dark:text-amber-400",
    stages: ["Awaiting Customer Reply"],
  },
  onhold: {
    key: "onhold",
    label: "On Hold",
    icon: Pause,
    color: "#8b5cf6",
    bgLight: "bg-violet-50",
    bgDark: "dark:bg-violet-900/20",
    textLight: "text-violet-700",
    textDark: "dark:text-violet-400",
    stages: ["Waiting on CleverTap"],
  },
  solved: {
    key: "solved",
    label: "Solved",
    icon: CheckCircle2,
    color: "#10b981",
    bgLight: "bg-emerald-50",
    bgDark: "dark:bg-emerald-900/20",
    textLight: "text-emerald-700",
    textDark: "dark:text-emerald-400",
    stages: ["Solved", "Closed", "resolved"],
  },
};

// ============================================================================
// FILTER DROPDOWN - Reusable checkbox filter component
// ============================================================================
const FilterDropdown = ({ icon: Icon, label, options, selected, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    return options
      .filter((opt) => opt && opt.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        const aSelected = selected.includes(a);
        const bSelected = selected.includes(b);
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return a.localeCompare(b);
      });
  }, [options, query, selected]);

  const allSelected =
    filteredOptions.length > 0 &&
    filteredOptions.every((opt) => selected.includes(opt));

  const toggleAll = () => {
    if (allSelected) {
      onChange(selected.filter((s) => !filteredOptions.includes(s)));
    } else {
      onChange([...new Set([...selected, ...filteredOptions])]);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
          selected.length > 0
            ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400"
        }`}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>
          {selected.length > 0 ? `${selected.length} ${label}` : label}
        </span>
        <ChevronLeft
          className={`w-3 h-3 transition-transform ${isOpen ? "-rotate-90" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder={`Search ${label}...`}
                className="w-full pl-7 pr-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs focus:outline-none"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          {/* Select All */}
          {filteredOptions.length > 1 && (
            <div className="px-2 pt-2 border-b border-slate-100 dark:border-slate-800">
              <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Select All
                </span>
                <span className="text-slate-400 ml-auto">
                  ({filteredOptions.length})
                </span>
              </label>
            </div>
          )}

          {/* Options */}
          <div className="max-h-48 overflow-y-auto p-1">
            {filteredOptions.map((opt) => (
              <label
                key={opt}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs ${
                  selected.includes(opt)
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => {
                    if (selected.includes(opt)) {
                      onChange(selected.filter((s) => s !== opt));
                    } else {
                      onChange([...selected, opt]);
                    }
                  }}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600"
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>

          {/* Footer */}
          <div className="p-2 border-t border-slate-100 dark:border-slate-800 flex justify-between">
            <button
              onClick={() => onChange([])}
              className="text-[10px] text-slate-500 font-bold hover:text-rose-600 px-2"
            >
              CLEAR
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[10px] bg-indigo-600 text-white px-3 py-1 rounded font-bold hover:bg-indigo-700"
            >
              DONE
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// DRILL DOWN MODAL - Shows filtered ticket list
// ============================================================================
const DrillDownModal = ({
  isOpen,
  onClose,
  title,
  tickets,
  filters,
  onFilterChange,
  dependencies = {},
}) => {
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({
    key: "days",
    direction: "desc",
  });
  const pageSize = 25;

  // Multi-select filter states
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [selectedAssignees, setSelectedAssignees] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [selectedCSMs, setSelectedCSMs] = useState([]);
  const [selectedTAMs, setSelectedTAMs] = useState([]);
  const [selectedStages, setSelectedStages] = useState([]);
  const [selectedDependency, setSelectedDependency] = useState([
    "with_dependency",
    "no_dependency",
  ]);
  const [selectedDepTeams, setSelectedDepTeams] = useState([
    "NOC",
    "Whatsapp",
    "Billing",
    "Email",
    "Internal",
    "Other",
  ]);

  // Visible filters and menu
  const [visibleFilters, setVisibleFilters] = useState(["region", "assignee"]);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Reset all filters when opening new view
  React.useEffect(() => {
    setCurrentPage(1);
    setSearch("");
    setSelectedRegions([]);
    setSelectedAssignees([]);
    setSelectedAccounts([]);
    setSelectedCSMs([]);
    setSelectedTAMs([]);
    setSelectedStages([]);
    setSelectedDependency(["with_dependency", "no_dependency"]);
    setSelectedDepTeams([
      "NOC",
      "Whatsapp",
      "Billing",
      "Email",
      "Internal",
      "Other",
    ]);
  }, [tickets]);

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const regions = new Set();
    const accounts = new Set();
    const csms = new Set();
    const tams = new Set();

    tickets.forEach((t) => {
      if (t.region) regions.add(t.region);
      if (t.accountName && t.accountName !== "Unknown")
        accounts.add(t.accountName);
      if (t.csm && t.csm !== "Unknown") csms.add(t.csm.split("@")[0]);
      if (t.tam && t.tam !== "Unknown") tams.add(t.tam);
    });

    return {
      regions: Array.from(regions).sort(),
      assignees: GST_USERS,
      accounts: Array.from(accounts).sort(),
      csms: Array.from(csms).sort(),
      tams: Array.from(tams).sort(),
      stages: ["Open", "Pending", "On Hold", "Solved"],
    };
  }, [tickets]);

  // Filter tickets with multi-select filters
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch =
          t.title?.toLowerCase().includes(searchLower) ||
          t.display_id?.toLowerCase().includes(searchLower) ||
          t.accountName?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Region filter (multi-select)
      if (selectedRegions.length > 0 && !selectedRegions.includes(t.region)) {
        return false;
      }

      // Assignee filter (multi-select)
      if (selectedAssignees.length > 0) {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name;
        if (!selectedAssignees.includes(owner)) return false;
      }

      // Account filter
      if (
        selectedAccounts.length > 0 &&
        !selectedAccounts.includes(t.accountName)
      ) {
        return false;
      }

      // CSM filter
      if (selectedCSMs.length > 0) {
        const csm = t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "";
        if (!selectedCSMs.includes(csm)) return false;
      }

      // TAM filter
      if (selectedTAMs.length > 0) {
        const tam = t.tam && t.tam !== "Unknown" ? t.tam : "";
        if (!selectedTAMs.includes(tam)) return false;
      }

      // Stage filter
      if (selectedStages.length > 0) {
        const stageLower = (t.stage?.name || "").toLowerCase();
        let stageCategory = "Open";
        if (
          stageLower.includes("awaiting customer") ||
          stageLower.includes("pending")
        )
          stageCategory = "Pending";
        else if (
          stageLower.includes("waiting on clevertap") ||
          stageLower.includes("on hold")
        )
          stageCategory = "On Hold";
        else if (
          stageLower.includes("solved") ||
          stageLower.includes("closed") ||
          stageLower.includes("resolved")
        )
          stageCategory = "Solved";

        if (!selectedStages.includes(stageCategory)) return false;
      }

      // Dependency filter
      if (selectedDependency.length > 0 && selectedDependency.length < 2) {
        const ticketId = t.display_id?.replace("TKT-", "");
        const dep = dependencies[ticketId];
        const hasDep = dep?.hasDependency === true;
        if (selectedDependency.includes("with_dependency") && !hasDep)
          return false;
        if (selectedDependency.includes("no_dependency") && hasDep)
          return false;
      }

      // Dependency filter
      if (selectedDependency.length > 0 && selectedDependency.length < 2) {
        const ticketId = t.display_id?.replace("TKT-", "");
        const dep = dependencies[ticketId];
        const hasDep = dep?.hasDependency === true;
        if (selectedDependency.includes("with_dependency") && !hasDep)
          return false;
        if (selectedDependency.includes("no_dependency") && hasDep)
          return false;
      }

      // Dependency team filter
      if (
        selectedDependency.includes("with_dependency") &&
        selectedDepTeams.length > 0 &&
        selectedDepTeams.length < 6
      ) {
        const ticketId = t.display_id?.replace("TKT-", "");
        const dep = dependencies[ticketId];
        if (dep?.hasDependency) {
          const ticketTeams = dep.issues?.map((i) => i.team) || [];
          const hasMatchingTeam = selectedDepTeams.some((team) =>
            ticketTeams.includes(team),
          );
          if (!hasMatchingTeam) return false;
        }
      }

      return true;
    });
  }, [
    tickets,
    search,
    selectedRegions,
    selectedAssignees,
    selectedAccounts,
    selectedCSMs,
    selectedTAMs,
    selectedStages,
    selectedDependency,
    selectedDepTeams,
    dependencies,
  ]);

  // Download CSV function - Professional sectioned report
  const downloadCSV = useCallback(() => {
    // Group tickets by state
    const ticketsByState = {
      Open: [],
      Pending: [],
      "On Hold": [],
      Solved: [],
    };

    filteredTickets.forEach((t) => {
      const stageLower = (t.stage?.name || "").toLowerCase();
      let state = "Open";
      if (
        stageLower.includes("awaiting customer") ||
        stageLower.includes("pending")
      )
        state = "Pending";
      else if (
        stageLower.includes("waiting on clevertap") ||
        stageLower.includes("on hold")
      )
        state = "On Hold";
      else if (
        stageLower.includes("solved") ||
        stageLower.includes("closed") ||
        stageLower.includes("resolved")
      )
        state = "Solved";
      ticketsByState[state].push(t);
    });

    // Build CSV with sections
    let csvContent = "";

    // Summary section
    csvContent += "TICKET REPORT\n";
    csvContent += `Generated:,${format(new Date(), "MMMM dd yyyy HH:mm")}\n`;
    csvContent += `Report:,${title}\n`;
    csvContent += `Total Tickets:,${filteredTickets.length}\n`;
    csvContent += "\n";
    csvContent += "SUMMARY BY STATUS\n";
    csvContent += `Open:,${ticketsByState.Open.length}\n`;
    csvContent += `Pending:,${ticketsByState.Pending.length}\n`;
    csvContent += `On Hold:,${ticketsByState["On Hold"].length}\n`;
    csvContent += `Solved:,${ticketsByState.Solved.length}\n`;
    csvContent += "\n";

    const headers = [
      "Ticket ID",
      "Title",
      "Account",
      "Region",
      "CSM",
      "TAM",
      "Assignee",
      "Age (Days)",
      "RWT (hrs)",
      "FRT (hrs)",
      "Iterations",
      "CSAT",
      "FRR",
    ];

    // Process each state section
    ["Open", "Pending", "On Hold", "Solved"].forEach((state) => {
      const stateTickets = ticketsByState[state];

      csvContent += "\n";
      csvContent += `${"=".repeat(20)}\n`;
      csvContent += `${state.toUpperCase()} TICKETS (${stateTickets.length})\n`;
      csvContent += `${"=".repeat(20)}\n`;

      if (stateTickets.length === 0) {
        csvContent += "No tickets in this category\n";
      } else {
        csvContent += headers.join(",") + "\n";

        stateTickets.forEach((t) => {
          const owner =
            FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
            t.owned_by?.[0]?.display_name ||
            "Unassigned";
          const csm = t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "-";
          const tam = t.tam && t.tam !== "Unknown" ? t.tam : "-";

          const row = [
            t.display_id,
            `"${(t.title || "").replace(/"/g, '""')}"`,
            `"${(t.accountName || "").replace(/"/g, '""')}"`,
            t.region || "-",
            csm,
            tam,
            owner,
            t.created_date
              ? format(parseISO(t.created_date), "yyyy-MM-dd")
              : "-", // ✅ Added
            t.actual_close_date
              ? format(parseISO(t.actual_close_date), "yyyy-MM-dd")
              : "-", // ✅ Added
            // ... rest of fields
            t.days || 0,
            t.rwt || "-",
            t.frt || "-",
            t.iterations || "-",
            t.csat || "-",
            t.frr || "-",
          ];
          csvContent += row.join(",") + "\n";
        });
      }
    });

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Ticket_Report_${title.replace(/\s+/g, "_")}_${format(new Date(), "yyyy-MM-dd_HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredTickets, title]);

   const calculateAge = (t) => {
    if (!t.created_date) return 0;
    const start = new Date(t.created_date);
    const end = t.actual_close_date
      ? new Date(t.actual_close_date)
      : new Date();
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Sort tickets
  const sortedTickets = useMemo(() => {
    const sorted = [...filteredTickets];

    sorted.sort((a, b) => {
      let aVal, bVal;

      switch (sortConfig.key) {
        // ✅ NEW: Sort by Created Date
        case "created":
          aVal = new Date(a.created_date || 0).getTime();
          bVal = new Date(b.created_date || 0).getTime();
          break;

        // ✅ NEW: Sort by Closed Date
        case "closed":
          aVal = new Date(a.actual_close_date || 0).getTime();
          bVal = new Date(b.actual_close_date || 0).getTime();
          break;

        // ✅ FIXED: Sort by Calculated Age
        case "days":
          aVal = calculateAge(a);
          bVal = calculateAge(b);
          break;

        case "rwt":
          aVal = a.rwt || 0;
          bVal = b.rwt || 0;
          break;
        case "frt":
          aVal = a.frt || 0;
          bVal = b.frt || 0;
          break;
        case "iterations":
          aVal = a.iterations || 0;
          bVal = b.iterations || 0;
          break;
        default:
          return 0;
      }

      return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [filteredTickets, sortConfig]);

  // Handle sort click
  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
    setCurrentPage(1);
  };
 

  // Pagination
  const totalPages = Math.ceil(sortedTickets.length / pageSize);
  const paginatedTickets = sortedTickets.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  // Sort indicator component
  const SortIndicator = ({ column }) => {
    if (sortConfig.key !== column) {
      return <span className="text-slate-300 ml-1">↕</span>;
    }
    return (
      <span className="text-indigo-500 ml-1">
        {sortConfig.direction === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </button>
            <span className="text-sm text-slate-500">Back to Overview</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Title & Filters */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-3">
            {title}
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="ID / Title"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9 pr-4 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg w-36 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Region Filter - Checkbox style */}
            {visibleFilters.includes("region") && (
              <FilterDropdown
                icon={Globe}
                label="Region"
                options={filterOptions.regions}
                selected={selectedRegions}
                onChange={(v) => {
                  setSelectedRegions(v);
                  setCurrentPage(1);
                }}
              />
            )}

            {/* Assignee Filter */}
            {visibleFilters.includes("assignee") && (
              <FilterDropdown
                icon={Users}
                label="Assignee"
                options={filterOptions.assignees}
                selected={selectedAssignees}
                onChange={(v) => {
                  setSelectedAssignees(v);
                  setCurrentPage(1);
                }}
              />
            )}

            {/* Account Filter */}
            {visibleFilters.includes("account") && (
              <FilterDropdown
                icon={Building2}
                label="Account"
                options={filterOptions.accounts}
                selected={selectedAccounts}
                onChange={(v) => {
                  setSelectedAccounts(v);
                  setCurrentPage(1);
                }}
              />
            )}

            {/* CSM Filter */}
            {visibleFilters.includes("csm") && (
              <FilterDropdown
                icon={Briefcase}
                label="CSM"
                options={filterOptions.csms}
                selected={selectedCSMs}
                onChange={(v) => {
                  setSelectedCSMs(v);
                  setCurrentPage(1);
                }}
              />
            )}

            {/* TAM Filter */}
            {visibleFilters.includes("tam") && (
              <FilterDropdown
                icon={UserCircle}
                label="TAM"
                options={filterOptions.tams}
                selected={selectedTAMs}
                onChange={(v) => {
                  setSelectedTAMs(v);
                  setCurrentPage(1);
                }}
              />
            )}

            {/* Stage Filter */}
            {visibleFilters.includes("stage") && (
              <FilterDropdown
                icon={Activity}
                label="Stage"
                options={filterOptions.stages}
                selected={selectedStages}
                onChange={(v) => {
                  setSelectedStages(v);
                  setCurrentPage(1);
                }}
              />
            )}

            {/* Dependency Filter */}
            {visibleFilters.includes("dependency") && (
              <div className="relative group">
                <button className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  <Link2 className="w-3.5 h-3.5" />
                  Dependency
                  <ChevronDown className="w-3 h-3" />
                </button>
                <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 p-3 hidden group-hover:block">
                  <div className="text-xs font-bold text-slate-500 uppercase mb-2">
                    Status
                  </div>
                  {[
                    { value: "with_dependency", label: "Has Dependency" },
                    { value: "no_dependency", label: "No Dependency" },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2 cursor-pointer py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 px-2 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDependency.includes(opt.value)}
                        onChange={(e) => {
                          const newVal = e.target.checked
                            ? [...selectedDependency, opt.value]
                            : selectedDependency.filter((v) => v !== opt.value);
                          setSelectedDependency(newVal);
                          setCurrentPage(1);
                        }}
                        className="rounded border-slate-300 text-indigo-600"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">
                        {opt.label}
                      </span>
                    </label>
                  ))}
                  {selectedDependency.includes("with_dependency") && (
                    <>
                      <div className="text-xs font-bold text-slate-500 uppercase mt-3 mb-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        Team
                      </div>
                      {[
                        "NOC",
                        "Whatsapp",
                        "Billing",
                        "Email",
                        "Internal",
                        "Other",
                      ].map((team) => (
                        <label
                          key={team}
                          className="flex items-center gap-2 cursor-pointer py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 px-2 rounded"
                        >
                          <input
                            type="checkbox"
                            checked={selectedDepTeams.includes(team)}
                            onChange={(e) => {
                              const newVal = e.target.checked
                                ? [...selectedDepTeams, team]
                                : selectedDepTeams.filter((v) => v !== team);
                              setSelectedDepTeams(newVal);
                              setCurrentPage(1);
                            }}
                            className="rounded border-slate-300 text-indigo-600"
                          />
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-medium ${
                              team === "NOC"
                                ? "bg-rose-100 text-rose-700"
                                : team === "Whatsapp"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : team === "Billing"
                                    ? "bg-amber-100 text-amber-700"
                                    : team === "Email"
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {team}
                          </span>
                        </label>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* + Filter Button */}

            {/* + Filter Button */}
            <div className="relative">
              <button
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
              >
                <Plus className="w-3.5 h-3.5" />
                Filter
              </button>

              {showFilterMenu && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50 p-2">
                  {MODAL_FILTER_OPTIONS.map((opt) => {
                    const isVisible = visibleFilters.includes(opt.key);
                    return (
                      <label
                        key={opt.key}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={() => {
                            if (isVisible) {
                              setVisibleFilters(
                                visibleFilters.filter((k) => k !== opt.key),
                              );
                            } else {
                              setVisibleFilters([...visibleFilters, opt.key]);
                            }
                          }}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600"
                        />
                        <opt.icon className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-slate-600 dark:text-slate-400">
                          {opt.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Clear All */}
            <button
              onClick={() => {
                setSearch("");
                setSelectedRegions([]);
                setSelectedAssignees([]);
                setSelectedAccounts([]);
                setSelectedCSMs([]);
                setSelectedTAMs([]);
                setSelectedStages([]);
                setCurrentPage(1);
              }}
              className="px-3 py-2 text-xs text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
            >
              Clear
            </button>

            {/* Download */}
            <button
              onClick={downloadCSV}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 font-medium ml-auto"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm min-w-[1400px]">
            <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0">
              <tr className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 text-left font-semibold">
                  ID / Title
                </th>
                <th className="py-3 px-3 text-left font-semibold">Account</th>
                <th className="py-3 px-3 text-left font-semibold">Region</th>
                <th className="py-3 px-3 text-left font-semibold">CSM</th>
                <th className="py-3 px-3 text-left font-semibold">TAM</th>
                <th className="py-3 px-3 text-left font-semibold">Assignee</th>
                <th className="py-3 px-3 text-left font-semibold">Dep Team</th>
                <th className="py-3 px-3 text-left font-semibold">
                  Dep Assignee
                </th>
                {/* ✅ UPDATED: Sortable Headers */}
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("created")}
                >
                  Created
                  <SortIndicator column="created" />
                </th>

                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("closed")}
                >
                  Closed
                  <SortIndicator column="closed" />
                </th>
                <th className="py-3 px-3 text-left font-semibold">Stage</th>
                <th
                  className="py-3 px-3 text-right font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("days")}
                >
                  Age
                  <SortIndicator column="days" />
                </th>
                <th
                  className="py-3 px-3 text-right font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("rwt")}
                >
                  RWT
                  <SortIndicator column="rwt" />
                </th>
                <th
                  className="py-3 px-3 text-right font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("frt")}
                >
                  FRT
                  <SortIndicator column="frt" />
                </th>
                <th
                  className="py-3 px-3 text-right font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("iterations")}
                >
                  Iter
                  <SortIndicator column="iterations" />
                </th>
                <th className="py-3 px-3 text-right font-semibold">CSAT</th>
                <th className="py-3 px-3 text-right font-semibold">FRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedTickets.map((t, idx) => {
                const owner =
                  FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
                  t.owned_by?.[0]?.display_name ||
                  "Unassigned";
                const csm =
                  t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "-";
                const tam = t.tam && t.tam !== "Unknown" ? t.tam : "-";
                const ticketAge = calculateAge(t);

                return (
                  <tr
                    key={t.id || idx}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          {t.display_id}
                        </a>
                      </div>
                      <div
                        className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-[250px]"
                        title={t.title}
                      >
                        {t.title}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400 text-xs max-w-[120px] truncate">
                      {t.accountName || "-"}
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-600 dark:text-slate-400">
                        {t.region || "-"}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400 text-xs">
                      {csm}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400 text-xs">
                      {tam}
                    </td>
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300 text-xs font-medium">
                      {owner}
                    </td>
                    <td className="py-3 px-3">
                      {(() => {
                        const ticketId = t.display_id?.replace("TKT-", "");
                        const dep = dependencies[ticketId];
                        const team = dep?.primary?.team || null;
                        if (!team)
                          return <span className="text-slate-400">-</span>;
                        const colors = {
                          NOC: "bg-rose-100 text-rose-700",
                          Whatsapp: "bg-emerald-100 text-emerald-700",
                          Billing: "bg-amber-100 text-amber-700",
                          Email: "bg-blue-100 text-blue-700",
                        };
                        return (
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-medium ${colors[team] || "bg-slate-100 text-slate-700"}`}
                          >
                            {team}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400">
                      {(() => {
                        const ticketId = t.display_id?.replace("TKT-", "");
                        return dependencies[ticketId]?.primary?.owner || "-";
                      })()}
                    </td>
                    {/* ✅ NEW: Created Date Column */}
                    <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {t.created_date
                        ? format(parseISO(t.created_date), "MMM d, yyyy")
                        : "-"}
                    </td>

                    {/* ✅ NEW: Closed Date Column */}
                    <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {t.actual_close_date
                        ? format(parseISO(t.actual_close_date), "MMM d, yyyy")
                        : "-"}
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-medium">
                        {STAGE_MAP[t.stage?.name]?.label ||
                          t.stage?.name ||
                          "-"}
                      </span>
                    </td>
                    {/* ✅ FIXED: Age Column using calculated value */}
                    <td className="py-3 px-3 text-right">
                      <span
                        className={`text-sm font-medium ${
                          ticketAge > 15
                            ? "text-rose-600"
                            : ticketAge > 10
                              ? "text-amber-600"
                              : "text-slate-600"
                        }`}
                      >
                        {ticketAge}d
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-xs text-slate-600 dark:text-slate-400">
                      {t.rwt ? `${t.rwt}h` : "-"}
                    </td>
                    <td className="py-3 px-3 text-right text-xs text-slate-600 dark:text-slate-400">
                      {t.frt ? `${t.frt}h` : "-"}
                    </td>
                    <td className="py-3 px-3 text-right text-xs text-slate-600 dark:text-slate-400">
                      {t.iterations || "-"}
                    </td>
                    <td className="py-3 px-3 text-right text-xs text-slate-600 dark:text-slate-400">
                      {t.csat || "-"}
                    </td>
                    <td className="py-3 px-3 text-right text-xs text-slate-600 dark:text-slate-400">
                      {t.frr || "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {paginatedTickets.length === 0 && (
            <div className="py-16 text-center text-slate-400">
              <Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No tickets found</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30">
          <span className="text-sm text-slate-500">
            {(currentPage - 1) * pageSize + 1}-
            {Math.min(currentPage * pageSize, sortedTickets.length)} of{" "}
            {sortedTickets.length} {title.toLowerCase()}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-slate-600 dark:text-slate-400 px-2">
              {currentPage} of {totalPages || 1}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// GROUPING TAB OPTIONS
// ============================================================================
const GROUPING_TABS = [
  { key: "gst", label: "GST", icon: Users },
  { key: "csm", label: "CSM", icon: Briefcase },
  { key: "tam", label: "TAM", icon: UserCircle },
  { key: "region", label: "Region", icon: Globe },
];

// ============================================================================
// PIE CHART CARD - Individual state card with pie chart
// ============================================================================
const StateCard = ({ state, tickets, onCardClick, onSliceClick, groupBy = "gst" }) => {
  const config = TICKET_STATES[state];
  const Icon = config.icon;

  // Group tickets based on selected groupBy option
  const chartData = useMemo(() => {
    const groups = {};
    tickets.forEach((t) => {
      let groupKey;

      switch (groupBy) {
        case "csm":
          const csmName = t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "No CSM";
          // Capitalize first letter of each word
          groupKey = csmName === "No CSM" ? csmName : csmName.split(/[.\-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
          break;
        case "tam":
          groupKey = t.tam && t.tam !== "Unknown" ? t.tam : "No TAM";
          break;
        case "region":
          groupKey = t.region || "Unknown";
          // Normalize IN1/In1 to India
          if (groupKey === "IN1" || groupKey === "In1" || groupKey === "in1") {
            groupKey = "India";
          }
          break;
        case "gst":
        default:
          groupKey =
            FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
            t.owned_by?.[0]?.display_name ||
            "Unassigned";
          // Exclude anmol-sawhney for GST view
          if (groupKey.toLowerCase().includes("anmol")) return;
          break;
      }

      groups[groupKey] = (groups[groupKey] || 0) + 1;
    });

    const total = Object.values(groups).reduce((a, b) => a + b, 0);

    return Object.entries(groups)
      .map(([name, value]) => ({
        name,
        value,
        percentage: total > 0 ? Math.round((value / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [tickets, groupBy]);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-slate-800 px-3 py-2 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700">
          <p className="text-sm font-medium text-slate-800 dark:text-white">
            {data.name}
          </p>
          <p className="text-xs text-slate-500">
            {data.value} tickets ({data.percentage}%)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <button
        onClick={() => onCardClick(state)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800"
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${config.bgLight} ${config.bgDark}`}>
            <Icon
              className={`w-5 h-5 ${config.textLight} ${config.textDark}`}
            />
          </div>
          <span className="font-semibold text-slate-800 dark:text-white">
            {config.label}
          </span>
        </div>
        <span className="text-2xl font-bold text-slate-800 dark:text-white">
          {tickets.length}
        </span>
      </button>

      {/* Pie Chart */}
      <div className="p-4">
        {tickets.length > 0 ? (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                  onClick={(data) => onSliceClick(state, data.name, groupBy)}
                  className="cursor-pointer"
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                      stroke="transparent"
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-slate-400">
            <p className="text-sm">No tickets</p>
          </div>
        )}

        {/* Legend - Show ALL entries based on groupBy */}
        {chartData.length > 0 && (
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
            {chartData.map((item, idx) => (
              <button
                key={item.name}
                onClick={() => onSliceClick(state, item.name, groupBy)}
                className="w-full flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 px-2 py-1 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                  />
                  <span className="text-slate-600 dark:text-slate-400 truncate max-w-[100px]">
                    {item.name}
                  </span>
                </div>
                <span className="text-slate-500 font-medium">
                  {item.percentage}%
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// DISTRIBUTION CHART - Account/Region distribution
// ============================================================================
const DistributionChart = ({ title, subtitle, data, onItemClick }) => {
  const chartData = useMemo(() => {
    return data
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
      .map((item, idx) => ({
        ...item,
        color: COLORS[idx % COLORS.length],
      }));
  }, [data]);

  const total = data.reduce((acc, d) => acc + d.value, 0);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-white dark:bg-slate-800 px-3 py-2 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700">
          <p className="text-sm font-medium text-slate-800 dark:text-white">
            {d.name}
          </p>
          <p className="text-xs text-slate-500">
            {d.value} tickets ({d.percentage}%)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="font-semibold text-slate-800 dark:text-white">
          {title}
        </h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>

      <div className="flex gap-4">
        {/* Pie Chart */}
        <div className="w-40 h-40 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={30}
                outerRadius={55}
                paddingAngle={2}
                dataKey="value"
                onClick={(d) => onItemClick && onItemClick(d.name)}
                className="cursor-pointer"
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color}
                    stroke="transparent"
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-1.5 max-h-40 overflow-y-auto">
          {chartData.map((item) => (
            <button
              key={item.name}
              onClick={() => onItemClick && onItemClick(item.name)}
              className="w-full flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 px-2 py-1 rounded transition-colors"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-slate-600 dark:text-slate-400 truncate max-w-[120px]">
                  {item.name}
                </span>
              </div>
              <span className="text-slate-500 font-medium">
                {item.percentage}%
              </span>
            </button>
          ))}
          {data.length > 8 && (
            <p className="text-[10px] text-slate-400 pl-2">
              +{data.length - 8} more
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT - AllTicketsView
// ============================================================================
const AllTicketsView = ({
  tickets,
  filters,
  onFilterChange,
  filterOptions,
  dependencies = {},
}) => {
  const [drillDown, setDrillDown] = useState(null); // { state, assignee?, title }
  const [groupBy, setGroupBy] = useState("gst"); // gst, csm, tam, region

  // Categorize tickets by state (with dependency filtering)
  const categorizedTickets = useMemo(() => {
    const result = {
      open: [],
      pending: [],
      onhold: [],
      solved: [],
    };

    // Use filters.dateRange for solved tickets (solved date, not created date)
    const hasDateFilter = filters?.dateRange?.start && filters?.dateRange?.end;
    const filterStart = hasDateFilter
      ? new Date(filters.dateRange.start)
      : null;
    const filterEnd = hasDateFilter
      ? new Date(filters.dateRange.end + "T23:59:59")
      : null;

    // Dependency filter settings
    const depFilter = filters?.dependency || [];
    const depTeamsFilter = filters?.dependencyTeams || [];
    const hasDepFilter = depFilter.length > 0 && depFilter.length < 2;
    const hasDepTeamsFilter =
      depFilter.includes("with_dependency") &&
      depTeamsFilter.length > 0 &&
      depTeamsFilter.length < 6;

    tickets.forEach((t) => {
      // Apply dependency filter first
      if (hasDepFilter) {
        const ticketId = t.display_id?.replace("TKT-", "");
        const dep = dependencies[ticketId];
        const hasDep = dep?.hasDependency === true;

        if (
          depFilter.includes("with_dependency") &&
          !depFilter.includes("no_dependency") &&
          !hasDep
        ) {
          return; // Skip - want dependency but ticket has none
        }
        if (
          depFilter.includes("no_dependency") &&
          !depFilter.includes("with_dependency") &&
          hasDep
        ) {
          return; // Skip - want no dependency but ticket has one
        }
      }

      // Apply dependency team filter
      if (hasDepTeamsFilter) {
        const ticketId = t.display_id?.replace("TKT-", "");
        const dep = dependencies[ticketId];
        if (dep?.hasDependency) {
          const ticketTeams = dep.issues?.map((i) => i.team) || [];
          const hasMatchingTeam = depTeamsFilter.some((team) =>
            ticketTeams.includes(team),
          );
          if (!hasMatchingTeam) return; // Skip - no matching team
        }
      }

      const stageName = t.stage?.name?.toLowerCase() || "";
      const owner =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "Unassigned";

      if (
        stageName.includes("solved") ||
        stageName.includes("closed") ||
        stageName.includes("resolved")
      ) {
        // For solved: filter by SOLVED DATE (not created date), exclude Unassigned
        if (owner !== "Unassigned") {
          // Get solved/closed date
          const solvedDate = t.actual_close_date
            ? new Date(t.actual_close_date)
            : t.closed_date
              ? new Date(t.closed_date)
              : t.modified_date
                ? new Date(t.modified_date)
                : null;
          if (hasDateFilter && solvedDate) {
            // Only include if solved within date range
            if (solvedDate >= filterStart && solvedDate <= filterEnd) {
              result.solved.push(t);
            }
          } else if (!hasDateFilter) {
            // No date filter = include all solved
            result.solved.push(t);
          }
        }
      } else if (
        stageName.includes("awaiting customer") ||
        stageName.includes("pending")
      ) {
        result.pending.push(t);
      } else if (
        stageName.includes("waiting on clevertap") ||
        stageName.includes("on hold")
      ) {
        result.onhold.push(t);
      } else {
        result.open.push(t);
      }
    });

    return result;
  }, [
    tickets,
    filters?.dateRange,
    filters?.dependency,
    filters?.dependencyTeams,
    dependencies,
  ]);

  // Account distribution data
  const accountDistribution = useMemo(() => {
    const groups = {};
    tickets.forEach((t) => {
      const account = t.accountName || "Unknown";
      groups[account] = (groups[account] || 0) + 1;
    });

    const total = tickets.length;
    return Object.entries(groups)
      .map(([name, value]) => ({
        name,
        value,
        percentage: Math.round((value / total) * 100),
      }))
      .sort((a, b) => b.value - a.value);
  }, [tickets]);

  // Region distribution data (merge India/IN1)
  const regionDistribution = useMemo(() => {
    const groups = {};
    tickets.forEach((t) => {
      let region = t.region || "Unknown";
      // Normalize IN1/In1 to India
      if (region === "IN1" || region === "In1" || region === "in1") {
        region = "India";
      }
      groups[region] = (groups[region] || 0) + 1;
    });

    const total = tickets.length;
    return Object.entries(groups)
      .map(([name, value]) => ({
        name,
        value,
        percentage: total > 0 ? Math.round((value / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [tickets]);

  // Handle card click - open drill down for entire state
  const handleCardClick = useCallback(
    (state) => {
      const config = TICKET_STATES[state];
      setDrillDown({
        state,
        title: `${config.label} Tickets`,
        tickets: categorizedTickets[state],
      });
    },
    [categorizedTickets],
  );

  // Handle slice click - open drill down for specific groupBy value
  const handleSliceClick = useCallback(
    (state, value, groupType) => {
      const config = TICKET_STATES[state];
      const filtered = categorizedTickets[state].filter((t) => {
        switch (groupType) {
          case "csm":
            const csmRaw = t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "No CSM";
            const csmFormatted = csmRaw === "No CSM" ? csmRaw : csmRaw.split(/[.\-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
            return csmFormatted === value;
          case "tam":
            const tam = t.tam && t.tam !== "Unknown" ? t.tam : "No TAM";
            return tam === value;
          case "region":
            let region = t.region || "Unknown";
            if (region === "IN1" || region === "In1" || region === "in1") {
              region = "India";
            }
            return region === value;
          case "gst":
          default:
            const owner =
              FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
              t.owned_by?.[0]?.display_name ||
              "Unassigned";
            return owner === value;
        }
      });

      const groupLabel = {
        gst: "GST",
        csm: "CSM",
        tam: "TAM",
        region: "Region",
      }[groupType] || "GST";

      setDrillDown({
        state,
        value,
        groupType,
        title: `${config.label} Tickets - ${groupLabel}: ${value}`,
        tickets: filtered,
      });
    },
    [categorizedTickets],
  );

  // Handle distribution click
  const handleAccountClick = useCallback(
    (account) => {
      const filtered = tickets.filter((t) => t.accountName === account);
      setDrillDown({
        title: `Tickets for ${account}`,
        tickets: filtered,
      });
    },
    [tickets],
  );

  const handleRegionClick = useCallback(
    (region) => {
      const filtered = tickets.filter((t) => t.region === region);
      setDrillDown({
        title: `Tickets in ${region}`,
        tickets: filtered,
      });
    },
    [tickets],
  );

  // Outer download function - professional report
  const downloadFullReport = useCallback(() => {
    const allTickets = [
      ...categorizedTickets.open,
      ...categorizedTickets.pending,
      ...categorizedTickets.onhold,
      ...categorizedTickets.solved,
    ];

    let csvContent = "";
    csvContent += "TICKET REPORT - ALL TICKETS VIEW\n";
    csvContent += `Generated:,${format(new Date(), "MMMM dd yyyy HH:mm")}\n`;
    csvContent += `Total Tickets:,${allTickets.length}\n`;
    csvContent += "\n";
    csvContent += "SUMMARY BY STATUS\n";
    csvContent += `Open:,${categorizedTickets.open.length}\n`;
    csvContent += `Pending:,${categorizedTickets.pending.length}\n`;
    csvContent += `On Hold:,${categorizedTickets.onhold.length}\n`;
    csvContent += `Solved:,${categorizedTickets.solved.length}\n`;
    csvContent += "\n";

    const headers = [
      "Ticket ID",
      "Title",
      "Account",
      "Region",
      "CSM",
      "TAM",
      "Assignee",
      "Created Date", // ✅ Added
      "Closed Date",
      "Stage",
      "Age (Days)",
      "RWT (hrs)",
      "FRT (hrs)",
      "Iterations",
      "CSAT",
      "FRR",
    ];

    ["open", "pending", "onhold", "solved"].forEach((state) => {
      const stateTickets = categorizedTickets[state];
      const stateLabel = state === "onhold" ? "ON HOLD" : state.toUpperCase();

      csvContent += "\n";
      csvContent += `${"=".repeat(20)}\n`;
      csvContent += `${stateLabel} TICKETS (${stateTickets.length})\n`;
      csvContent += `${"=".repeat(20)}\n`;

      if (stateTickets.length === 0) {
        csvContent += "No tickets in this category\n";
      } else {
        csvContent += headers.join(",") + "\n";
        stateTickets.forEach((t) => {
          const owner =
            FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
            t.owned_by?.[0]?.display_name ||
            "Unassigned";
          const csm = t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "-";
          const tam = t.tam && t.tam !== "Unknown" ? t.tam : "-";
          const stage = STAGE_MAP[t.stage?.name]?.label || t.stage?.name || "-";

          csvContent +=
            [
              t.display_id,
              `"${(t.title || "").replace(/"/g, '""')}"`,
              `"${(t.accountName || "").replace(/"/g, '""')}"`,
              t.region || "-",
              csm,
              tam,
              owner,
              stage,
              t.days || 0,
              t.rwt || "-",
              t.frt || "-",
              t.iterations || "-",
              t.csat || "-",
              t.frr || "-",
            ].join(",") + "\n";
        });
      }
    });

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `All_Tickets_Report_${format(new Date(), "yyyy-MM-dd_HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [categorizedTickets]);

  return (
    <div className="space-y-6">
      {/* Header with Download and Grouping Tabs */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800 dark:text-white">
          All Tickets Overview
        </h2>

        {/* Grouping Tab Switcher - Cool UI like NOC */}
        <div className="flex items-center gap-1 bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          {GROUPING_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = groupBy === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setGroupBy(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20"
                    : "text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-white"
                }`}
              >
                <TabIcon className={`w-4 h-4 ${isActive ? "text-white" : ""}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Info Bar showing current grouping */}
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 px-4 py-2 rounded-lg">
        <Layers className="w-3.5 h-3.5" />
        <span>Pie charts grouped by: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{GROUPING_TABS.find(t => t.key === groupBy)?.label}</span></span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>Click on any slice or legend item to drill down</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {Object.keys(TICKET_STATES).map((state) => (
          <StateCard
            key={state}
            state={state}
            tickets={categorizedTickets[state]}
            onCardClick={handleCardClick}
            onSliceClick={handleSliceClick}
            groupBy={groupBy}
          />
        ))}
      </div>

      {/* Distribution Charts */}
      <div className="grid grid-cols-2 gap-4">
        <DistributionChart
          title="Account Distribution"
          subtitle="(based on current filters)"
          data={accountDistribution}
          onItemClick={handleAccountClick}
        />
        <DistributionChart
          title="Region Distribution"
          subtitle=""
          data={regionDistribution}
          onItemClick={handleRegionClick}
        />
      </div>

      {/* Drill Down Modal */}
      <DrillDownModal
        isOpen={!!drillDown}
        onClose={() => setDrillDown(null)}
        title={drillDown?.title || ""}
        tickets={drillDown?.tickets || []}
        filters={filters}
        onFilterChange={onFilterChange}
        dependencies={dependencies}
      />
    </div>
  );
};

export default AllTicketsView;
