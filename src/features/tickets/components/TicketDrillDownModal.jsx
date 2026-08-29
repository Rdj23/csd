/**
 * The All-Tickets drill-down: click a state card or chart slice, get the
 * filtered ticket list with its own search, sort, paging, filters and export.
 *
 * WAS 1,140 LINES INSIDE Allticketsview.jsx — more than half that file, and
 * named DrillDownModal like two other unrelated components (the analytics one
 * and the activity one). The file name now says which drill-down this is.
 *
 * FilterDropdown, GST_USERS and MODAL_FILTER_OPTIONS came along because this
 * modal is their only consumer.
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { format, parseISO } from "date-fns";
import {
  Activity, ArrowLeft, Briefcase, Building2, ChevronDown, ChevronLeft,
  ChevronRight, Download, Filter, Globe, Inbox, Link2, Plus, Search,
  UserCircle, Users, X,
} from "lucide-react";
import { csvTimestamp, downloadCsv } from "../../../lib/csv";
import {
  DEPENDENCY_EXPORT_HEADERS,
  DEPENDENCY_TEAMS,
  depTeamBadgeClass,
  getDependencyExportCells,
  getTicketDepInfo,
} from "../../../lib/dependencies";
import { FLAT_TEAM_MAP } from "../../../lib/teams";
import { STAGE_MAP } from "../../../lib/ticketStatus";

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
    ...DEPENDENCY_TEAMS,
  ]);

  // Visible filters and menu
  const [visibleFilters, setVisibleFilters] = useState(["region", "assignee", "stage"]);
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
    setSelectedDepTeams([...DEPENDENCY_TEAMS]);
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

      // Dependency filter — getTicketDepInfo prefers the sync-time Mongo
      // snapshot on all-solved rows, falling back to the live dependencies map.
      if (selectedDependency.length > 0 && selectedDependency.length < 2) {
        const hasDep = getTicketDepInfo(dependencies, t).hasDependency;
        if (selectedDependency.includes("with_dependency") && !hasDep)
          return false;
        if (selectedDependency.includes("no_dependency") && hasDep)
          return false;
      }

      // Dependency team filter — zero teams selected yields zero dependency
      // tickets (an empty selection is a narrowing, not a no-op).
      if (
        selectedDependency.includes("with_dependency") &&
        selectedDepTeams.length < DEPENDENCY_TEAMS.length
      ) {
        const depInfo = getTicketDepInfo(dependencies, t);
        if (depInfo.hasDependency) {
          const hasMatchingTeam = selectedDepTeams.some((team) =>
            depInfo.teams.includes(team),
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
      "Stage",
      "Created Date",
      "Solved Date",
      "Age (Days)",
      "RWT (hrs)",
      "FRT (hrs)",
      "Iterations",
      "CSAT",
      "FRR",
      "Last CT Reply",
      "Last Customer Reply",
      ...DEPENDENCY_EXPORT_HEADERS,
    ];

    const formatTimestamp = (ts) => {
      if (!ts) return "-";
      return new Date(ts).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    };

    csvContent += headers.join(",") + "\n";

    ["Open", "Pending", "On Hold", "Solved"].forEach((state) => {
      ticketsByState[state].forEach((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "Unassigned";
        const csm = t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "-";
        const tam = t.tam && t.tam !== "Unknown" ? t.tam : "-";
        const cf = t.custom_fields || {};

        const row = [
          t.display_id,
          `"${(t.title || "").replace(/"/g, '""')}"`,
          `"${(t.accountName || "").replace(/"/g, '""')}"`,
          t.region || "-",
          csm,
          tam,
          owner,
          STAGE_MAP[t.stage?.name]?.label || t.stage?.name || "-",
          `"${t.created_date ? format(parseISO(t.created_date), "MMM d, yyyy") : "-"}"`,
          `"${t.actual_close_date ? format(parseISO(t.actual_close_date), "MMM d, yyyy") : "-"}"`,
          calculateAge(t),
          t.rwt || "-",
          t.frt || "-",
          t.iterations || "-",
          t.csat || "-",
          t.frr || "-",
          `"${formatTimestamp(cf.tnt__last_devu_message_ts)}"`,
          `"${formatTimestamp(cf.tnt__last_revu_message_ts)}"`,
          ...getDependencyExportCells(dependencies, t.display_id, t),
        ];
        csvContent += row.join(",") + "\n";
      });
    });

    downloadCsv(`Ticket_Report_${title.replace(/\s+/g, "_")}_${csvTimestamp()}.csv`, csvContent);
  }, [filteredTickets, title, dependencies]);

   const calculateAge = (t) => {
    if (!t.created_date) return 0;
    const start = new Date(t.created_date);
    const end = t.actual_close_date
      ? new Date(t.actual_close_date)
      : new Date();
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Sort tickets. String columns compare A→Z ("-" cells always sink to the
  // bottom in either direction); numeric/date columns compare numerically.
  const sortedTickets = useMemo(() => {
    const sorted = [...filteredTickets];
    const depOf = (t) => dependencies[t.display_id?.replace("TKT-", "")];

    sorted.sort((a, b) => {
      let aVal, bVal;

      switch (sortConfig.key) {
        case "created":
          aVal = new Date(a.created_date || 0).getTime();
          bVal = new Date(b.created_date || 0).getTime();
          break;
        case "closed":
          aVal = new Date(a.actual_close_date || 0).getTime();
          bVal = new Date(b.actual_close_date || 0).getTime();
          break;
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
        case "ticket":
          aVal = parseInt(a.display_id?.replace(/\D/g, ""), 10) || 0;
          bVal = parseInt(b.display_id?.replace(/\D/g, ""), 10) || 0;
          break;
        case "account":
          aVal = a.accountName || "";
          bVal = b.accountName || "";
          break;
        case "region":
          aVal = a.region || "";
          bVal = b.region || "";
          break;
        case "csm":
          aVal = a.csm && a.csm !== "Unknown" ? a.csm.split("@")[0] : "";
          bVal = b.csm && b.csm !== "Unknown" ? b.csm.split("@")[0] : "";
          break;
        case "tam":
          aVal = a.tam && a.tam !== "Unknown" ? a.tam : "";
          bVal = b.tam && b.tam !== "Unknown" ? b.tam : "";
          break;
        case "assignee":
          aVal = FLAT_TEAM_MAP[a.owned_by?.[0]?.display_id] || a.owned_by?.[0]?.display_name || "Unassigned";
          bVal = FLAT_TEAM_MAP[b.owned_by?.[0]?.display_id] || b.owned_by?.[0]?.display_name || "Unassigned";
          break;
        case "depteam":
          aVal = depOf(a)?.primary?.team || "";
          bVal = depOf(b)?.primary?.team || "";
          break;
        case "depassignee":
          aVal = depOf(a)?.primary?.owner || "";
          bVal = depOf(b)?.primary?.owner || "";
          break;
        case "stage":
          aVal = STAGE_MAP[a.stage?.name]?.label || a.stage?.name || "";
          bVal = STAGE_MAP[b.stage?.name]?.label || b.stage?.name || "";
          break;
        default:
          return 0;
      }

      if (typeof aVal === "string") {
        if (!aVal || !bVal) return !aVal && !bVal ? 0 : !aVal ? 1 : -1;
        const cmp = aVal.localeCompare(bVal);
        return sortConfig.direction === "asc" ? cmp : -cmp;
      }
      return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [filteredTickets, sortConfig, dependencies]);

  // Handle sort click — text columns start A→Z, metrics start highest-first
  const TEXT_SORT_KEYS = new Set(["account", "region", "csm", "tam", "assignee", "depteam", "depassignee", "stage"]);
  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key)
        return { key, direction: prev.direction === "desc" ? "asc" : "desc" };
      return { key, direction: TEXT_SORT_KEYS.has(key) ? "asc" : "desc" };
    });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden"
           style={{ boxShadow: 'var(--shadow-premium)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/30">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="btn-icon w-8 h-8 flex items-center justify-center"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="text-[12px] text-slate-500 dark:text-slate-400">Back to Overview</span>
          </div>
          <button
            onClick={onClose}
            className="btn-icon w-8 h-8 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Title & Filters */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800/60">
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white mb-3">
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
                      {DEPENDENCY_TEAMS.map((team) => (
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
                            className={`text-xs px-2 py-0.5 rounded font-medium ${depTeamBadgeClass(team)}`}
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
                <th
                  className="py-3 px-4 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("ticket")}
                >
                  ID / Title
                  <SortIndicator column="ticket" />
                </th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("account")}
                >
                  Account
                  <SortIndicator column="account" />
                </th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("region")}
                >
                  Region
                  <SortIndicator column="region" />
                </th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("csm")}
                >
                  CSM
                  <SortIndicator column="csm" />
                </th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("tam")}
                >
                  TAM
                  <SortIndicator column="tam" />
                </th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("assignee")}
                >
                  Assignee
                  <SortIndicator column="assignee" />
                </th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("depteam")}
                >
                  Dep Team
                  <SortIndicator column="depteam" />
                </th>
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("depassignee")}
                >
                  Dep Assignee
                  <SortIndicator column="depassignee" />
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
                <th
                  className="py-3 px-3 text-left font-semibold cursor-pointer hover:text-indigo-600 select-none"
                  onClick={() => handleSort("stage")}
                >
                  Stage
                  <SortIndicator column="stage" />
                </th>
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
                        return (
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-medium ${depTeamBadgeClass(team)}`}
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

export default DrillDownModal;
