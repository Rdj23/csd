import React, {
  useMemo,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import {
  format,
  subDays,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  isSameDay,
  parseISO,
  differenceInHours,
  differenceInDays,
} from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  Line,
} from "recharts";
import {
  CheckCircle,
  Maximize2,
  X,
  ArrowUpRight,
  Activity,
  Trophy,
  Users,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  TrendingUp,
  TrendingDown,
  ArchiveRestore,
  Layers,
  AlertCircle,
  ExternalLink,
  Frown,
  Smile,
  Crown,
  Medal,
  Globe,
  ListFilter,
  RefreshCw,
  Zap,
  Eye,
  EyeOff,
  Search,
  Table,
  Download,
  ChevronLeft,
  ChevronRight,
  Edit3,
} from "lucide-react";
import { getCSATStatus, FLAT_TEAM_MAP, TEAM_GROUPS } from "../../../utils";
import { useTicketStore } from "../../../store";
import SmartDateRangePicker from "../../../components/common/SmartDateRangePicker";
import MultiSelectFilter from "../../../components/common/MultiSelectFilter";
import { trackEvent } from "../../../utils/clevertap";
import { authFetch } from "../../../utils/authFetch";

// Import split analytics components
import {
  METRICS,
  OVERVIEW_METRICS,
  CHART_COLORS,
  HIDDEN_USERS,
  SUPER_ADMIN_EMAILS,
  CSATLeaderboard,
  DSATAlerts,
  PerformanceMetricsCards,
  NOCAnalytics,
} from "./analytics";

// Import skeleton loaders for better perceived performance
import {
  PerformanceOverviewSkeleton,
  ChartSkeleton,
  LeaderboardSkeleton,
  LoadingSpinner,
} from "../../../components/ui/SkeletonLoader";

// ============================================================================
// DRILL DOWN MODAL - Shows tickets for a specific data point
// ============================================================================
// ============================================================================
// DRILL DOWN MODAL - Shows tickets for a specific data point
// REPLACE lines ~166-350 in AnalyticsDashboard.jsx
// ============================================================================
const DrillDownModal = ({
  isOpen,
  onClose,
  title,
  tickets,
  metricKey,
  summary,
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
        return t.custom_fields?.tnt__rwt_business_hours || 0;
      case "avgFRT":
        return t.custom_fields?.tnt__frt_hours || 0;
      case "frrPercent":
        return t.custom_fields?.tnt__frr === true ||
          t.custom_fields?.tnt__iteration_count === 1
          ? 1
          : 0;
      case "csat":
        return t.custom_fields?.tnt__csatrating || 0;
      case "avgIterations":
        return t.custom_fields?.tnt__iteration_count || 0;
      case "volume":
        return new Date(t.created_date || 0).getTime();
      case "solved":
        return new Date(t.actual_close_date || t.closed_date || 0).getTime();
      case "backlog":
        // Sort by age
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
        const rwt = t.custom_fields?.tnt__rwt_business_hours;
        return rwt ? `${Number(rwt).toFixed(1)} hrs` : "-";
      case "avgFRT":
        const frt = t.custom_fields?.tnt__frt_hours;
        return frt ? `${Number(frt).toFixed(1)} hrs` : "-";
      case "frrPercent":
        return t.custom_fields?.tnt__frr === true ||
          t.custom_fields?.tnt__iteration_count === 1 ? (
          <span className="text-emerald-600">✓ Yes</span>
        ) : (
          <span className="text-rose-500">✗ No</span>
        );
      case "csat":
        const rating = t.custom_fields?.tnt__csatrating;
        return rating === 2 ? (
          <span className="text-emerald-600">👍 Good</span>
        ) : rating === 1 ? (
          <span className="text-rose-500">👎 Bad</span>
        ) : (
          "-"
        );
      case "avgIterations":
        return t.custom_fields?.tnt__iteration_count || "-";
      case "volume":
        // For incoming volume, show created date
        return t.created_date
          ? format(parseISO(t.created_date), "MMM dd")
          : "-";
      case "solved":
        // For solved tickets, show solved date
        const closedDate = t.actual_close_date || t.closed_date;
        return closedDate ? format(parseISO(closedDate), "MMM dd") : "-";
      case "backlog":
        // For backlog, show age in days
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
      "";
    return (
      t.display_id?.toLowerCase().includes(searchLower) ||
      t.title?.toLowerCase().includes(searchLower) ||
      t.custom_fields?.tnt__instance_account_name
        ?.toLowerCase()
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
          "";
        bVal =
          FLAT_TEAM_MAP[b.owned_by?.[0]?.display_id] ||
          b.owned_by?.[0]?.display_name ||
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
                  {metricKey === "avgRWT" || metricKey === "rwt"
                    ? "RWT"
                    : metricKey === "avgFRT"
                      ? "FRT"
                      : metricKey === "frrPercent"
                        ? "FRR"
                        : metricKey === "csat"
                          ? "CSAT"
                          : metricKey === "avgIterations"
                            ? "Iterations"
                            : metricKey === "volume"
                              ? "Created"
                              : metricKey === "solved"
                                ? "Solved"
                                : metricKey === "backlog"
                                  ? "Age"
                                  : "Value"}
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
                        {t.custom_fields?.tnt__instance_account_name || "-"}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {owner}
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                          {t.stage?.name || "-"}
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
                              "MMM dd, yyyy"
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

const QUARTERS = [
  { id: "Q4_25", label: "Q4 '25" },
  { id: "Q1_26", label: "Q1 '26" },
];

const StatCard = ({ label, value, unit = "", color, isPositive }) => (
  <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800">
    <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
      {label}
    </div>
    <div className="text-2xl font-bold" style={{ color }}>
      {value}
      {unit && (
        <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>
      )}
    </div>
  </div>
);

// ============================================================================
// DATA PROCESSING - CLIENT SIDE FOR CHARTS
// ============================================================================
const processChartData = (tickets, metric, timeRange, subject, currentUser) => {
  if (!tickets || tickets.length === 0) return [];

  const end = new Date();
  const start = subDays(end, timeRange);
  const daysInterval = eachDayOfInterval({ start, end });

  let subjectName = subject === "Me" ? currentUser : subject;
  const isGlobal = subject === "All";
  const isTeam = TEAM_GROUPS[subjectName];

  const ticketsByDate = {};
  const getTicketDate = (t) =>
    metric === "volume" ? t.created_date : t.actual_close_date;

  for (const t of tickets) {
    if (!isGlobal) {
      const owner =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "";
      if (isTeam) {
        const teamMembers = Object.values(TEAM_GROUPS[subjectName]);
        if (!teamMembers.some((m) => owner.includes(m))) continue;
      } else {
        if (!owner.toLowerCase().includes(subjectName?.toLowerCase())) continue;
      }
    }

    const dateRaw = getTicketDate(t);
    if (!dateRaw) continue;
    const dateKey = format(parseISO(dateRaw), "yyyy-MM-dd");

    if (!ticketsByDate[dateKey]) ticketsByDate[dateKey] = [];
    ticketsByDate[dateKey].push(t);
  }

  const getTicketValue = (t) => {
    if (metric === "volume" || metric === "solved") return 1;
    if (metric === "rwt") {
      if (!t.created_date || !t.actual_close_date) return null;
      const diff = differenceInHours(
        parseISO(t.actual_close_date),
        parseISO(t.created_date),
      );
      return diff > 0 ? diff : 0;
    }
    if (metric === "backlog") {
      if (!t.actual_close_date || !t.created_date) return 0;
      const ageInDays = differenceInDays(
        parseISO(t.actual_close_date),
        parseISO(t.created_date),
      );
      return ageInDays > 15 ? 1 : 0;
    }
    return 0;
  };

  return daysInterval.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const dailyTickets = ticketsByDate[dateKey] || [];
    const subjectValues = dailyTickets
      .map(getTicketValue)
      .filter((v) => v !== null);

    let mainVal = 0;
    if (metric === "rwt") {
      mainVal = subjectValues.length
        ? Math.round(
            subjectValues.reduce((a, b) => a + b, 0) / subjectValues.length,
          )
        : 0;
    } else {
      mainVal = subjectValues.reduce((a, b) => a + b, 0);
    }

    return { name: format(day, "MMM dd"), main: mainVal, date: day };
  });
};

// Multi-user data for expanded view
const processMultiUserData = (
  tickets,
  metric,
  timeRange,
  selectedUsers,
  showTeam,
  showGST,
  currentUserTeamName,
) => {
  const end = new Date();
  const start = subDays(end, timeRange);
  const daysInterval = eachDayOfInterval({ start, end });

  const getTicketDate = (t) =>
    metric === "volume" ? t.created_date : t.actual_close_date;
  const getTicketValue = (t) => {
    if (metric === "volume" || metric === "solved") return 1;
    if (metric === "rwt") {
      if (!t.created_date || !t.actual_close_date) return null;
      return Math.max(
        0,
        differenceInHours(
          parseISO(t.actual_close_date),
          parseISO(t.created_date),
        ),
      );
    }
    if (metric === "backlog") {
      if (!t.actual_close_date || !t.created_date) return 0;
      return differenceInDays(
        parseISO(t.actual_close_date),
        parseISO(t.created_date),
      ) > 15
        ? 1
        : 0;
    }
    return 0;
  };

  const teamMembers =
    currentUserTeamName && TEAM_GROUPS[currentUserTeamName]
      ? Object.values(TEAM_GROUPS[currentUserTeamName])
      : [];

  // GST members only
  const gstMembers = Object.values(FLAT_TEAM_MAP);

  return daysInterval.map((day) => {
    const dailyTickets = tickets.filter((t) => {
      const d = getTicketDate(t);
      return d && isSameDay(parseISO(d), day);
    });

    let dataPoint = { name: format(day, "MMM dd"), date: day };

    // Plot selected users
    selectedUsers.forEach((user) => {
      const userTickets = dailyTickets.filter((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        return owner === user;
      });
      const values = userTickets.map(getTicketValue).filter((v) => v !== null);

      if (metric === "rwt") {
        dataPoint[user] = values.length
          ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
          : 0;
      } else {
        dataPoint[user] = values.reduce((a, b) => a + b, 0);
      }
    });

    // Team & GST comparison
    if (showTeam || showGST) {
      const teamTickets = dailyTickets.filter((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        return teamMembers.some((m) => owner.includes(m));
      });

      const gstTickets = dailyTickets.filter((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        return gstMembers.some((m) => owner.includes(m));
      });

      if (showTeam) {
        const teamVals = teamTickets
          .map(getTicketValue)
          .filter((v) => v !== null);
        dataPoint["compare_team"] =
          metric === "rwt" && teamVals.length
            ? Math.round(teamVals.reduce((a, b) => a + b, 0) / teamVals.length)
            : teamVals.reduce((a, b) => a + b, 0);
      }

      if (showGST) {
        const gstVals = gstTickets
          .map(getTicketValue)
          .filter((v) => v !== null);
        dataPoint["compare_gst"] =
          metric === "rwt" && gstVals.length
            ? Math.round(gstVals.reduce((a, b) => a + b, 0) / gstVals.length)
            : gstVals.reduce((a, b) => a + b, 0);
      }
    }

    return dataPoint;
  });
};

// PERFORMANCE METRICS CARDS - Updated with Time Rules & Hover Insights
const ThisWeekStats = ({ tickets, isGSTUser }) => {
  // Calculate week start (Monday 12:00 AM)
  const getWeekStart = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const weekStart = getWeekStart();

  const weekStats = useMemo(() => {
    if (!tickets || tickets.length === 0)
      return { csat: 0, open: 0, solved: 0 };

    const weekTickets = tickets.filter((t) => {
      const createdDate = t.created_date ? new Date(t.created_date) : null;
      return createdDate && createdDate >= weekStart;
    });

    // CSAT count (positive ratings this week)
    const csatCount = weekTickets.filter((t) => {
      const rating = Number(t.custom_fields?.tnt__csatrating);
      return rating === 2; // Good rating
    }).length;

    // Open tickets this week
    const openCount = weekTickets.filter((t) => {
      const stage = t.stage?.name?.toLowerCase() || "";
      return !stage.includes("solved") && !stage.includes("closed");
    }).length;

    // Solved tickets this week
    const solvedCount = weekTickets.filter((t) => {
      const closedDate = t.actual_close_date
        ? new Date(t.actual_close_date)
        : null;
      return closedDate && closedDate >= weekStart;
    }).length;

    return { csat: csatCount, open: openCount, solved: solvedCount };
  }, [tickets, weekStart]);

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
      <span className="text-xs font-medium text-slate-400">This Month</span>
      <div className="flex items-center gap-6">
        <div className="text-center">
          <div className="text-lg font-bold text-emerald-600">
            {weekStats.csat}
          </div>
          <div className="text-[10px] text-slate-400 uppercase">DSAT</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-blue-600">
            {weekStats.open}
          </div>
          <div className="text-[10px] text-slate-400 uppercase">Open</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-indigo-600">
            {weekStats.solved}
          </div>
          <div className="text-[10px] text-slate-400 uppercase">Solved</div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SMART INSIGHTS PANEL
// ============================================================================
const SmartInsights = ({
  data,
  metric,
  showTeam,
  showGST,
  selectedUsers,
  myTeamName,
}) => {
  if (!selectedUsers || selectedUsers.length === 0) {
    return (
      <div className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 mb-6 flex flex-col items-center justify-center text-center">
        <Users className="w-6 h-6 text-indigo-400 mb-3" />
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
          No Assignee Selected
        </h3>
        <p className="text-xs text-slate-500 max-w-xs mt-1">
          Select users from the dropdown to see performance stats.
        </p>
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  const calculateSelectedTotal = (dataset) => {
    return dataset.reduce((acc, day) => {
      let dailySum = 0;
      selectedUsers.forEach((user) => {
        dailySum += day[user] || 0;
      });
      return acc + dailySum;
    }, 0);
  };

  const myTotal = calculateSelectedTotal(data);
  const teamTotal = data.reduce((acc, d) => acc + (d.compare_team || 0), 0);
  const gstTotal = data.reduce((acc, d) => acc + (d.compare_gst || 0), 0);

  const teamSize =
    myTeamName && TEAM_GROUPS[myTeamName?.replace("Team ", "")]
      ? Object.values(TEAM_GROUPS[myTeamName.replace("Team ", "")]).length
      : 5;
  const teamAvg = teamTotal > 0 ? Math.round(teamTotal / teamSize) : 0;

  const gstSize = Object.values(FLAT_TEAM_MAP).length || 20;
  const gstAvg = gstTotal > 0 ? Math.round(gstTotal / gstSize) : 0;

  const mid = Math.floor(data.length / 2);
  const firstHalfTotal = calculateSelectedTotal(data.slice(0, mid));
  const secondHalfTotal = calculateSelectedTotal(data.slice(mid));
  const trendDiff = secondHalfTotal - firstHalfTotal;
  const trendPcent =
    firstHalfTotal > 0 ? Math.round((trendDiff / firstHalfTotal) * 100) : 100;

  const isGroup = selectedUsers.length > 1;
  const subjectLabel = isGroup ? "Group Velocity" : "My Velocity";
  const subjectText = isGroup ? "Selected users" : "You";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-slate-900 border border-indigo-100 dark:border-indigo-500/20 p-4 rounded-2xl shadow-sm relative overflow-hidden">
        <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-1">
          {subjectLabel}
        </h4>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-800 dark:text-white">
            {typeof myTotal === "number"
              ? myTotal % 1 === 0
                ? myTotal
                : myTotal.toFixed(2)
              : myTotal}
          </span>
          <span className="text-xs text-slate-500 font-medium">
            {METRICS[metric]?.desc || "Units"}
          </span>
        </div>
        <div
          className={`text-xs font-bold mt-2 flex items-center gap-1 ${
            trendDiff >= 0 ? "text-emerald-600" : "text-rose-500"
          }`}
        >
          {trendDiff >= 0 ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {Math.abs(trendPcent)}% {trendDiff >= 0 ? "Increase" : "Decrease"}
        </div>
      </div>

      {showTeam ? (
        <div className="bg-gradient-to-br from-violet-50 to-white dark:from-violet-900/20 dark:to-slate-900 border border-violet-100 dark:border-violet-500/20 p-4 rounded-2xl shadow-sm">
          <h4 className="text-xs font-bold text-violet-500 uppercase tracking-wider mb-1">
            Vs {myTeamName || "Team"}
          </h4>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-800 dark:text-white">
              {myTotal - teamAvg > 0
                ? `+${myTotal - teamAvg}`
                : myTotal - teamAvg}
            </span>
            <span className="text-xs text-slate-500 font-medium">
              vs Team Avg
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {subjectText} contributed{" "}
            <strong className="text-violet-600">
              {Math.round((myTotal / (teamTotal || 1)) * 100)}%
            </strong>{" "}
            of team's volume.
          </p>
        </div>
      ) : (
        <div className="border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-center text-xs text-slate-400">
          Select "Vs Team" to see analysis
        </div>
      )}

      {showGST ? (
        <div className="bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/20 dark:to-slate-900 border border-emerald-100 dark:border-emerald-500/20 p-4 rounded-2xl shadow-sm">
          <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-1">
            Vs Global (GST)
          </h4>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-800 dark:text-white">
              {Math.round((myTotal / (gstAvg || 1)) * 100)}%
            </span>
            <span className="text-xs text-slate-500 font-medium">
              of Avg Load
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Global Avg: <strong>{gstAvg}</strong>. {subjectText}{" "}
            {myTotal > gstAvg ? "leading" : "trailing"} by{" "}
            <strong className="text-emerald-600">
              {Math.abs(myTotal - gstAvg)}
            </strong>
            .
          </p>
        </div>
      ) : (
        <div className="border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-center text-xs text-slate-400">
          Select "Vs GST" to see analysis
        </div>
      )}
    </div>
  );
};

// CSATLeaderboard and DSATAlerts are now imported from ./analytics

// ============================================================================
// MAIN DASHBOARD
// ============================================================================
const AnalyticsDashboard = ({
  tickets = [],
  filters = {},
  filterOptions = {},
  onFilterChange,
  dependencies = {},
  filterOwner,
  isDark: propIsDark,
}) => {
  const {
    theme,
    currentUser,
    analyticsData,
    analyticsLoading,
    fetchAnalyticsData,
  } = useTicketStore();
  const [currentQuarter, setCurrentQuarter] = useState("Q1_26");
  const [expandedTimeRange, setExpandedTimeRange] = useState(30);
  const [expandedGroupBy, setExpandedGroupBy] = useState("daily");
  const [expandedAllTrends, setExpandedAllTrends] = useState([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const [expandedOverviewMetric, setExpandedOverviewMetric] = useState(null);

  const [excludeZendesk, setExcludeZendesk] = useState(false);
  const [excludeNOC, setExcludeNOC] = useState(true);

  // Drill-down state
  const [drillDownData, setDrillDownData] = useState(null);

  // Expanded chart date range - syncs with global but can be overridden
  const [expandedDateRange, setExpandedDateRange] = useState(null);

  const effectiveDateRange = useMemo(() => {
    const dateRange = filters?.dateRange;

    console.log("Analytics dateRange filter:", dateRange);

    // Valid date range provided
    if (
      dateRange?.start &&
      dateRange?.end &&
      dateRange.start.length > 0 &&
      dateRange.end.length > 0
    ) {
      try {
        const startDate = parseISO(dateRange.start);
        const endDate = parseISO(dateRange.end);

        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          return {
            start: startDate,
            end: endDate,
            days: differenceInDays(endDate, startDate) + 1,
            isAllTime: false,
          };
        }
      } catch (e) {
        console.error("Error parsing date range:", e);
      }
    }

    // 2. "All Time" - Start from Jan 1, 2026
    if (dateRange && dateRange.start === "" && dateRange.end === "") {
      return {
        start: new Date("2026-01-01"),
        end: new Date(),
        days: 999,
        isAllTime: true,
      };
    }

    // 3. ✅ FIX: Default to Current Quarter Dates (instead of last 30 days)
    // This ensures UI cards show data for the full quarter selected
    const getQuarterDates = (q) => {
      if (q === "Q4_25")
        return { start: new Date("2025-10-01"), end: new Date("2025-12-31") };
      if (q === "Q1_26")
        return { start: new Date("2026-01-01"), end: new Date("2026-03-31") }; // ✅ FIX: Start from Jan 1, 2026
      return { start: subDays(new Date(), 29), end: new Date() };
    };

    const { start, end } = getQuarterDates(currentQuarter);
    return {
      start,
      end,
      days: differenceInDays(end, start) + 1,
      isAllTime: false,
    };
  }, [filters?.dateRange, currentQuarter]);

  // Use global date range for expanded charts unless overridden
  const expandedEffectiveDateRange = useMemo(() => {
    if (expandedDateRange) {
      // Handle "All Time" (empty strings) - Start from Jan 1, 2026
      if (expandedDateRange.start === "" && expandedDateRange.end === "") {
        const allTimeStart = new Date("2026-01-01");
        const allTimeEnd = new Date();
        return {
          start: allTimeStart,
          end: allTimeEnd,
          days: differenceInDays(allTimeEnd, allTimeStart) + 1,
          isAllTime: true,
        };
      }

      // Handle valid date range - PARSE STRINGS TO DATE OBJECTS
      if (
        expandedDateRange.start &&
        expandedDateRange.end &&
        expandedDateRange.start.length > 0 &&
        expandedDateRange.end.length > 0
      ) {
        try {
          const start =
            typeof expandedDateRange.start === "string"
              ? parseISO(expandedDateRange.start)
              : expandedDateRange.start;
          const end =
            typeof expandedDateRange.end === "string"
              ? parseISO(expandedDateRange.end)
              : expandedDateRange.end;

          // Validate parsed dates
          if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            return {
              start,
              end,
              days: differenceInDays(end, start) + 1,
              isAllTime: false,
            };
          }
        } catch (e) {
          console.error("Error parsing expanded date range:", e);
        }
      }
    }
    return effectiveDateRange;
  }, [expandedDateRange, effectiveDateRange]);

  // Fetch analytics data when EXPANDED date range changes
  useEffect(() => {
    if (!expandedOverviewMetric) return; // Only when modal is open

    const range = expandedEffectiveDateRange;
    if (!range?.start || !range?.end) return;

    console.log("Fetching data for expanded modal:", range);

    if (range.isAllTime) {
      fetchAnalyticsData({ quarter: "Q4_25", excludeZendesk, excludeNOC });
      fetchAnalyticsData({ quarter: "Q1_26", excludeZendesk, excludeNOC });
    } else {
      const startYear = range.start.getFullYear();
      const startMonth = range.start.getMonth();
      const endYear = range.end.getFullYear();

    
      // Fetch Q1_26 if date range includes Jan-Mar 2026
      if (endYear === 2026 || (startYear === 2025 && startMonth === 11)) {
        fetchAnalyticsData({ quarter: "Q1_26", excludeZendesk, excludeNOC });
      }
      // If only in Jan 2026
      if (startYear === 2026) {
        fetchAnalyticsData({ quarter: "Q1_26", excludeZendesk, excludeNOC });
      }
    }
  }, [
    expandedEffectiveDateRange,
    expandedOverviewMetric,
    excludeZendesk,
    fetchAnalyticsData,
    excludeNOC,
  ]);

  // 1. Common Filters (Team, Owner, Region, etc.) - applied to ALL tickets first
  const baseFilteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      // Exclude Zendesk if toggle is on
      // Inside AnalyticsDashboard.jsx -> baseFilteredTickets
      if (excludeZendesk) {
        const isZendesk = t.tags?.some(
          (tagObj) => tagObj.tag?.name === "Zendesk import",
        );
        if (isZendesk) return false;
      }

      // Team Filter
      if (filters?.teams?.length > 0) {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
          Object.values(TEAM_GROUPS[teamKey]).includes(owner),
        );
        if (!filters.teams.some((team) => ownerTeams.includes(team)))
          return false;
      }

      // Owner Filter
      if (filters?.owners?.length > 0) {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        if (!filters.owners.includes(owner)) return false;
      }

      // Region Filter
      if (filters?.regions?.length > 0) {
        const region = t.custom_fields?.tnt__region_salesforce || "Unknown";
        if (!filters.regions.includes(region)) return false;
      }

      // Exclude NOC tickets
      if (excludeNOC) {
        const ticketId = t.display_id?.replace("TKT-", "");
        const dep = dependencies[ticketId];
        if (dep?.hasDependency && dep?.issues?.some((i) => i.team === "NOC")) {
          return false;
        }
      }

      return true;
    });
  }, [tickets, filters, excludeZendesk, excludeNOC, dependencies]);

  // 2. Volume Tickets: Strictly CREATED in the date range
  const volumeTickets = useMemo(() => {
    return baseFilteredTickets.filter((t) => {
      if (!t.created_date) return false;
      const created = parseISO(t.created_date);
      return (
        created >= effectiveDateRange.start && created <= effectiveDateRange.end
      );
    });
  }, [baseFilteredTickets, effectiveDateRange]);

  // 3. Solved Tickets: Strictly SOLVED in the date range (ignores created date)
  const solvedTickets = useMemo(() => {
    return baseFilteredTickets.filter((t) => {
      const closedDate = t.actual_close_date || t.closed_date;
      if (!closedDate) return false;
      const closed = parseISO(closedDate);

      // Must be solved in range
      if (closed < effectiveDateRange.start || closed > effectiveDateRange.end)
        return false;

      // Must actually be solved/closed status
      const stage = t.stage?.name?.toLowerCase() || "";
      return (
        stage.includes("solved") ||
        stage.includes("closed") ||
        stage.includes("resolved")
      );
    });
  }, [baseFilteredTickets, effectiveDateRange]);

  const handleDrillDown = useCallback(
    async (metricKey, dateKey, dataPointName, chartData) => {
      // ✅ Add this
      trackEvent("Chart Drill Down", {
        Metric: metricKey,
        Date: dateKey,
      });
      // For VOLUME - use DevRev tickets (has created_date)
      if (metricKey === "volume") {
        const ticketsForDate = volumeTickets.filter((t) => {
          if (!t.created_date) return false;
          return format(parseISO(t.created_date), "yyyy-MM-dd") === dateKey;
        });

        setDrillDownData({
          title: `Incoming Volume - ${dataPointName}`,
          tickets: ticketsForDate,
          metricKey,
          summary: `${ticketsForDate.length} tickets`,
        });
        return;
      }

      // For SOLVED metrics - ALWAYS fetch from MongoDB
      const API_BASE = import.meta.env.VITE_API_URL || "";

      // Build owner filter
      let ownerFilter = [];
      if (filters?.owners?.length > 0) {
        ownerFilter = filters.owners;
      } else if (filters?.teams?.length > 0) {
        filters.teams.forEach((teamKey) => {
          if (TEAM_GROUPS[teamKey]) {
            ownerFilter.push(...Object.values(TEAM_GROUPS[teamKey]));
          }
        });
      }

      // Build query params
      const queryParams = new URLSearchParams({
        date: dateKey,
        owners: ownerFilter.join(","),
        metric: metricKey,
        excludeZendesk: excludeZendesk ? "true" : "false",
        excludeNOC: excludeNOC ? "true" : "false",
      });

      // Add region filter if set
      if (filters?.regions?.length > 0) {
        queryParams.set("region", filters.regions.join(","));
      }

      console.log(
        `🔍 Fetching from MongoDB: /api/tickets/by-date?${queryParams}`,
      );

      try {
        const response = await authFetch(
          `${API_BASE}/api/tickets/by-date?${queryParams}`,
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        let ticketsForDate = data.tickets || [];

        console.log(`   📊 MongoDB returned ${ticketsForDate.length} tickets`);

        let summary = `${ticketsForDate.length} tickets`;

        if (metricKey === "frrPercent" || metricKey === "frr") {
          const frrMetCount = ticketsForDate.filter(
            (t) => t.frr === 1,
          ).length;
          const totalCount = ticketsForDate.length;
          const pct =
            totalCount > 0
              ? Math.round((frrMetCount / totalCount) * 100)
              : 0;
          summary = `FRR Met: ${frrMetCount} of ${totalCount} (${pct}%) | Total: ${ticketsForDate.length} tickets`;
        } else if (metricKey === "csat" || metricKey === "positiveCSAT") {
          const good = ticketsForDate.filter((t) => t.csat === 2).length;
          const bad = ticketsForDate.filter((t) => t.csat === 1).length;
          summary = `Good: ${good} 👍 | Bad: ${bad} 👎 | Total: ${ticketsForDate.length}`;
        } else if (metricKey === "rwt" || metricKey === "avgRWT") {
          const rwtValues = ticketsForDate
            .map((t) => t.rwt)
            .filter((v) => v != null && !isNaN(v));
          const avg =
            rwtValues.length > 0
              ? (
                  rwtValues.reduce((a, b) => a + b, 0) / rwtValues.length
                ).toFixed(1)
              : 0;
          summary = `Avg RWT: ${avg} hrs | ${ticketsForDate.length} tickets`;
        } else if (metricKey === "frt" || metricKey === "avgFRT") {
          const frtValues = ticketsForDate
            .map((t) => t.frt)
            .filter((v) => v != null && !isNaN(v));
          const avg =
            frtValues.length > 0
              ? (
                  frtValues.reduce((a, b) => a + b, 0) / frtValues.length
                ).toFixed(1)
              : 0;
          summary = `Avg FRT: ${avg} hrs | ${ticketsForDate.length} tickets`;
        } else if (
          metricKey === "iterations" ||
          metricKey === "avgIterations"
        ) {
          const iterValues = ticketsForDate
            .map((t) => t.iterations)
            .filter((v) => v != null && !isNaN(v));
          const avg =
            iterValues.length > 0
              ? (
                  iterValues.reduce((a, b) => a + b, 0) / iterValues.length
                ).toFixed(1)
              : 0;
          summary = `Avg Iterations: ${avg} | ${ticketsForDate.length} tickets`;
        }

        // Map MongoDB fields to expected format
        const mappedTickets = ticketsForDate.map((t) => ({
          ...t,
          display_id: t.display_id || t.ticket_id,
          custom_fields: {
            tnt__rwt_business_hours: t.rwt,
            tnt__frt_hours: t.frt,
            tnt__iteration_count: t.iterations,
            tnt__csatrating: t.csat,
            tnt__frr: t.frr === 1,
            tnt__instance_account_name: t.account_name,
            tnt__region_salesforce: t.region,
          },
          stage: { name: "Solved" },
          owned_by: [{ display_name: t.owner }],
          actual_close_date: t.closed_date,
        }));

        setDrillDownData({
          title: `${getMetricLabel(metricKey)} - ${dataPointName}`,
          tickets: mappedTickets,
          metricKey,
          summary,
        });
      } catch (error) {
        console.error("❌ Drill-down fetch error:", error);

        // Show error - don't fall back to cache (it doesn't have old data)
        setDrillDownData({
          title: `${getMetricLabel(metricKey)} - ${dataPointName}`,
          tickets: [],
          metricKey,
          summary: `Error: ${error.message}. Check console for details.`,
        });
      }
    },
    [volumeTickets, filters, excludeZendesk, excludeNOC],
  );

  // Helper function for metric labels
  const getMetricLabel = (metricKey) => {
    const labels = {
      volume: "Incoming Volume",
      solved: "Solved Tickets",
      rwt: "Avg Resolution Time",
      avgRWT: "Avg RWT",
      frt: "Avg First Response",
      avgFRT: "Avg FRT",
      backlog: "Backlog Cleared",
      csat: "CSAT",
      positiveCSAT: "Positive CSAT",
      frrPercent: "FRR Met",
      frr: "FRR Met",
      iterations: "Iterations",
      avgIterations: "Avg Iterations",
    };
    return labels[metricKey] || metricKey;
  };

  const [viewMode, setViewMode] = useState("gst");
  const [expandedMetric, setExpandedMetric] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [showTeam, setShowTeam] = useState(false);
  const [showGST, setShowGST] = useState(false);
  const [timeRange, setTimeRange] = useState(30);
  const [groupBy, setGroupBy] = useState("daily"); // daily, weekly, monthly
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const userDropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target)) {
        setUserDropdownOpen(false);
      }
    };
    if (userDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userDropdownOpen]);

  const isDark = propIsDark !== undefined ? propIsDark : theme === "dark";




  const filteredTrends = useMemo(() => {
    const trends = analyticsData?.trends || [];
    return trends.filter((t) => {
      if (!t.date) return false;
      const trendDate = parseISO(t.date);
      return (
        trendDate >= effectiveDateRange.start &&
        trendDate <= effectiveDateRange.end
      );
    });
  }, [analyticsData, effectiveDateRange]);

  const serverTrends = analyticsData?.trends || [];

  const getExpandedOverviewData = useCallback(
    (metricKey) => {
      if (!filteredTrends.length) return [];

      const dataKeyMap = {
        avgRWT: "avgRWT",
        csat: "positiveCSAT",
        frrPercent: "frrPercent", // ✅ FIX: Use frrPercent instead of frrMet
        avgIterations: "avgIterations",
        avgFRT: "avgFRT",
      };

      const dataKey = dataKeyMap[metricKey] || "solved";

      return filteredTrends.map((t) => ({
        name: format(parseISO(t.date), "MMM dd"),
        date: t.date,
        value: t[dataKey] || 0,
      }));
    },
    [filteredTrends],
  );

  // Resolve current user to GST roster name
  // Resolve current user to GST roster name
  const resolvedCurrentUser = useMemo(() => {
    if (!currentUser?.name) return null;
    const cleanName = currentUser.name.toLowerCase().trim().split(" ")[0]; // Get first name only

    // First try exact match
    const exactMatch = Object.values(FLAT_TEAM_MAP).find(
      (name) => name.toLowerCase() === cleanName,
    );
    if (exactMatch) return exactMatch;

    // Then try partial match, but prefer longer matches to avoid Shreya matching Shreyas
    const matches = Object.values(FLAT_TEAM_MAP).filter(
      (name) =>
        cleanName.includes(name.toLowerCase()) ||
        name.toLowerCase().includes(cleanName),
    );

    // Sort by length descending - longer name = more specific match
    matches.sort((a, b) => b.length - a.length);

    return matches[0] || currentUser.name;
  }, [currentUser]);

  const isGSTUser = useMemo(
    () =>
      resolvedCurrentUser &&
      Object.values(FLAT_TEAM_MAP).includes(resolvedCurrentUser),
    [resolvedCurrentUser],
  );

  const isSuperAdmin = useMemo(() => {
    const email = currentUser?.email?.toLowerCase();
    return email
      ? SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email)
      : false;
  }, [currentUser]);

  const myTeamName = useMemo(() => {
    if (!resolvedCurrentUser) return null;

    const foundTeamKey = Object.keys(TEAM_GROUPS).find((groupKey) => {
      const members = Object.values(TEAM_GROUPS[groupKey]);
      return members.includes(resolvedCurrentUser);
    });

    // IMPORTANT: return null if no team found
    return foundTeamKey ? `Team ${foundTeamKey}` : null;
  }, [resolvedCurrentUser]);

  const selectedUserTeamName = useMemo(() => {
    if (selectedUsers.length === 0) return myTeamName;

    const firstUser = selectedUsers[0];
    const foundTeamKey = Object.keys(TEAM_GROUPS).find((groupKey) => {
      const members = Object.values(TEAM_GROUPS[groupKey]);
      return members.includes(firstUser);
    });

    return foundTeamKey ? `Team ${foundTeamKey}` : myTeamName;
  }, [selectedUsers, myTeamName]);
  // GST-only user list for dropdowns
  const gstUserNames = useMemo(() => Object.values(FLAT_TEAM_MAP).sort(), []);

  const getExpandedChartData = useCallback(
    (metricKey) => {
      // =====================================================
      // When owner/team filter is active, aggregate from individualTrends
      // =====================================================
      const hasOwnerFilters =
        filters?.owners?.length > 0 || filters?.teams?.length > 0;

      if (hasOwnerFilters && analyticsData?.individualTrends) {
        const individualTrends = analyticsData.individualTrends;
        let ownersToInclude = Object.keys(individualTrends);

        // Filter by owners
        if (filters?.owners?.length > 0) {
          ownersToInclude = ownersToInclude.filter((owner) =>
            filters.owners.some((o) => o.toLowerCase() === owner.toLowerCase()),
          );
        }
        // Filter by teams
        if (filters?.teams?.length > 0) {
          ownersToInclude = ownersToInclude.filter((owner) => {
            const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
              Object.values(TEAM_GROUPS[teamKey]).some(
                (m) => m.toLowerCase() === owner.toLowerCase(),
              ),
            );
            return filters.teams.some((team) => ownerTeams.includes(team));
          });
        }

        // Aggregate trends from filtered owners
        const aggregatedByDate = {};
        ownersToInclude.forEach((owner) => {
          const ownerTrends = individualTrends[owner] || [];
          ownerTrends.forEach((day) => {
            if (!aggregatedByDate[day.date]) {
              aggregatedByDate[day.date] = {
                date: day.date,
                solved: 0,
                avgRWT: 0,
                rwtCount: 0,
                avgFRT: 0,
                frtCount: 0,
                avgIterations: 0,
                iterCount: 0,
                positiveCSAT: 0,
                negativeCSAT: 0,
                frrMet: 0,
              };
            }
            const agg = aggregatedByDate[day.date];
            agg.solved += day.solved || 0;
            agg.positiveCSAT += day.positiveCSAT || 0;
            agg.negativeCSAT += day.negativeCSAT || 0;
            agg.frrMet += day.frrMet || 0;
            if (day.avgRWT > 0) {
              agg.avgRWT += day.avgRWT * (day.rwtValidCount || day.solved || 1);
              agg.rwtCount += day.rwtValidCount || day.solved || 1;
            }
            if (day.avgFRT > 0) {
              agg.avgFRT += day.avgFRT * (day.frtValidCount || day.solved || 1);
              agg.frtCount += day.frtValidCount || day.solved || 1;
            }
            if (day.avgIterations > 0) {
              agg.avgIterations +=
                day.avgIterations * (day.iterValidCount || day.solved || 1);
              agg.iterCount += day.iterValidCount || day.solved || 1;
            }
          });
        });

        // Convert to trends array format
        const trends = Object.values(aggregatedByDate).map((agg) => ({
          date: agg.date,
          solved: agg.solved,
          avgRWT: agg.rwtCount > 0 ? agg.avgRWT / agg.rwtCount : 0,
          avgFRT: agg.frtCount > 0 ? agg.avgFRT / agg.frtCount : 0,
          avgIterations:
            agg.iterCount > 0 ? agg.avgIterations / agg.iterCount : 0,
          positiveCSAT: agg.positiveCSAT,
          negativeCSAT: agg.negativeCSAT,
          frrMet: agg.frrMet,
          frrPercent: agg.solved > 0 ? Math.round((agg.frrMet / agg.solved) * 100) : 0,
        }));

        // Continue with existing logic using filtered trends...
        if (!trends.length) return [];

        const start = expandedEffectiveDateRange.start;
        const end = expandedEffectiveDateRange.end;

        const filteredData = trends.filter((t) => {
          if (!t.date) return false;
          const d = parseISO(t.date);
          return d >= start && d <= end;
        });

        const dataKeyMap = {
          avgRWT: "avgRWT",
          csat: "positiveCSAT",
          frrPercent: "frrPercent", // ✅ FIX: Use frrPercent instead of frrMet
          avgIterations: "avgIterations",
          avgFRT: "avgFRT",
        };
        const dataKey = dataKeyMap[metricKey] || "solved";

        if (expandedGroupBy === "daily") {
          return filteredData.map((t) => ({
            name: format(parseISO(t.date), "MMM dd"),
            date: t.date,
            value: t[dataKey] || 0,
            negativeCSAT: t.negativeCSAT || 0,
          }));
        }

        // Weekly/Monthly grouping (same logic as before)
        if (expandedGroupBy === "weekly") {
          const weeks = {};
          filteredData.forEach((t) => {
            // Use ISO week format: RRRR = ISO week-year, II = ISO week number
            const weekKey = format(parseISO(t.date), "RRRR-'W'II");
            if (!weeks[weekKey]) {
              weeks[weekKey] = {
                values: [],
                date: t.date,
                // ✅ FIX: Track raw counts for FRR percentage calculation
                frrMetCount: 0,
                solvedCount: 0,
                csatCount: 0,
              };
            }
            weeks[weekKey].values.push(t[dataKey] || 0);
            weeks[weekKey].frrMetCount += t.frrMet || 0;
            weeks[weekKey].solvedCount += t.solved || 0;
            weeks[weekKey].csatCount += t.positiveCSAT || 0;
          });
          return Object.entries(weeks)
            .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
            .map(([week, data]) => {
              // ✅ FIX: Calculate week date range for tooltip
              const [year, weekPart] = week.split("-W");
              const weekNum = parseInt(weekPart);
              const jan1 = new Date(parseInt(year), 0, 1);
              const jan1Day = jan1.getDay() || 7;
              let daysToMonday = jan1Day <= 4 ? 1 - jan1Day : 8 - jan1Day;
              const week1Monday = new Date(parseInt(year), 0, 1 + daysToMonday);
              const monday = new Date(week1Monday);
              monday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);
              const sunday = new Date(monday);
              sunday.setDate(monday.getDate() + 6);
              const rangeLabel = `${format(monday, "MMM dd")} - ${format(sunday, "MMM dd")}`;

              // ✅ FIX: Calculate proper value - FRR needs special handling
              let value;
              if (["avgRWT", "avgFRT", "avgIterations"].includes(metricKey)) {
                value = data.values.reduce((a, b) => a + b, 0) / data.values.length;
              } else if (metricKey === "frrPercent") {
                // ✅ FIX: Recalculate FRR % from raw counts, NOT sum of percentages
                value = data.solvedCount > 0
                  ? Math.round((data.frrMetCount / data.solvedCount) * 100)
                  : 0;
              } else {
                value = data.values.reduce((a, b) => a + b, 0);
              }

              return {
                name: `Week ${week.split("W")[1]}`,
                range: rangeLabel, // ✅ Add date range for tooltip
                date: week,
                value,
              };
            });
        }

        // Monthly
        const months = {};
        filteredData.forEach((t) => {
          const monthKey = format(parseISO(t.date), "yyyy-MM");
          if (!months[monthKey]) {
            months[monthKey] = {
              values: [],
              date: t.date,
              monthKey,
              // ✅ FIX: Track raw counts for FRR percentage calculation
              frrMetCount: 0,
              solvedCount: 0,
              csatCount: 0,
            };
          }
          months[monthKey].values.push(t[dataKey] || 0);
          months[monthKey].frrMetCount += t.frrMet || 0;
          months[monthKey].solvedCount += t.solved || 0;
          months[monthKey].csatCount += t.positiveCSAT || 0;
        });
        return Object.entries(months)
          .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
          .map(([monthKey, data]) => {
            // ✅ FIX: Calculate proper value - FRR needs special handling
            let value;
            if (["avgRWT", "avgFRT", "avgIterations"].includes(metricKey)) {
              value = data.values.reduce((a, b) => a + b, 0) / data.values.length;
            } else if (metricKey === "frrPercent") {
              // ✅ FIX: Recalculate FRR % from raw counts, NOT sum of percentages
              value = data.solvedCount > 0
                ? Math.round((data.frrMetCount / data.solvedCount) * 100)
                : 0;
            } else {
              value = data.values.reduce((a, b) => a + b, 0);
            }

            return {
              name: format(parseISO(data.date), "MMM yyyy"),
              date: monthKey, // Use month key format (yyyy-MM) for drill-down
              value,
            };
          });
      }

      // Use expandedAllTrends instead of analyticsData?.trends
      const trends =
        expandedAllTrends.length > 0
          ? expandedAllTrends
          : analyticsData?.trends || [];
      if (!trends.length) return [];

      // Use the effective date range (global or overridden)
      const start = expandedEffectiveDateRange.start;
      const end = expandedEffectiveDateRange.end;

      // Filter by date range
      const filteredData = trends.filter((t) => {
        if (!t.date) return false;
        const d = parseISO(t.date);
        return d >= start && d <= end;
      });

      const dataKeyMap = {
        avgRWT: "avgRWT",
        csat: "positiveCSAT",
        frrPercent: "frrPercent", // ✅ FIX: Use frrPercent instead of frrMet
        avgIterations: "avgIterations",
        avgFRT: "avgFRT",
      };
      const dataKey = dataKeyMap[metricKey] || "solved";

      // ✅ IDENTIFY SUM METRICS (CSAT, Volume, Solved)
      // NOTE: frrPercent is NOT a sum metric - it needs special handling (recalculate from counts)
      const isSumMetric = [
        "volume",
        "solved",
        "csat",
        "positiveCSAT",
        "backlog",
      ].includes(metricKey);

      // 1. DAILY VIEW
      if (expandedGroupBy === "daily") {
        return filteredData.map((t) => {
          let value = t[dataKey] || 0;

          // For FRR, calculate percentage: frrMet / solved * 100
          if (metricKey === "frrPercent" && t.solved > 0) {
            value = Math.round((t.frrMet / t.solved) * 100);
          }
          // ✅ FIX: For CSAT, show count (not percentage) to match KPI card
          if (metricKey === "csat") {
            value = t.positiveCSAT || 0;
          }

          return {
            name: format(parseISO(t.date), "MMM dd"),
            date: t.date,
            value,
            // Include raw counts for drill-down
            solved: t.solved,
            frrMet: t.frrMet,
            positiveCSAT: t.positiveCSAT,
            negativeCSAT: t.negativeCSAT || 0,
          };
        });
      }

      if (expandedGroupBy === "weekly") {
        const weeks = {};
        filteredData.forEach((t) => {
          // Use ISO week format: RRRR = ISO week-year, II = ISO week number
          const weekKey = format(parseISO(t.date), "RRRR-'W'II");
          if (!weeks[weekKey]) {
            weeks[weekKey] = {
              values: [],
              date: t.date,
              solvedCounts: [],
              frrMetCounts: [],
              csatCounts: [],
              negativeCSATCount: 0,
            };
          }
          weeks[weekKey].values.push(t[dataKey] || 0);
          weeks[weekKey].solvedCounts.push(t.solved || 0);
          weeks[weekKey].frrMetCounts.push(t.frrMet || 0);
          weeks[weekKey].csatCounts.push(t.positiveCSAT || 0);
          weeks[weekKey].negativeCSATCount += t.negativeCSAT || 0;
        });

        return Object.entries(weeks)
          .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
          .map(([week, data]) => {
            // ✅ FIX: Parse ISO week string (yyyy-Www) and calculate date range
            const [year, weekPart] = week.split("-W");
            const weekNum = parseInt(weekPart);

            // Calculate Monday of this ISO week
            const jan1 = new Date(parseInt(year), 0, 1);
            const jan1Day = jan1.getDay() || 7; // 1=Mon, 7=Sun

            // ISO week 1 is the first week with 4+ days in the new year
            let daysToMonday;
            if (jan1Day <= 4) {
              // Jan 1 is Mon-Thu: Week 1 starts on the Monday of that week
              daysToMonday = 1 - jan1Day;
            } else {
              // Jan 1 is Fri-Sun: Week 1 starts next Monday
              daysToMonday = 8 - jan1Day;
            }

            const week1Monday = new Date(parseInt(year), 0, 1 + daysToMonday);
            const monday = new Date(week1Monday);
            monday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);

            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);

            const rangeLabel = `${format(monday, "MMM dd")} - ${format(sunday, "MMM dd")}`;

            // Fix sum definition
            const sum = data.values.reduce((a, b) => a + b, 0);

           // Calculate proper value based on metric type
            let value;
            if (["avgRWT", "avgFRT", "avgIterations"].includes(metricKey)) {
              // Average metrics
              value = sum / (data.values.length || 1);
            } else if (metricKey === "frrPercent") {
              // FRR percentage: need total frrMet / total solved
              const totalSolved =
                data.solvedCounts?.reduce((a, b) => a + b, 0) || 0;
              const totalFrrMet =
                data.frrMetCounts?.reduce((a, b) => a + b, 0) || 0;
              value =
                totalSolved > 0
                  ? Math.round((totalFrrMet / totalSolved) * 100)
                  : 0;
            } else if (metricKey === "csat") {
              // ✅ FIX: CSAT count (not percentage)
              const totalCSAT =
                data.csatCounts?.reduce((a, b) => a + b, 0) || 0;
              value = totalCSAT;
            } else {
              // Sum metrics (solved, volume, backlog)
              value = sum;
            }

            return {
              name: `Week ${week.split("W")[1]}`,
              range: rangeLabel,
              date: week, // Use week key format (yyyy-Www) for drill-down
              value,
              negativeCSAT: data.negativeCSATCount || 0,
            };
          });
      }

      // 3. MONTHLY VIEW
      if (expandedGroupBy === "monthly") {
        const months = {};
        filteredData.forEach((t) => {
          const monthKey = format(parseISO(t.date), "yyyy-MM");
          if (!months[monthKey]) {
            months[monthKey] = {
              values: [],
              date: t.date,
              // ✅ FIX: Track raw counts for FRR percentage calculation
              solvedCounts: [],
              frrMetCounts: [],
              csatCounts: [],
              negativeCSATCount: 0,
            };
          }
          months[monthKey].values.push(t[dataKey] || 0);
          months[monthKey].solvedCounts.push(t.solved || 0);
          months[monthKey].frrMetCounts.push(t.frrMet || 0);
          months[monthKey].csatCounts.push(t.positiveCSAT || 0);
          months[monthKey].negativeCSATCount += t.negativeCSAT || 0;
        });

        return Object.entries(months)
          .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
          .map(([monthKey, data]) => {
            const sum = data.values.reduce((a, b) => a + b, 0);

            // ✅ FIX: Calculate proper value based on metric type
            let value;
            if (["avgRWT", "avgFRT", "avgIterations"].includes(metricKey)) {
              // Average metrics
              value = sum / (data.values.length || 1);
            } else if (metricKey === "frrPercent") {
              // ✅ FIX: FRR percentage - recalculate from raw counts, NOT sum percentages
              const totalSolved = data.solvedCounts?.reduce((a, b) => a + b, 0) || 0;
              const totalFrrMet = data.frrMetCounts?.reduce((a, b) => a + b, 0) || 0;
              value = totalSolved > 0 ? Math.round((totalFrrMet / totalSolved) * 100) : 0;
            } else if (metricKey === "csat") {
              // CSAT count (not percentage)
              value = data.csatCounts?.reduce((a, b) => a + b, 0) || 0;
            } else {
              // Sum metrics (solved, volume, backlog)
              value = sum;
            }

            return {
              name: format(parseISO(data.date), "MMM yyyy"),
              date: monthKey, // Use month key format (yyyy-MM) for drill-down
              value,
              negativeCSAT: data.negativeCSATCount || 0,
            };
          });
      }

      return [];
    },
    [
      analyticsData?.trends,
      analyticsData?.individualTrends,
      expandedAllTrends,
      expandedEffectiveDateRange,
      expandedGroupBy,
      filters?.owners,
      filters?.teams,
      excludeNOC,
    ],
  );

  // Get average
  const getExpandedAverage = useCallback(
    (metricKey) => {
      const chartData = getExpandedChartData(metricKey);
      if (!chartData.length) return "—";

      const avg =
        chartData.reduce((sum, d) => sum + (d.value || 0), 0) /
        chartData.length;
      return avg.toFixed(2);
    },
    [getExpandedChartData],
  );

  // Get trend (comparing first half vs second half)
  const getExpandedTrend = useCallback(
    (metricKey) => {
      const chartData = getExpandedChartData(metricKey);
      if (chartData.length < 2) return { value: "—", isPositive: true };

      const mid = Math.floor(chartData.length / 2);
      const firstHalf = chartData.slice(0, mid);
      const secondHalf = chartData.slice(mid);

      const firstAvg =
        firstHalf.reduce((s, d) => s + d.value, 0) / firstHalf.length;
      const secondAvg =
        secondHalf.reduce((s, d) => s + d.value, 0) / secondHalf.length;

      if (firstAvg === 0) return { value: "—", isPositive: true };

      const change = (((secondAvg - firstAvg) / firstAvg) * 100).toFixed(1);

      // For RWT/FRT, lower is better
      const lowerIsBetter = ["avgRWT", "avgFRT", "avgIterations"].includes(
        metricKey,
      );
      const isPositive = lowerIsBetter ? change < 0 : change > 0;

      return {
        value: `${change > 0 ? "+" : ""}${change}%`,
        isPositive,
      };
    },
    [getExpandedChartData],
  );

  // Calculate overview metric total for selected users
  const calculateOverviewTotal = useCallback(
    (metricKey) => {
      if (!analyticsData?.individualTrends || selectedUsers.length === 0)
        return "—";

      let total = 0;
      let count = 0;

      selectedUsers.forEach((user) => {
        const userTrends = analyticsData.individualTrends[user] || [];
        userTrends.slice(-timeRange).forEach((day) => {
          if (metricKey === "avgRWT" || metricKey === "avgFRT") {
            total += day.avgRWT || day.avgFRT || 0;
            count++;
          } else if (metricKey === "csat") {
            total += day.positiveCSAT || 0;
          } else {
            total += day.solved || 0;
          }
        });
      });

      if (metricKey === "avgRWT" || metricKey === "avgFRT") {
        return count > 0 ? (total / count).toFixed(2) : "0";
      }
      return total;
    },
    [analyticsData, selectedUsers, timeRange],
  );

  // Calculate team average
  const calculateTeamAverage = useCallback(
    (metricKey) => {
      if (!analyticsData?.individualTrends) return "—";

      const teamMembers = TEAM_GROUPS[myTeamName?.replace("Team ", "")]
        ? Object.values(TEAM_GROUPS[myTeamName.replace("Team ", "")])
        : [];

      let total = 0;
      let count = 0;

      teamMembers.forEach((member) => {
        const memberTrends = analyticsData.individualTrends[member] || [];
        memberTrends.slice(-timeRange).forEach((day) => {
          total += day[OVERVIEW_METRICS[metricKey]?.dataKey] || day.solved || 0;
          count++;
        });
      });

      return count > 0 ? (total / count).toFixed(2) : "0";
    },
    [analyticsData, myTeamName, timeRange],
  );

  // Calculate GST average
  const calculateGSTAverage = useCallback(
    (metricKey) => {
      if (!analyticsData?.individualTrends) return "—";

      let total = 0;
      let count = 0;

      Object.values(analyticsData.individualTrends).forEach((userTrends) => {
        userTrends.slice(-timeRange).forEach((day) => {
          total += day[OVERVIEW_METRICS[metricKey]?.dataKey] || day.solved || 0;
          count++;
        });
      });

      return count > 0 ? (total / count).toFixed(2) : "0";
    },
    [analyticsData, timeRange],
  );

  // Get chart data for overview metric
  const getOverviewChartData = useCallback(
    (metricKey) => {
      if (!analyticsData?.individualTrends) return [];

      const allDates = new Set();
      Object.values(analyticsData.individualTrends).forEach((userTrends) => {
        userTrends.forEach((day) => allDates.add(day.date));
      });

      const sortedDates = Array.from(allDates).sort().slice(-timeRange);
      const dataKey = OVERVIEW_METRICS[metricKey]?.dataKey || "solved";

      return sortedDates.map((date) => {
        const point = {
          name: format(
            parseISO(date),
            groupBy === "monthly" ? "MMM" : "MMM dd",
          ),
          date,
        };

        // Add selected users data
        selectedUsers.forEach((user) => {
          const userDay = (analyticsData.individualTrends[user] || []).find(
            (d) => d.date === date,
          );
          point[user] = userDay?.[dataKey] || userDay?.solved || 0;
        });

        // Add team average
        if (showTeam) {
          const teamMembers = TEAM_GROUPS[myTeamName?.replace("Team ", "")]
            ? Object.values(TEAM_GROUPS[myTeamName.replace("Team ", "")])
            : [];
          let teamTotal = 0;
          teamMembers.forEach((member) => {
            const memberDay = (
              analyticsData.individualTrends[member] || []
            ).find((d) => d.date === date);
            teamTotal += memberDay?.[dataKey] || memberDay?.solved || 0;
          });
          point.team =
            teamMembers.length > 0 ? teamTotal / teamMembers.length : 0;
        }

        // Add GST average
        if (showGST) {
          let gstTotal = 0;
          let gstCount = 0;
          Object.entries(analyticsData.individualTrends).forEach(
            ([user, days]) => {
              const dayData = days.find((d) => d.date === date);
              if (dayData) {
                gstTotal += dayData[dataKey] || dayData.solved || 0;
                gstCount++;
              }
            },
          );
          point.gst = gstCount > 0 ? gstTotal / gstCount : 0;
        }

        return point;
      });
    },
    [
      analyticsData,
      selectedUsers,
      timeRange,
      groupBy,
      showTeam,
      showGST,
      myTeamName,
    ],
  );

  // Initialize selected users with current user if GST
  useEffect(() => {
    if (isGSTUser && resolvedCurrentUser && selectedUsers.length === 0) {
      setSelectedUsers([resolvedCurrentUser]);
    }
  }, [isGSTUser, resolvedCurrentUser]);

  // Fetch server-side analytics with debouncing to prevent constant refreshes
  useEffect(() => {
    // Debounce the fetch to prevent rapid re-fetches on filter changes
    const timeoutId = setTimeout(() => {
      fetchAnalyticsData({
        quarter: currentQuarter,
        excludeZendesk,
        excludeNOC,
        owner: filterOwner !== "All" ? filterOwner : null,
        groupBy,
      });
    }, 150); // 150ms debounce

    return () => clearTimeout(timeoutId);
    // Note: fetchAnalyticsData is stable from Zustand store, but we omit it to prevent potential loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentQuarter,
    excludeZendesk,
    excludeNOC,
    filterOwner,
    groupBy,
  ]);
  // Fetch expanded trends only when modal is open, with debouncing
  useEffect(() => {
    if (!expandedOverviewMetric) return;

    const fetchAllTrends = async () => {
      setExpandedLoading(true);
      try {
        const API_BASE = import.meta.env.VITE_API_URL || "";

        // Build params with filters
        const buildParams = (quarter) => {
          const params = new URLSearchParams({ quarter });
          if (excludeZendesk) params.set("excludeZendesk", "true");
          if (excludeNOC) params.set("excludeNOC", "true");
          // Add owner filter if teams selected
          if (filters?.teams?.length > 0) {
            const teamMembers = [];
            filters.teams.forEach((teamKey) => {
              if (TEAM_GROUPS[teamKey]) {
                teamMembers.push(...Object.values(TEAM_GROUPS[teamKey]));
              }
            });
            if (teamMembers.length > 0) {
              params.set("owners", teamMembers.join(","));
            }
          }
          if (filters?.owners?.length > 0) {
            params.set("owners", filters.owners.join(","));
          }
          return params.toString();
        };

        const [q4Res, q1Res] = await Promise.all([
          authFetch(
            `${API_BASE}/api/tickets/analytics?${buildParams("Q4_25")}`,
          ).then((r) => r.json()),
          authFetch(
            `${API_BASE}/api/tickets/analytics?${buildParams("Q1_26")}`,
          ).then((r) => r.json()),
        ]);

        // Combine trends from both quarters
        const allTrends = [...(q4Res.trends || []), ...(q1Res.trends || [])];

        // Sort by date
        allTrends.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Remove duplicates (by date)
        const uniqueTrends = allTrends.filter(
          (t, i, arr) => i === 0 || t.date !== arr[i - 1].date,
        );

        setExpandedAllTrends(uniqueTrends);
      } catch (e) {
        console.error("Failed to fetch expanded data:", e);
      } finally {
        setExpandedLoading(false);
      }
    };

    // Debounce to prevent rapid re-fetches
    const timeoutId = setTimeout(fetchAllTrends, 200);
    return () => clearTimeout(timeoutId);
  }, [
    expandedOverviewMetric,
    excludeZendesk,
    filters?.teams,
    filters?.owners,
    excludeNOC,
    currentQuarter,
  ]);

  const handleQuarterChange = useCallback(
    (quarter) => {
      // ✅ FIX: Clear stale data when quarter changes
      setExpandedAllTrends([]);
      setExpandedDateRange(null);
      setCurrentQuarter(quarter);
    },
    [],
  );
  const handleRefresh = () =>
    fetchAnalyticsData({
      quarter: currentQuarter,
      excludeZendesk,
      excludeNOC,
      forceRefresh: true,
    });

  const smallChartData = useMemo(() => {
    const daysInterval = eachDayOfInterval({
      start: effectiveDateRange.start,
      end: effectiveDateRange.end,
    });

    // Volume: Use DevRev cache (has all created dates)
    const volumeData = daysInterval.map((day) => {
      const dateKey = format(day, "yyyy-MM-dd");
      const dayTickets = volumeTickets.filter((t) => {
        if (!t.created_date) return false;
        return format(parseISO(t.created_date), "yyyy-MM-dd") === dateKey;
      });
      return {
        name: format(day, "MMM dd"),
        date: dateKey,
        main: dayTickets.length,
        tickets: dayTickets,
      };
    });

    // For Solved/RWT/Backlog: Use MongoDB individualTrends (filtered by owner/team)
    const individualTrends = analyticsData?.individualTrends || {};

    // Determine which owners to include based on filters
    let ownersToInclude = Object.keys(individualTrends);

    // Filter Owners (case-insensitive)
    if (filters?.owners?.length > 0) {
      const lowerFilters = filters.owners.map((o) => o.toLowerCase());
      ownersToInclude = ownersToInclude.filter((owner) =>
        lowerFilters.includes(owner.toLowerCase()),
      );
    }

    if (filters?.teams?.length > 0) {
      ownersToInclude = ownersToInclude.filter((owner) => {
        const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
          Object.values(TEAM_GROUPS[teamKey]).includes(owner),
        );
        return filters.teams.some((team) => ownerTeams.includes(team));
      });
    }

    // Build aggregated data per day
    const dailyAggregates = {};

    ownersToInclude.forEach((owner) => {
      const ownerTrends = individualTrends[owner] || [];

      ownerTrends.forEach((day) => {
        if (!day.date) return;

        if (!dailyAggregates[day.date]) {
          dailyAggregates[day.date] = {
            solved: 0,
            totalRWT: 0,
            rwtCount: 0,
            backlogCleared: 0,
          };
        }

        dailyAggregates[day.date].solved += day.solved || 0;
        if (day.avgRWT && day.solved) {
          dailyAggregates[day.date].totalRWT += day.avgRWT * day.solved;
          dailyAggregates[day.date].rwtCount += day.solved;
        }
        dailyAggregates[day.date].backlogCleared += day.backlogCleared || 0;
      });
    });

    // Solved: From aggregated individualTrends
    const solvedData = daysInterval.map((day) => {
      const dateKey = format(day, "yyyy-MM-dd");
      const dayAgg = dailyAggregates[dateKey];
      return {
        name: format(day, "MMM dd"),
        date: dateKey,
        main: dayAgg?.solved || 0,
        tickets: [], // Will be fetched on drill-down from MongoDB
      };
    });

    // RWT: Average from aggregated individualTrends
    const rwtData = daysInterval.map((day) => {
      const dateKey = format(day, "yyyy-MM-dd");
      const dayAgg = dailyAggregates[dateKey];
      const avgRWT =
        dayAgg?.rwtCount > 0 ? dayAgg.totalRWT / dayAgg.rwtCount : 0;
      return {
        name: format(day, "MMM dd"),
        date: dateKey,
        main: Number(avgRWT.toFixed(1)),
        tickets: [],
      };
    });

    // Backlog: From aggregated individualTrends
    const backlogData = daysInterval.map((day) => {
      const dateKey = format(day, "yyyy-MM-dd");
      const dayAgg = dailyAggregates[dateKey];
      return {
        name: format(day, "MMM dd"),
        date: dateKey,
        main: dayAgg?.backlogCleared || 0,
        tickets: [],
      };
    });

    return {
      volume: volumeData,
      solved: solvedData,
      rwt: rwtData,
      backlog: backlogData,
    };
  }, [volumeTickets, effectiveDateRange, analyticsData, filters, excludeNOC]);

  const filteredStats = useMemo(() => {
    // =====================================================
    // EXCLUDE NOC: Filter solvedTickets if excludeNOC is ON
    // =====================================================
    let effectiveSolvedTickets = solvedTickets;
    if (excludeNOC) {
      // For DevRev tickets, check dependencies
      effectiveSolvedTickets = solvedTickets.filter((t) => {
        const ticketId = t.display_id?.replace("TKT-", "");
        const dep = dependencies[ticketId];
        // Exclude if has NOC dependency
        return !(
          dep?.hasDependency && dep?.issues?.some((i) => i.team === "NOC")
        );
      });
    }

    // =================================================================================
    // SCENARIO 0: REGION FILTER APPLIED - Must use DevRev data (MongoDB doesn't have region per trend)
    // =================================================================================
    if (filters?.regions?.length > 0) {
      // When region filter is active, calculate from solvedTickets (already filtered by region in baseFilteredTickets)
      let filteredSolved = effectiveSolvedTickets;

      // Also apply owner/team filter if present
      if (filters?.owners?.length > 0) {
        filteredSolved = filteredSolved.filter((t) => {
          const ownerName = t.owned_by?.[0]?.display_name;
          return filters.owners.some(
            (o) =>
              o.toLowerCase() === ownerName?.toLowerCase() ||
              ownerName?.toLowerCase().includes(o.toLowerCase()),
          );
        });
      }
      if (filters?.teams?.length > 0) {
        filteredSolved = filteredSolved.filter((t) => {
          const ownerName = t.owned_by?.[0]?.display_name;
          const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
            Object.values(TEAM_GROUPS[teamKey]).some(
              (m) =>
                m.toLowerCase() === ownerName?.toLowerCase() ||
                ownerName?.toLowerCase().includes(m.toLowerCase()),
            ),
          );
          return filters.teams.some((team) => ownerTeams.includes(team));
        });
      }

      const totalSolved = filteredSolved.length;
      const rwtValues = filteredSolved
        .map((t) => t.custom_fields?.tnt__rwt_business_hours)
        .filter((v) => v > 0);
      const frtValues = filteredSolved
        .map((t) => t.custom_fields?.tnt__frt_hours)
        .filter((v) => v > 0);
      const iterValues = filteredSolved
        .map((t) => t.custom_fields?.tnt__iteration_count)
        .filter((v) => v > 0);
      const positiveCSAT = filteredSolved.filter(
        (t) => Number(t.custom_fields?.tnt__csatrating) === 2,
      ).length;
      const negativeCSAT = filteredSolved.filter(
        (t) => Number(t.custom_fields?.tnt__csatrating) === 1,
      ).length;
      const frrMet = filteredSolved.filter(
        (t) =>
          t.custom_fields?.tnt__frr === true ||
          t.custom_fields?.tnt__iteration_count === 1,
      ).length;

      return {
        totalTickets: totalSolved, // Use solved count for Performance Overview
        totalSolved,
        avgRWT:
          rwtValues.length > 0
            ? (rwtValues.reduce((a, b) => a + b, 0) / rwtValues.length).toFixed(
                2,
              )
            : "0.00",
        avgFRT:
          frtValues.length > 0
            ? (frtValues.reduce((a, b) => a + b, 0) / frtValues.length).toFixed(
                2,
              )
            : "0.00",
        avgIterations:
          iterValues.length > 0
            ? (
                iterValues.reduce((a, b) => a + b, 0) / iterValues.length
              ).toFixed(1)
            : "0.0",
        positiveCSAT,
        negativeCSAT,
        csatPercent:
          positiveCSAT + negativeCSAT > 0
            ? Math.round((positiveCSAT / (positiveCSAT + negativeCSAT)) * 100)
            : 0,
        frrPercent:
          totalSolved > 0 ? Math.round((frrMet / totalSolved) * 100) : 0,
        _source: "devrev_region_filtered",
      };
    }

    // =================================================================================
    // SCENARIO 1: SPECIFIC FILTERS APPLIED (Calculated from Individual Trends)
    // =================================================================================
    const hasOwnerFilters =
      filters?.owners?.length > 0 || filters?.teams?.length > 0;

    if (hasOwnerFilters) {
      const individualTrends = analyticsData?.individualTrends || {};
      let ownersToInclude = Object.keys(individualTrends);

      // Filter Owners
      if (filters?.owners?.length > 0) {
        ownersToInclude = ownersToInclude.filter((owner) =>
          filters.owners.includes(owner),
        );
      }
      // Filter Teams
      if (filters?.teams?.length > 0) {
        ownersToInclude = ownersToInclude.filter((owner) => {
          const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
            Object.values(TEAM_GROUPS[teamKey]).includes(owner),
          );
          return filters.teams.some((team) => ownerTeams.includes(team));
        });
      }

      console.log("🔍 FILTER DEBUG:", {
        selectedTeams: filters?.teams,
        allOwnersInMongo: Object.keys(individualTrends),
        ownersAfterFilter: ownersToInclude,
        teamGroupsKeys: Object.keys(TEAM_GROUPS),
        dateRange: {
          start: effectiveDateRange.start,
          end: effectiveDateRange.end,
        },
      });

      let totalSolved = 0;
      let weightedRWT = 0,
        validRWTCount = 0;
      let weightedFRT = 0,
        validFRTCount = 0;
      let weightedIter = 0,
        validIterCount = 0;
      let positiveCSAT = 0;
      let negativeCSAT = 0;
      let frrMet = 0;

      ownersToInclude.forEach((owner) => {
        const ownerTrends = individualTrends[owner] || [];
        ownerTrends.forEach((day) => {
          if (!day.date) return;
          const dayDate = parseISO(day.date);
          if (
            dayDate < effectiveDateRange.start ||
            dayDate > effectiveDateRange.end
          )
            return;

          totalSolved += day.solved || 0;
          positiveCSAT += day.positiveCSAT || 0;
          negativeCSAT += day.negativeCSAT || 0;
          frrMet += day.frrMet || 0;

          // Weighted Averages
          if (day.avgRWT > 0 && day.rwtValidCount > 0) {
            weightedRWT += day.avgRWT * day.rwtValidCount;
            validRWTCount += day.rwtValidCount;
          }
          if (day.avgFRT > 0 && day.frtValidCount > 0) {
            weightedFRT += day.avgFRT * day.frtValidCount;
            validFRTCount += day.frtValidCount;
          }
          if (day.avgIterations > 0 && day.iterValidCount > 0) {
            weightedIter += day.avgIterations * day.iterValidCount;
            validIterCount += day.iterValidCount;
          }
        });
      });

      return {
        totalTickets: totalSolved, // Use solved count for Performance Overview
        totalSolved,
        avgRWT:
          validRWTCount > 0 ? (weightedRWT / validRWTCount).toFixed(2) : "0.00",
        avgFRT:
          validFRTCount > 0 ? (weightedFRT / validFRTCount).toFixed(2) : "0.00",
        avgIterations:
          validIterCount > 0
            ? (weightedIter / validIterCount).toFixed(1)
            : "0.0",
        positiveCSAT,
        negativeCSAT,
        csatPercent: (() => {
          // Use accumulated values, fall back to backend stats if trends lack negativeCSAT
          const effectiveNeg = negativeCSAT > 0 ? negativeCSAT : (analyticsData?.stats?.negativeCSAT || 0);
          const effectivePos = positiveCSAT > 0 ? positiveCSAT : (analyticsData?.stats?.positiveCSAT || 0);
          if (effectivePos + effectiveNeg > 0) {
            return Math.round((effectivePos / (effectivePos + effectiveNeg)) * 100);
          }
          return analyticsData?.stats?.csatPercent || 0;
        })(),
        frrPercent:
          totalSolved > 0 ? Math.round((frrMet / totalSolved) * 100) : 0,
      };
    }

    // =================================================================================
    // SCENARIO 2: NO FILTERS (Global Trends)
    // =================================================================================
    const globalTrends = analyticsData?.trends || [];

    let totalSolved = 0;
    let positiveCSAT = 0;
    let negativeCSAT = 0;
    let frrMet = 0;

    // Variables for Global Calculation
    let weightedRWT = 0,
      rwtCount = 0;
    let weightedFRT = 0,
      frtCount = 0;
    let weightedIter = 0,
      iterCount = 0;

    globalTrends.forEach((day) => {
      if (!day.date) return;
      const dayDate = parseISO(day.date);
      // STRICTLY RESPECT DATE RANGE
      if (
        dayDate < effectiveDateRange.start ||
        dayDate > effectiveDateRange.end
      )
        return;

      totalSolved += day.solved || 0;
      positiveCSAT += day.positiveCSAT || 0;
      negativeCSAT += day.negativeCSAT || 0;
      frrMet += day.frrMet || 0;

      if (day.avgRWT > 0) {
        weightedRWT += day.avgRWT * day.solved;
        rwtCount += day.solved;
      }
      if (day.avgFRT > 0) {
        weightedFRT += day.avgFRT * day.solved;
        frtCount += day.solved;
      }
      if (day.avgIterations > 0) {
        weightedIter += day.avgIterations * day.solved;
        iterCount += day.solved;
      }
    });

    // ✅ FIX: Use 'rwtCount' here (NOT totalValidRWT which is undefined in this block)
    const avgRWT = rwtCount > 0 ? (weightedRWT / rwtCount).toFixed(2) : "0.00";
    const avgFRT = frtCount > 0 ? (weightedFRT / frtCount).toFixed(2) : "0.00";
    const avgIterations =
      iterCount > 0 ? (weightedIter / iterCount).toFixed(1) : "0.0";

    // ✅ FIX: FRR Percent calculation
    const frrPercent =
      totalSolved > 0 ? Math.round((frrMet / totalSolved) * 100) : 0;

    return {
      totalTickets: totalSolved, // Use solved count for Performance Overview
      totalSolved,
      avgRWT,
      avgFRT,
      avgIterations,
      positiveCSAT,
      negativeCSAT,
      csatPercent: (() => {
        // Use trend-accumulated negativeCSAT if available, otherwise fall back to backend stats
        const effectiveNeg = negativeCSAT > 0 ? negativeCSAT : (analyticsData?.stats?.negativeCSAT || 0);
        const effectivePos = positiveCSAT > 0 ? positiveCSAT : (analyticsData?.stats?.positiveCSAT || 0);
        // Also use backend-computed csatPercent as ultimate fallback
        if (effectivePos + effectiveNeg > 0) {
          return Math.round((effectivePos / (effectivePos + effectiveNeg)) * 100);
        }
        return analyticsData?.stats?.csatPercent || 0;
      })(),
      frrPercent,
      frrMet,
      _source: "mongodb_global_calc",
    };
  }, [
    analyticsData,
    volumeTickets,
    solvedTickets,
    filters,
    effectiveDateRange,
    excludeNOC,
    dependencies,
  ]);

  // Helper: determine if a metric should be summed or averaged when grouping
  const isAverageMetric = (metric) =>
    ["rwt", "avgRWT", "avgFRT", "avgIterations", "frrPercent"].includes(metric);

  // Helper: aggregate daily data points into weekly/monthly buckets
  const aggregateData = useCallback((dailyData, groupMode, metric, users) => {
    if (groupMode === "daily" || !dailyData.length) return dailyData;

    const buckets = new Map();
    const useAvg = isAverageMetric(metric);

    dailyData.forEach((point) => {
      const d = parseISO(point.date);
      let bucketKey, bucketLabel;

      if (groupMode === "weekly") {
        const weekStart = startOfWeek(d, { weekStartsOn: 1 });
        bucketKey = format(weekStart, "yyyy-MM-dd");
        const weekEnd = endOfWeek(d, { weekStartsOn: 1 });
        bucketLabel = `${format(weekStart, "MMM dd")} - ${format(weekEnd, "MMM dd")}`;
      } else {
        bucketKey = format(d, "yyyy-MM");
        bucketLabel = format(d, "MMM yyyy");
      }

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, { name: bucketLabel, date: bucketKey, _count: 0 });
      }
      const bucket = buckets.get(bucketKey);
      bucket._count += 1;

      // Aggregate user values
      users.forEach((user) => {
        bucket[user] = (bucket[user] || 0) + (point[user] || 0);
      });
      // Aggregate team/GST
      if (point.compare_team !== undefined) {
        bucket.compare_team = (bucket.compare_team || 0) + (point.compare_team || 0);
      }
      if (point.compare_gst !== undefined) {
        bucket.compare_gst = (bucket.compare_gst || 0) + (point.compare_gst || 0);
      }
    });

    // For average metrics, divide sums by count
    if (useAvg) {
      buckets.forEach((bucket) => {
        const count = bucket._count || 1;
        users.forEach((user) => {
          bucket[user] = Number(((bucket[user] || 0) / count).toFixed(2));
        });
        if (bucket.compare_team !== undefined) {
          bucket.compare_team = Number((bucket.compare_team / count).toFixed(2));
        }
        if (bucket.compare_gst !== undefined) {
          bucket.compare_gst = Number((bucket.compare_gst / count).toFixed(2));
        }
      });
    }

    return Array.from(buckets.values()).map(({ _count, ...rest }) => rest);
  }, []);

  // Expanded chart data
  const expandedData = useMemo(() => {
    if (!expandedMetric) return [];

    const individualTrends = analyticsData?.individualTrends || {};
    const rangeToUse = expandedEffectiveDateRange || effectiveDateRange;
    let dailyData = [];

    // For VOLUME - use real-time tickets with created_date
    if (expandedMetric === "volume") {
      const daysInterval = eachDayOfInterval({
        start: rangeToUse.start,
        end: rangeToUse.end,
      });

      dailyData = daysInterval.map((day) => {
        const dateKey = format(day, "yyyy-MM-dd");
        const dataPoint = { name: format(day, "MMM dd"), date: dateKey };

        selectedUsers.forEach((user) => {
          const userTickets = tickets.filter((t) => {
            if (!t.created_date) return false;
            const ticketDate = format(parseISO(t.created_date), "yyyy-MM-dd");
            const owner =
              FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
              t.owned_by?.[0]?.display_name ||
              "";
            return ticketDate === dateKey && owner === user;
          });
          dataPoint[user] = userTickets.length;
        });

        // Team & GST totals for volume
        if (showTeam || showGST) {
          const dayTickets = tickets.filter((t) => {
            if (!t.created_date) return false;
            return format(parseISO(t.created_date), "yyyy-MM-dd") === dateKey;
          });

          if (showTeam) {
            const teamMembers = TEAM_GROUPS[
              selectedUserTeamName?.replace("Team ", "")
            ]
              ? Object.values(
                  TEAM_GROUPS[selectedUserTeamName.replace("Team ", "")],
                )
              : [];
            dataPoint.compare_team = dayTickets.filter((t) => {
              const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "";
              return teamMembers.includes(owner);
            }).length;
          }

          if (showGST) {
            const gstMembers = Object.values(FLAT_TEAM_MAP);
            dataPoint.compare_gst = dayTickets.filter((t) => {
              const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "";
              return gstMembers.includes(owner);
            }).length;
          }
        }

        return dataPoint;
      });
    } else {
      // For SOLVED, RWT, BACKLOG, etc. - use server individualTrends
      const allDates = new Set();
      selectedUsers.forEach((user) => {
        (individualTrends[user] || []).forEach((d) => allDates.add(d.date));
      });

      // Filter dates to be within effectiveDateRange
      const sortedDates = Array.from(allDates)
        .sort()
        .filter((date) => {
          const d = parseISO(date);
          return d >= rangeToUse.start && d <= rangeToUse.end;
        });

      dailyData = sortedDates.map((date) => {
        const dataPoint = { name: format(parseISO(date), "MMM dd"), date };

        selectedUsers.forEach((user) => {
          const userDay = (individualTrends[user] || []).find(
            (d) => d.date === date,
          );
          if (expandedMetric === "solved") {
            dataPoint[user] = userDay?.solved || 0;
          } else if (expandedMetric === "rwt" || expandedMetric === "avgRWT") {
            dataPoint[user] = userDay?.avgRWT
              ? Number(userDay.avgRWT.toFixed(2))
              : 0;
          } else if (expandedMetric === "backlog") {
            dataPoint[user] = userDay?.backlogCleared || 0;
          } else if (expandedMetric === "frrPercent") {
            dataPoint[user] = userDay?.frrPercent || 0;
          } else if (expandedMetric === "csat") {
            dataPoint[user] = userDay?.positiveCSAT || 0;
          } else if (expandedMetric === "avgFRT") {
            dataPoint[user] = userDay?.avgFRT
              ? Number(userDay.avgFRT.toFixed(2))
              : 0;
          } else if (expandedMetric === "avgIterations") {
            dataPoint[user] = userDay?.avgIterations
              ? Number(userDay.avgIterations.toFixed(1))
              : 0;
          }
        });

        // Team & GST totals
        if (showTeam || showGST) {
          let teamTotal = 0,
            gstTotal = 0;
          const teamMembers = TEAM_GROUPS[
            selectedUserTeamName?.replace("Team ", "")
          ]
            ? Object.values(
                TEAM_GROUPS[selectedUserTeamName.replace("Team ", "")],
              )
            : [];

          Object.entries(individualTrends).forEach(([user, days]) => {
            const dayData = days.find((d) => d.date === date);
            if (dayData) {
              const val =
                expandedMetric === "solved"
                  ? dayData.solved
                  : expandedMetric === "rwt" || expandedMetric === "avgRWT"
                    ? dayData.avgRWT
                    : expandedMetric === "backlog"
                      ? dayData.backlogCleared
                      : expandedMetric === "frrPercent"
                        ? dayData.frrPercent
                        : expandedMetric === "csat"
                          ? dayData.positiveCSAT
                          : expandedMetric === "avgFRT"
                            ? dayData.avgFRT
                            : expandedMetric === "avgIterations"
                              ? dayData.avgIterations
                              : 0;
              gstTotal += val || 0;
              if (teamMembers.includes(user)) {
                teamTotal += val || 0;
              }
            }
          });

          if (showTeam) dataPoint.compare_team = teamTotal;
          if (showGST) dataPoint.compare_gst = gstTotal;
        }

        return dataPoint;
      });
    }

    // Apply weekly/monthly grouping
    return aggregateData(dailyData, expandedGroupBy, expandedMetric, selectedUsers);
  }, [
    analyticsData,
    expandedMetric,
    selectedUsers,
    showTeam,
    showGST,
    selectedUserTeamName,
    tickets,
    effectiveDateRange,
    expandedEffectiveDateRange,
    expandedGroupBy,
    aggregateData,
  ]);

  const colors = {
    grid: isDark ? "#1e293b" : "#f1f5f9",
    text: isDark ? "#94a3b8" : "#64748b",
    tooltipBg: isDark ? "#0f172a" : "#ffffff",
  };

  return (
    <div className="space-y-6 p-6 max-w-[1600px] mx-auto">
      {/* GST/Global Toggle - ONLY FOR SUPER ADMIN */}
      {isSuperAdmin && (
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setViewMode("gst")}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
                viewMode === "gst"
                  ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <Users className="w-4 h-4" /> GST View
            </button>
            <button
              onClick={() => setViewMode("global")}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
                viewMode === "global"
                  ? "bg-white dark:bg-slate-700 text-emerald-600 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <Globe className="w-4 h-4" /> Global View
            </button>

          </div>
        </div>
      )}

      {/* Show skeleton while loading, actual cards when data is ready */}
      {analyticsLoading && !analyticsData ? (
        <PerformanceOverviewSkeleton />
      ) : (
        <PerformanceMetricsCards
          stats={filteredStats}
          trends={filteredTrends}
          currentQuarter={currentQuarter}
          currentGroupBy={groupBy}
          onQuarterChange={handleQuarterChange}
          excludeZendesk={excludeZendesk}
          onExcludeZendeskChange={() => setExcludeZendesk(!excludeZendesk)}
          excludeNOC={excludeNOC}
          onExcludeNOCChange={() => setExcludeNOC(!excludeNOC)}
          onRefresh={handleRefresh}
          isRefreshing={analyticsLoading}
          onExpandMetric={(metricKey) => {
            trackEvent("Metric Expanded", { Metric: metricKey }); // ✅ Add this
            setExpandedOverviewMetric(metricKey);
          }}
          onGroupByChange={(newGroupBy) => {
            setGroupBy(newGroupBy);
            // If it's a week selection like "Q1_26_W1", set quarter accordingly
            if (
              newGroupBy.startsWith("Q1_26_W") ||
              newGroupBy.startsWith("Q1_26_M")
            ) {
              setCurrentQuarter("Q1_26");
            }
            fetchAnalyticsData({
              quarter: newGroupBy.startsWith("Q1_26")
                ? newGroupBy
                : currentQuarter,
              excludeZendesk,
              owner: filterOwner !== "All" ? filterOwner : null,
              groupBy: newGroupBy,
            });
          }}
          isLoading={analyticsLoading}
        />
      )}

      {/* 4 METRIC CHARTS */}
      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-8 mb-4 flex items-center gap-2 animate-fade-in">
        <Activity className="w-5 h-5 text-indigo-500" /> Performance Analytics
      </h2>

      {analyticsLoading && !analyticsData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <ChartSkeleton key={i} height="200px" />
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(METRICS).map(([key, config], index) => (
          <div
            key={key}
            className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 relative group hover:border-indigo-500/30 hover:shadow-lg transition-all duration-300 animate-slide-up"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                  <config.icon
                    className="w-4 h-4"
                    style={{ color: config.color }}
                  />{" "}
                  {config.label}
                </h3>
                <p className="text-xs text-slate-500">{config.desc}</p>
              </div>
              <button
                onClick={() => {
                  setExpandedMetric(key);
                  setShowTeam(false);
                  setShowGST(false);
                }}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-indigo-500 transition-colors"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            <div className="h-[160px] w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={smallChartData[key]}>
                  <defs>
                    <linearGradient
                      id={`grad-${key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={config.color}
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="95%"
                        stopColor={config.color}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={colors.grid}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: colors.text, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <YAxis
                    tick={{ fill: colors.text, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartsTooltip
                    formatter={(value) => [`${value}`, config.desc]}
                    contentStyle={{
                      backgroundColor: colors.tooltipBg,
                      borderRadius: "12px",
                      border: "none",
                      boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                      padding: "12px 16px",
                    }}
                    labelFormatter={(label, payload) => {
                      // ✅ Show date range if available (Weekly view)
                      if (payload && payload[0] && payload[0].payload?.range) {
                        return `${label} (${payload[0].payload.range})`;
                      }
                      return label;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="main"
                    stroke={config.color}
                    fill={`url(#grad-${key})`}
                    strokeWidth={2}
                    activeDot={{
                      r: 6,
                      cursor: "pointer",
                      onClick: (e, payload) => {
                        if (payload?.payload?.date) {
                          handleDrillDown(
                            key,
                            payload.payload.date,
                            payload.payload.name,
                            payload.payload,
                          );
                        }
                      },
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* NOC Analytics Section - Shows all NOC tickets raised by GST */}
      <NOCAnalytics isLoading={analyticsLoading} />

      {/* CSAT + DSAT */}
      {/* Change: 'lg:grid-cols-2' -> 'grid-cols-1' to make them full width & stacked */}
      <div className="grid grid-cols-1 gap-6">
        <CSATLeaderboard
          leaderboard={analyticsData?.leaderboard}
          isLoading={analyticsLoading}
        />

        <DSATAlerts
          badTickets={tickets.filter((t) => getCSATStatus(t) === "Bad")}
          isLoading={analyticsLoading}
          // Change: Combine permission check with your viewMode toggle
          isGSTUser={isGSTUser && viewMode === "gst"}
        />
      </div>

      {/* EXPANDED OVERVIEW METRIC MODAL - FULL FEATURED */}
      {expandedOverviewMetric && OVERVIEW_METRICS[expandedOverviewMetric] && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div
            className="absolute inset-0"
            onClick={() => setExpandedOverviewMetric(null)}
          />

          <div className="bg-white dark:bg-slate-900 w-[95vw] max-w-7xl h-[90vh] rounded-3xl shadow-2xl relative flex flex-col z-10 overflow-hidden border border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="px-8 py-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
              <div className="flex items-center gap-4">
                <div
                  className="p-4 rounded-2xl"
                  style={{
                    backgroundColor: `${OVERVIEW_METRICS[expandedOverviewMetric].color}15`,
                  }}
                >
                  {React.createElement(
                    OVERVIEW_METRICS[expandedOverviewMetric].icon,
                    {
                      className: "w-8 h-8",
                      style: {
                        color: OVERVIEW_METRICS[expandedOverviewMetric].color,
                      },
                    },
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 dark:text-white">
                    {OVERVIEW_METRICS[expandedOverviewMetric].fullLabel}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {OVERVIEW_METRICS[expandedOverviewMetric].desc}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setExpandedOverviewMetric(null);
                  setExpandedDateRange(null); // Reset to use global
                }}
                className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            {/* Controls Bar */}
            <div className="px-8 py-4 bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-4">
              {/* Date Range Picker - Same as global */}
              <SmartDateRangePicker
                value={expandedDateRange || filters?.dateRange}
                onChange={(val) => setExpandedDateRange(val)}
              />

              {/* Grouping Toggle */}
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                {["daily", "weekly", "monthly"].map((g) => (
                  <button
                    key={g}
                    onClick={() => setExpandedGroupBy(g)}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      expandedGroupBy === g
                        ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>

              {/* Date Range Display */}
              {/* Date Range Display */}
              <div className="ml-auto text-sm text-slate-500 flex items-center gap-2">
                <span className="font-medium">
                  {expandedEffectiveDateRange.days || effectiveDateRange.days}{" "}
                  days
                </span>
                <span>•</span>
                <span>
                  {format(
                    expandedEffectiveDateRange.start ||
                      effectiveDateRange.start,
                    "MMM dd",
                  )}{" "}
                  -{" "}
                  {format(
                    expandedEffectiveDateRange.end || effectiveDateRange.end,
                    "MMM dd, yyyy",
                  )}
                </span>
              </div>
            </div>

            {/* Simplified Summary */}
            <div className="px-8 py-3 bg-slate-50 dark:bg-slate-800/30 flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Current:</span>
                <span
                  className="font-bold"
                  style={{
                    color: OVERVIEW_METRICS[expandedOverviewMetric].color,
                  }}
                >
                  {filteredStats[
                    OVERVIEW_METRICS[expandedOverviewMetric].dataKey
                  ] || "—"}
                  {OVERVIEW_METRICS[expandedOverviewMetric].unit}
                </span>
              </div>
              <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Avg:</span>
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  {getExpandedAverage(expandedOverviewMetric)}
                </span>
              </div>
              <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Trend:</span>
                <span
                  className={`font-bold flex items-center gap-1 ${getExpandedTrend(expandedOverviewMetric).isPositive ? "text-emerald-500" : "text-rose-500"}`}
                >
                  {getExpandedTrend(expandedOverviewMetric).value}
                  {getExpandedTrend(expandedOverviewMetric).isPositive ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                </span>
              </div>
              <div className="ml-auto text-xs text-slate-400">
                Click any point to drill down
              </div>
            </div>

            {/* Main Chart Area */}
            <div className="flex-1 px-8 py-6 overflow-auto">
              <div className="h-full min-h-[450px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={getExpandedChartData(expandedOverviewMetric)}
                    margin={{ top: 20, right: 30, left: 20, bottom: 30 }}
                  >
                    <defs>
                      <linearGradient
                        id="expandedAreaGrad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={
                            OVERVIEW_METRICS[expandedOverviewMetric].color
                          }
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="100%"
                          stopColor={
                            OVERVIEW_METRICS[expandedOverviewMetric].color
                          }
                          stopOpacity={0.05}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={isDark ? "#334155" : "#e2e8f0"}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{
                        fill: isDark ? "#94a3b8" : "#64748b",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                      axisLine={{ stroke: isDark ? "#334155" : "#e2e8f0" }}
                      tickLine={false}
                      dy={15}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{
                        fill: isDark ? "#94a3b8" : "#64748b",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                      axisLine={false}
                      tickLine={false}
                      dx={-10}
                      tickFormatter={(val) => val.toLocaleString()}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: isDark ? "#1e293b" : "#ffffff",
                        border: "none",
                        borderRadius: "16px",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
                        padding: "16px 20px",
                      }}
                      labelStyle={{
                        fontWeight: "bold",
                        fontSize: "14px",
                        marginBottom: "8px",
                        color: isDark ? "#fff" : "#1e293b",
                      }}
                      labelFormatter={(label, payload) => {
                        // ✅ FIX: Show date range if available (Weekly view)
                        if (payload && payload[0] && payload[0].payload.range) {
                          return `${label} (${payload[0].payload.range})`;
                        }
                        return label;
                      }}
                      formatter={(value, name, props) => {
                        // CSAT and FRR should be integers, others can have decimals
                        const isIntegerMetric = ["csat", "frrPercent"].includes(
                          expandedOverviewMetric,
                        );
                        const displayValue =
                          typeof value === "number"
                            ? isIntegerMetric
                              ? Math.round(value)
                              : value.toFixed(2)
                            : value;
                        const dsatCount = props?.payload?.negativeCSAT || 0;
                        return [
                          <span>
                            <span
                              className="text-lg font-bold"
                              style={{
                                color:
                                  OVERVIEW_METRICS[expandedOverviewMetric].color,
                              }}
                            >
                              {displayValue}{" "}
                              {OVERVIEW_METRICS[expandedOverviewMetric].unit}
                            </span>
                            {expandedOverviewMetric === "csat" && dsatCount > 0 && (
                              <span className="block text-sm font-semibold text-red-500 mt-1">
                                {dsatCount} DSAT
                              </span>
                            )}
                          </span>,
                          OVERVIEW_METRICS[expandedOverviewMetric].label,
                        ];
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={OVERVIEW_METRICS[expandedOverviewMetric].color}
                      fill="url(#expandedAreaGrad)"
                      strokeWidth={3}
                      dot={(props) => {
                        const { cx, cy, payload } = props;
                        const hasDSAT = expandedOverviewMetric === "csat" && payload?.negativeCSAT > 0;
                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={hasDSAT ? 6 : 5}
                            fill={hasDSAT ? "#ef4444" : OVERVIEW_METRICS[expandedOverviewMetric].color}
                            stroke={hasDSAT ? "#fff" : "none"}
                            strokeWidth={hasDSAT ? 2 : 0}
                          />
                        );
                      }}
                      activeDot={{
                        r: 8,
                        strokeWidth: 3,
                        stroke: "#fff",
                        fill: OVERVIEW_METRICS[expandedOverviewMetric].color,
                        cursor: "pointer",
                        onClick: (e, payload) => {
                          if (payload?.payload?.date) {
                            handleDrillDown(
                              expandedOverviewMetric,
                              payload.payload.date,
                              payload.payload.name,
                            );
                          }
                        },
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EXPANDED MODAL */}
      {expandedMetric && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div
            className="absolute inset-0"
            onClick={() => setExpandedMetric(null)}
          ></div>

          <div className="bg-white dark:bg-slate-900 w-[95vw] h-[90vh] rounded-3xl shadow-2xl border border-white/10 relative flex flex-col z-10 overflow-hidden">
            {/* HEADER */}
            <div className="px-8 py-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-center shrink-0 rounded-t-3xl">
              <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                <div
                  className="p-2 rounded-xl"
                  style={{
                    backgroundColor: `${METRICS[expandedMetric].color}20`,
                  }}
                >
                  {React.createElement(METRICS[expandedMetric].icon, {
                    className: "w-6 h-6",
                    style: { color: METRICS[expandedMetric].color },
                  })}
                </div>
                {METRICS[expandedMetric].label} Analysis
              </h2>
              <button
                onClick={() => setExpandedMetric(null)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            {/* CONTROLS */}
            <div className="px-8 py-4 bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-4 shrink-0">
              {/* User Dropdown - GST ONLY */}
              <div className="relative" ref={userDropdownRef}>
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className={`flex items-center gap-2 bg-white dark:bg-slate-900 px-4 py-2.5 rounded-xl border shadow-sm transition-all min-w-[220px] justify-between ${
                    userDropdownOpen
                      ? "border-indigo-500 ring-2 ring-indigo-500/20"
                      : "border-slate-200 dark:border-slate-800 hover:border-indigo-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {selectedUsers.length > 0
                        ? `${selectedUsers.length} Users Selected`
                        : "Select Users..."}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${userDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {userDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-2 max-h-[60vh] overflow-y-auto z-[60]">
                    {/* Select All / Clear */}
                    <div className="flex items-center justify-between px-2 pb-2 mb-1 border-b border-slate-100 dark:border-slate-800">
                      <button
                        onClick={() => setSelectedUsers([...gstUserNames])}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => setSelectedUsers([])}
                        className="text-xs font-medium text-slate-400 hover:text-slate-600"
                      >
                        Clear
                      </button>
                    </div>
                    {gstUserNames.map((user) => (
                      <label
                        key={user}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                          selectedUsers.includes(user)
                            ? "bg-indigo-50 dark:bg-indigo-900/20"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedUsers.includes(user)}
                          onChange={(e) => {
                            if (e.target.checked)
                              setSelectedUsers([...selectedUsers, user]);
                            else
                              setSelectedUsers(
                                selectedUsers.filter((u) => u !== user),
                              );
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={`text-sm ${
                          selectedUsers.includes(user)
                            ? "font-semibold text-indigo-700 dark:text-indigo-300"
                            : "text-slate-700 dark:text-slate-200"
                        }`}>
                          {user}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Time Range */}
              <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <Calendar className="w-4 h-4 text-slate-400" />
                <SmartDateRangePicker
                  value={expandedDateRange || filters?.dateRange}
                  onChange={(val) => setExpandedDateRange(val)}
                />
              </div>

              {/* Group By Toggle */}
              <div className="flex items-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                {["daily", "weekly", "monthly"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setExpandedGroupBy(mode)}
                    className={`px-3 py-2 text-xs font-bold capitalize transition-all ${
                      expandedGroupBy === mode
                        ? "bg-indigo-600 text-white"
                        : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <div className="h-8 w-px bg-slate-300 dark:bg-slate-700 mx-2"></div>

              <button
                onClick={() => setShowTeam(!showTeam)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${
                  showTeam
                    ? "bg-rose-50 dark:bg-rose-900/30 border-rose-200 text-rose-600"
                    : "border-transparent text-slate-500 hover:bg-slate-100"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full border ${
                    showTeam
                      ? "bg-rose-500 border-rose-500"
                      : "border-slate-400"
                  }`}
                ></div>
                Vs Team
              </button>

              <button
                onClick={() => setShowGST(!showGST)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${
                  showGST
                    ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 text-emerald-600"
                    : "border-transparent text-slate-500 hover:bg-slate-100"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full border ${
                    showGST
                      ? "bg-emerald-500 border-emerald-500"
                      : "border-slate-400"
                  }`}
                ></div>
                Vs GST
              </button>
            </div>

            {/* INSIGHTS */}
            <div className="px-8 pt-6 pb-2 bg-slate-50/50 dark:bg-slate-900/50">
              <SmartInsights
                data={expandedData}
                metric={expandedMetric}
                showTeam={showTeam}
                showGST={showGST}
                selectedUsers={selectedUsers}
                myTeamName={selectedUserTeamName}
              />
            </div>

            {/* CHART */}
            <div className="flex-1 w-full bg-slate-50/50 dark:bg-slate-900/50 p-6 relative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={expandedData}
                  margin={{ top: 20, right: 30, left: 10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorTeam" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e11d48" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorGST" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={isDark ? "#1e293b" : "#e2e8f0"}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{
                      fill: isDark ? "#94a3b8" : "#64748b",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                    minTickGap={30}
                  />
                  <YAxis
                    tick={{
                      fill: isDark ? "#94a3b8" : "#64748b",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      borderRadius: "12px",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: "20px" }}
                    iconType="circle"
                  />

                  {selectedUsers.map((user, index) => (
                    <Area
                      key={user}
                      type="monotone"
                      dataKey={user}
                      name={user}
                      stroke={CHART_COLORS[index % CHART_COLORS.length]}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                      fillOpacity={0.1}
                      strokeWidth={3}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                  ))}

                  {showTeam && (
                    <Area
                      type="monotone"
                      dataKey="compare_team"
                      name="Team Total"
                      stroke="#e11d48"
                      fill="none"
                      strokeWidth={2.5}
                      strokeDasharray="6 3"
                    />
                  )}
                  {showGST && (
                    <Area
                      type="monotone"
                      dataKey="compare_gst"
                      name="GST Total"
                      stroke="#10b981"
                      fill="none"
                      strokeWidth={2.5}
                      strokeDasharray="6 3"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Drill-Down Modal */}
      <DrillDownModal
        isOpen={!!drillDownData}
        onClose={() => setDrillDownData(null)}
        title={drillDownData?.title || ""}
        tickets={drillDownData?.tickets || []}
        metricKey={drillDownData?.metricKey || ""}
        summary={drillDownData?.summary || ""}
      />
    </div>
  );
};

export default AnalyticsDashboard;
