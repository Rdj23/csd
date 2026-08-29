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
import { DEPENDENCY_EXPORT_HEADERS, DEPENDENCY_TEAMS, depTeamBadgeClass, getDependencyExportCells, getTicketDepInfo } from "../../../lib/dependencies";
import { FLAT_TEAM_MAP, TEAM_GROUPS } from "../../../lib/teams";
import { STAGE_MAP } from "../../../lib/ticketStatus";
import { csvTimestamp, downloadCsv } from "../../../lib/csv";
import DrillDownModal from "./TicketDrillDownModal";

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
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden transition-all duration-200 hover:-translate-y-0.5"
         style={{ boxShadow: 'var(--shadow-card)' }}
         onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-elevated)'}
         onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow-card)'}
    >
      {/* State color accent top bar */}
      <div
        className="h-[3px] w-full"
        style={{ backgroundColor: config.color }}
      />

      {/* Header */}
      <button
        onClick={() => onCardClick(state)}
        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-100 dark:border-slate-800/60"
      >
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-lg ${config.bgLight} ${config.bgDark}`}>
            <Icon className={`w-4 h-4 ${config.textLight} ${config.textDark}`} />
          </div>
          <span className="text-[13px] font-semibold text-slate-800 dark:text-white tracking-tight">
            {config.label}
          </span>
        </div>
        <span className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">
          {tickets.length}
        </span>
      </button>

      {/* Pie Chart */}
      <div className="px-4 pt-3 pb-4">
        {tickets.length > 0 ? (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={38}
                  outerRadius={68}
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
          <div className="h-44 flex items-center justify-center text-slate-400">
            <p className="text-sm">No tickets</p>
          </div>
        )}

        {/* Legend */}
        {chartData.length > 0 && (
          <div className="mt-1 space-y-0.5 max-h-44 overflow-y-auto custom-scrollbar">
            {chartData.map((item, idx) => (
              <button
                key={item.name}
                onClick={() => onSliceClick(state, item.name, groupBy)}
                className="w-full flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 px-2 py-1 rounded-md transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                  />
                  <span className="text-slate-600 dark:text-slate-400 truncate max-w-[100px]">
                    {item.name}
                  </span>
                </div>
                <span className="text-slate-400 dark:text-slate-500 font-semibold tabular-nums">
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
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4"
         style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="mb-4">
        <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white tracking-tight">
          {title}
        </h3>
        {subtitle && <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
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
  solvedLoading = false,
}) => {
  const [drillDown, setDrillDown] = useState(null); // { state, assignee?, title }
  const [groupBy, setGroupBy] = useState("gst"); // gst, csm, tam, region

  // Filter out anmol-sawhney tickets from all calculations
  const cleanTickets = useMemo(() => {
    return tickets.filter((t) => {
      const ownerDisplayId = t.owned_by?.[0]?.display_id || "";
      const ownerName =
        FLAT_TEAM_MAP[ownerDisplayId] ||
        t.owned_by?.[0]?.display_name ||
        "";
      return !ownerName.toLowerCase().includes("anmol");
    });
  }, [tickets]);

  // Categorize tickets by state (with dependency filtering)
  const categorizedTickets = useMemo(() => {
    const result = {
      open: [],
      pending: [],
      onhold: [],
      solved: [],
    };

    // Dependency filter settings. Team subset check: any non-full selection
    // narrows — zero teams selected must yield zero dependency tickets.
    const depFilter = filters?.dependency || [];
    const depTeamsFilter = filters?.dependencyTeams;
    const hasDepFilter = depFilter.length > 0 && depFilter.length < 2;
    const hasDepTeamsFilter =
      depFilter.includes("with_dependency") &&
      Array.isArray(depTeamsFilter) &&
      depTeamsFilter.length < DEPENDENCY_TEAMS.length;

    cleanTickets.forEach((t) => {
      // Apply dependency filter first (Mongo snapshot, live-map fallback)
      if (hasDepFilter) {
        const hasDep = getTicketDepInfo(dependencies, t).hasDependency;

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
        const depInfo = getTicketDepInfo(dependencies, t);
        if (depInfo.hasDependency) {
          const hasMatchingTeam = depTeamsFilter.some((team) =>
            depInfo.teams.includes(team),
          );
          if (!hasMatchingTeam) return; // Skip - no matching team
        }
      }

      const stageName = t.stage?.name?.toLowerCase() || "";

      if (
        stageName.includes("solved") ||
        stageName.includes("closed") ||
        stageName.includes("resolved")
      ) {
        // Date filtering already handled by allTicketsFiltered in App.jsx
        result.solved.push(t);
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
    cleanTickets,
    filters?.dependency,
    filters?.dependencyTeams,
    dependencies,
  ]);

  // Account distribution data
  const accountDistribution = useMemo(() => {
    const groups = {};
    cleanTickets.forEach((t) => {
      const account = t.accountName || "Unknown";
      groups[account] = (groups[account] || 0) + 1;
    });

    const total = cleanTickets.length;
    return Object.entries(groups)
      .map(([name, value]) => ({
        name,
        value,
        percentage: total > 0 ? Math.round((value / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [cleanTickets]);

  // Region distribution data (merge India/IN1)
  const regionDistribution = useMemo(() => {
    const groups = {};
    cleanTickets.forEach((t) => {
      let region = t.region || "Unknown";
      // Normalize IN1/In1 to India
      if (region === "IN1" || region === "In1" || region === "in1") {
        region = "India";
      }
      groups[region] = (groups[region] || 0) + 1;
    });

    const total = cleanTickets.length;
    return Object.entries(groups)
      .map(([name, value]) => ({
        name,
        value,
        percentage: total > 0 ? Math.round((value / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [cleanTickets]);

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
      const filtered = cleanTickets.filter((t) => t.accountName === account);
      setDrillDown({
        title: `Tickets for ${account}`,
        tickets: filtered,
      });
    },
    [cleanTickets],
  );

  const handleRegionClick = useCallback(
    (region) => {
      const filtered = cleanTickets.filter((t) => t.region === region);
      setDrillDown({
        title: `Tickets in ${region}`,
        tickets: filtered,
      });
    },
    [cleanTickets],
  );

  // Outer download function - professional report
  const downloadFullReport = useCallback(() => {
    let csvContent = "";
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

    ["open", "pending", "onhold", "solved"].forEach((state) => {
      categorizedTickets[state].forEach((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "Unassigned";
        const csm = t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "-";
        const tam = t.tam && t.tam !== "Unknown" ? t.tam : "-";
        const cf = t.custom_fields || {};

        csvContent +=
          [
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
          ].join(",") + "\n";
      });
    });

    downloadCsv(`All_Tickets_Report_${csvTimestamp()}.csv`, csvContent);
  }, [categorizedTickets, dependencies]);

  return (
    <div className="space-y-5">
      {/* Header with Grouping Tabs */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
            All Tickets Overview
          </h2>
          <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5 flex items-center gap-1.5">
            Click any slice or card to drill down
            {solvedLoading && (
              <span className="inline-flex items-center gap-1 text-indigo-500 dark:text-indigo-400">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Loading solved…
              </span>
            )}
          </p>
        </div>

        {/* Grouping Tab Switcher */}
        <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg border border-slate-200 dark:border-slate-700/60">
          {GROUPING_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = groupBy === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setGroupBy(tab.key)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                <TabIcon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
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
