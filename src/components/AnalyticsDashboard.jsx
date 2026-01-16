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
  Terminal,
  Table,
  Download,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Play,
  Copy,
  FileJson,
  FileSpreadsheet,
} from "lucide-react";
import { getCSATStatus, FLAT_TEAM_MAP, TEAM_GROUPS } from "../utils";
import { useTicketStore } from "../store";

const HIDDEN_USERS = [
  "System",
  "DevRev Bot",
  "A",
  "V",
  "n",
  "Undefined",
  "null",
  "Anmol",
  "anmol-sawhney",
];
const SUPER_ADMIN_EMAILS = ["rohan.jadhav@clevertap.com","anmol.sawhney@clevertap.com"]
// ============================================================================
// METRICS CONFIG
// ============================================================================
const METRICS = {
  volume: {
    label: "Incoming Volume",
    icon: ArrowUpRight,
    color: "#6366f1",
    desc: "Tickets Created",
  },
  solved: {
    label: "Solved",
    icon: CheckCircle,
    color: "#10b981",
    desc: "Tickets Solved",
  },
  rwt: {
    label: "Avg Resolution",
    icon: Clock,
    color: "#f59e0b",
    desc: "Hours to Solve",
  },
  backlog: {
    label: "Backlog Clearance",
    icon: ArchiveRestore,
    color: "#f97316",
    desc: "Solved (Age > 15 Days)",
  },
};
const OVERVIEW_METRICS = {
  avgRWT: {
    label: "Avg RWT",
    fullLabel: "Average Resolution Wait Time",
    icon: Clock,
    color: "#8b5cf6",
    unit: "Hrs",
    desc: "Average time to resolve tickets",
    dataKey: "avgRWT",
  },
  csat: {
    label: "Positive CSAT",
    fullLabel: "Customer Satisfaction",
    icon: Smile,
    color: "#10b981",
    unit: "",
    desc: "Positive customer feedback count",
    dataKey: "positiveCSAT",
  },
  frrPercent: {
    label: "FRR Met",
    fullLabel: "First Response Rate",
    icon: Zap,
    color: "#f59e0b",
    unit: "%",
    desc: "First response within SLA",
    dataKey: "frrPercent",
  },
  avgIterations: {
    label: "Avg Iterations",
    fullLabel: "Average Iterations per Ticket",
    icon: Layers,
    color: "#3b82f6",
    unit: "",
    desc: "Back-and-forth exchanges",
    dataKey: "avgIterations",
  },
  avgFRT: {
    label: "Avg FRT",
    fullLabel: "Average First Response Time",
    icon: TrendingUp,
    color: "#f43f5e",
    unit: "Hrs",
    desc: "Time to first response",
    dataKey: "avgFRT",
  },
};

const QUARTERS = [
  { id: "Q4_25", label: "Q4 '25" },
  { id: "Q1_26", label: "Q1 '26" },
];

const CHART_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#06b6d4",
  "#8b5cf6",
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
        parseISO(t.created_date)
      );
      return diff > 0 ? diff : 0;
    }
    if (metric === "backlog") {
      if (!t.actual_close_date || !t.created_date) return 0;
      const ageInDays = differenceInDays(
        parseISO(t.actual_close_date),
        parseISO(t.created_date)
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
            subjectValues.reduce((a, b) => a + b, 0) / subjectValues.length
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
  currentUserTeamName
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
          parseISO(t.created_date)
        )
      );
    }
    if (metric === "backlog") {
      if (!t.actual_close_date || !t.created_date) return 0;
      return differenceInDays(
        parseISO(t.actual_close_date),
        parseISO(t.created_date)
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

const PerformanceMetricsCards = ({
  stats,
  trends,
  onQuarterChange,
  onGroupByChange,
  currentQuarter,
  currentGroupBy,
  isLoading,
  excludeZendesk,
  onExcludeZendeskChange,
  onRefresh,
  isRefreshing,
  onExpandMetric,
}) => {
  const [selectedQuarter, setSelectedQuarter] = useState(
    currentQuarter || "Q4_25"
  );
  const [groupBy, setGroupBy] = useState(currentGroupBy || "daily");
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [hoveredCard, setHoveredCard] = useState(null);

  // Current quarter is Q1_26
  const isCurrentQuarter = selectedQuarter === "Q1_26";

  // Get current week number in Q1 (Jan 1 = Week 1)
  const today = new Date();
  const q1Start = new Date("2026-01-01");
  const daysSinceQ1Start = Math.floor(
    (today - q1Start) / (1000 * 60 * 60 * 24)
  );

  const currentMonthNum =
    today.getMonth() >= 0 && today.getMonth() <= 2 ? today.getMonth() + 1 : 1;

  // Week definitions for Q1
  const Q1_WEEKS = [
    {
      id: 1,
      label: "W1",
      start: "2026-01-06",
      end: "2026-01-12",
      range: "Jan 6-12",
    },
    {
      id: 2,
      label: "W2",
      start: "2026-01-13",
      end: "2026-01-19",
      range: "Jan 13-19",
    },
    {
      id: 3,
      label: "W3",
      start: "2026-01-20",
      end: "2026-01-26",
      range: "Jan 20-26",
    },
    {
      id: 4,
      label: "W4",
      start: "2026-01-27",
      end: "2026-02-02",
      range: "Jan 27 - Feb 2",
    },
    {
      id: 5,
      label: "W5",
      start: "2026-02-03",
      end: "2026-02-09",
      range: "Feb 3-9",
    },
    {
      id: 6,
      label: "W6",
      start: "2026-02-10",
      end: "2026-02-16",
      range: "Feb 10-16",
    },
  ];

  // Month definitions with week ranges
  const Q1_MONTHS = [
    { id: 1, label: "M1", name: "January", weeks: "W1-W4", range: "Jan 1-31" },
    { id: 2, label: "M2", name: "February", weeks: "W5-W8", range: "Feb 1-28" },
    { id: 3, label: "M3", name: "March", weeks: "W9-W13", range: "Mar 1-31" },
  ];

  // Calculate current week number based on today's date
  const getCurrentWeekNum = () => {
    for (const week of Q1_WEEKS) {
      const weekEnd = new Date(week.end + "T23:59:59");
      if (today <= weekEnd) {
        return week.id;
      }
    }
    return Q1_WEEKS.length; // Return last week if past all weeks
  };

  const currentWeekNum = getCurrentWeekNum();

  const handleQuarterChange = (qId) => {
    setSelectedQuarter(qId);
    setGroupBy("daily"); // Reset to daily when changing quarter
    setSelectedWeek(null);
    setSelectedMonth(null);
    onQuarterChange(qId);
  };

  const handleGroupByChange = (g) => {
    if (!isCurrentQuarter) return; // Only allow for current quarter
    setGroupBy(g);
    setSelectedWeek(null);
    setSelectedMonth(null);
    onGroupByChange?.(g);
  };

  const handleWeekSelect = (weekId) => {
    if (weekId > currentWeekNum) return; // Can't select future weeks
    setSelectedWeek(selectedWeek === weekId ? null : weekId);
    onGroupByChange?.(`Q1_26_W${weekId}`);
  };

  const handleMonthSelect = (monthId) => {
    if (monthId > currentMonthNum) return;
    setSelectedMonth(selectedMonth === monthId ? null : monthId);
    onGroupByChange?.(`Q1_26_M${monthId}`);
  };

  const getSparklineData = (key) => {
    if (!trends?.length) return [];
    return trends.slice(-14).map((t) => ({
      date: t.date,
      value:
        key === "csat"
          ? t.positiveCSAT
          : key === "solved"
          ? t.solved
          : t[key] || 0,
    }));
  };

  // Calculate insights for hover
  const getInsights = (metricKey, currentValue) => {
    if (!trends || trends.length < 7) return null;

    const recentTrends = trends.slice(-14);
    const thisWeek = recentTrends.slice(-7);
    const lastWeek = recentTrends.slice(-14, -7);

    const getValue = (t) => {
      if (metricKey === "avgRWT") return t.avgRWT || 0;
      if (metricKey === "csat") return t.positiveCSAT || 0;
      if (metricKey === "frrPercent") return t.frrMet || 0;
      if (metricKey === "avgIterations") return t.avgIterations || 0;
      if (metricKey === "avgFRT") return t.avgFRT || 0;
      return 0;
    };

    const thisWeekAvg =
      thisWeek.reduce((a, t) => a + getValue(t), 0) / (thisWeek.length || 1);
    const lastWeekAvg =
      lastWeek.reduce((a, t) => a + getValue(t), 0) / (lastWeek.length || 1);
    const change =
      lastWeekAvg > 0
        ? (((thisWeekAvg - lastWeekAvg) / lastWeekAvg) * 100).toFixed(1)
        : 0;

    const isPositiveGood = ["csat", "frrPercent"].includes(metricKey);
    const isLowerBetter = ["avgRWT", "avgFRT", "avgIterations"].includes(
      metricKey
    );

    const trendDirection =
      thisWeekAvg > lastWeekAvg
        ? "up"
        : thisWeekAvg < lastWeekAvg
        ? "down"
        : "stable";
    const isGood = isLowerBetter
      ? trendDirection === "down"
      : trendDirection === "up";

    return {
      thisWeekAvg: thisWeekAvg.toFixed(1),
      lastWeekAvg: lastWeekAvg.toFixed(1),
      change: Math.abs(change),
      trendDirection,
      isGood,
      insight: isGood
        ? `Improved ${Math.abs(change)}% vs last week`
        : trendDirection === "stable"
        ? "Stable performance"
        : `${Math.abs(change)}% ${
            isLowerBetter ? "higher" : "lower"
          } than last week`,
    };
  };

  // Metric Card with Hover Insights
  const MetricCard = ({
    title,
    value,
    unit,
    color,
    sparkKey,
    icon: Icon,
    metricKey,
    onExpand,
  }) => {
    const [isHovered, setIsHovered] = useState(false);
    const insights = getInsights(metricKey, value);

    return (
      <div
        className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:shadow-lg hover:border-indigo-500/50 transition-all h-44 group cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => onExpand && onExpand(metricKey)}
      >
        <div className="flex justify-between items-start">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {title}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
              onClick={(e) => {
                e.stopPropagation();
                onExpand && onExpand(metricKey);
              }}
            >
              <Maximize2 className="w-3.5 h-3.5 text-slate-500 hover:text-indigo-500" />
            </button>
            <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
              <Icon className="w-4 h-4 text-slate-500" />
            </div>
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl font-black text-slate-800 dark:text-white">
            {isLoading ? "..." : value}
          </span>
          <span className="text-sm font-semibold text-slate-400">{unit}</span>
        </div>
        <div className="h-12 w-full mt-auto">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={getSparklineData(sparkKey)}>
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                fill={color}
                fillOpacity={0.2}
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Hover Insight Tooltip */}
        {isHovered && insights && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 translate-y-full z-50 w-52 bg-slate-900 dark:bg-slate-800 text-white p-3 rounded-xl shadow-2xl border border-slate-700 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-900 dark:bg-slate-800 rotate-45 border-l border-t border-slate-700"></div>

            <div className="flex items-center gap-2 mb-2">
              {insights.isGood ? (
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              ) : insights.trendDirection === "stable" ? (
                <Activity className="w-4 h-4 text-slate-400" />
              ) : (
                <TrendingDown className="w-4 h-4 text-rose-400" />
              )}
              <span
                className={`text-xs font-bold ${
                  insights.isGood
                    ? "text-emerald-400"
                    : insights.trendDirection === "stable"
                    ? "text-slate-400"
                    : "text-rose-400"
                }`}
              >
                {insights.insight}
              </span>
            </div>

            <div className="space-y-1 text-[10px]">
              <div className="flex justify-between">
                <span className="text-slate-400">This week avg:</span>
                <span className="font-bold">{insights.thisWeekAvg}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Last week avg:</span>
                <span className="font-medium text-slate-300">
                  {insights.lastWeekAvg}
                </span>
              </div>
            </div>

            <div className="mt-2 pt-2 border-t border-slate-700 text-[10px] text-indigo-400 flex items-center gap-1">
              <Maximize2 className="w-3 h-3" /> Click to expand
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Time Controls Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Daily/Weekly/Monthly - Only for Current Quarter */}
        <div
          className={`flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl ${
            !isCurrentQuarter ? "opacity-50" : ""
          }`}
        >
          {["weekly", "monthly"].map((g) => (
            <button
              key={g}
              onClick={() => handleGroupByChange(g)}
              disabled={!isCurrentQuarter}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                groupBy === g && isCurrentQuarter
                  ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              } ${!isCurrentQuarter ? "cursor-not-allowed" : ""}`}
              title={
                !isCurrentQuarter ? "Only available for current quarter" : ""
              }
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>

        {!isCurrentQuarter && (
          <span className="text-[10px] text-slate-400 italic">
            (Drill-down available for current quarter only)
          </span>
        )}
      </div>

      {/* Week Selector - Only when Weekly is selected for Q1_26 */}
      {isCurrentQuarter && groupBy === "weekly" && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
          <span className="text-xs font-medium text-slate-500 mr-2">
            Select Week:
          </span>
          {Q1_WEEKS.slice(0, 6).map((week) => {
            const isFuture = week.id > currentWeekNum;
            const isSelected = selectedWeek === week.id;
            return (
              <div key={week.id} className="relative group/week">
                <button
                  onClick={() => handleWeekSelect(week.id)}
                  disabled={isFuture}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-md"
                      : isFuture
                      ? "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed opacity-50"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 border border-slate-200 dark:border-slate-700"
                  }`}
                >
                  {week.label}
                </button>
                {/* Hover tooltip for date range */}
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/week:opacity-100 pointer-events-none z-20 transition-opacity">
                  {week.range}
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45"></div>
                </div>
              </div>
            );
          })}
          {selectedWeek && (
            <button
              onClick={() => {
                setSelectedWeek(null);
                onGroupByChange?.("weekly");
              }}
              className="text-xs text-slate-400 hover:text-rose-500 ml-2"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Month Selector - Only when Monthly is selected for Q1_26 */}
      {isCurrentQuarter && groupBy === "monthly" && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
          <span className="text-xs font-medium text-slate-500 mr-2">
            Select Month:
          </span>
          {Q1_MONTHS.map((month) => {
            const isFuture = month.id > currentMonthNum;
            const isSelected = selectedMonth === month.id;
            return (
              <div key={month.id} className="relative group">
                <button
                  onClick={() => handleMonthSelect(month.id)}
                  disabled={isFuture}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-md"
                      : isFuture
                      ? "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed opacity-50"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 border border-slate-200 dark:border-slate-700"
                  }`}
                >
                  {month.label}
                </button>
                {/* Hover tooltip showing weeks in month */}
                <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 px-3 py-2 bg-slate-900 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20 shadow-xl">
                  <div className="font-bold mb-1">{month.name}</div>
                  <div className="text-slate-300">{month.range}</div>
                  <div className="text-indigo-300 mt-1">
                    Weeks: {month.weeks}
                  </div>
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45"></div>
                </div>
              </div>
            );
          })}
          {selectedMonth && (
            <button
              onClick={() => {
                setSelectedMonth(null);
                onGroupByChange?.("monthly");
              }}
              className="text-xs text-slate-400 hover:text-rose-500 ml-2"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Header with Quarter Selector + Controls */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 rounded-xl">
            <Trophy className="w-5 h-5 text-indigo-500" />
          </div>
          Performance Overview
          {stats?.totalTickets > 0 && (
            <span className="text-sm font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
              {stats.totalTickets.toLocaleString()} tickets
            </span>
          )}
        </h2>

        <div className="flex items-center gap-3">
          {/* Exclude Zendesk */}
          <button
            onClick={onExcludeZendeskChange}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              excludeZendesk
                ? "bg-slate-800 text-white border-slate-800"
                : "bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"
            }`}
          >
            {excludeZendesk ? (
              <Check className="w-3 h-3" />
            ) : (
              <ListFilter className="w-3 h-3" />
            )}
            Exclude Zendesk
          </button>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-indigo-600 disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </button>

          {/* Quarter Selector */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {QUARTERS.map((q) => (
              <button
                key={q.id}
                onClick={() => handleQuarterChange(q.id)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  selectedQuarter === q.id
                    ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard
          title="Avg RWT"
          value={stats?.avgRWT || "0.0"}
          unit="Hrs"
          color="#8b5cf6"
          sparkKey="avgRWT"
          icon={Clock}
          metricKey="avgRWT"
          onExpand={onExpandMetric}
        />
        <MetricCard
          title="Positive CSAT"
          value={stats?.positiveCSAT || 0}
          unit="Count"
          color="#10b981"
          sparkKey="csat"
          icon={Smile}
          metricKey="csat"
          onExpand={onExpandMetric}
        />
        <MetricCard
          title="FRR Met"
          value={`${stats?.frrPercent || 0}`}
          unit="%"
          color="#f59e0b"
          sparkKey="frrPercent"
          icon={Zap}
          metricKey="frrPercent"
          onExpand={onExpandMetric}
        />
        <MetricCard
          title="Avg Iterations"
          value={stats?.avgIterations || "0.0"}
          unit=""
          color="#3b82f6"
          sparkKey="avgIterations"
          icon={Layers}
          metricKey="avgIterations"
          onExpand={onExpandMetric}
        />
        <MetricCard
          title="Avg FRT"
          value={stats?.avgFRT || "0.0"}
          unit="Hrs"
          color="#f43f5e"
          sparkKey="avgFRT"
          icon={TrendingUp}
          metricKey="avgFRT"
          onExpand={onExpandMetric}
        />
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

// ============================================================================
// CSAT LEADERBOARD
// ============================================================================
const CSATLeaderboard = ({ leaderboard = [], isLoading }) => {
  const podium = leaderboard.slice(0, 3);
  const runnersUp = leaderboard.slice(3, 15);
  const podiumOrder =
    podium.length >= 3 ? [podium[1], podium[0], podium[2]] : podium;

  const getPodiumStyle = (idx) => {
    const styles = [
      {
        height: "h-32",
        color:
          "from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-800",
        border: "border-slate-300",
        rank: 2,
      },
      {
        height: "h-40",
        color:
          "from-amber-200 to-amber-100 dark:from-amber-900/50 dark:to-amber-800/30",
        border: "border-amber-400",
        rank: 1,
      },
      {
        height: "h-28",
        color:
          "from-orange-200 to-orange-100 dark:from-orange-900/30 dark:to-orange-800/20",
        border: "border-orange-300",
        rank: 3,
      },
    ];
    return styles[idx] || styles[2];
  };

  if (isLoading)
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border animate-pulse h-96" />
    );

  return (
    <div className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-amber-50 to-transparent dark:from-amber-900/20">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <Crown className="w-5 h-5 text-amber-500" /> CSAT Champions
        </h3>
      </div>
      <div className="px-6 py-8">
        <div className="flex items-end justify-center gap-4 mb-8">
          {podiumOrder.map((person, idx) => {
            const style = getPodiumStyle(idx);
            const isGold = style.rank === 1;
            return (
              <div
                key={person?.name || idx}
                className="flex flex-col items-center"
              >
                <div className={`relative mb-3 ${isGold ? "-mt-8" : ""}`}>
                  {isGold && (
                    <Crown className="absolute -top-6 left-1/2 -translate-x-1/2 w-8 h-8 text-amber-500 animate-bounce" />
                  )}
                  <div
                    className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold border-4 ${style.border} bg-gradient-to-br ${style.color}`}
                  >
                    {person?.name?.[0] || "?"}
                  </div>
                  <div
                    className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      style.rank === 1
                        ? "bg-amber-500 text-white"
                        : style.rank === 2
                        ? "bg-slate-400 text-white"
                        : "bg-orange-400 text-white"
                    }`}
                  >
                    {style.rank}
                  </div>
                </div>
                <div
                  className={`${style.height} w-24 bg-gradient-to-t ${style.color} rounded-t-xl flex flex-col items-center justify-start pt-4 border-x border-t ${style.border}`}
                >
                  <span className="text-sm font-bold text-slate-800 dark:text-white text-center px-1 truncate w-full">
                    {person?.name?.split(" ")[0] || "—"}
                  </span>
                  <div className="flex items-center gap-1 mt-1">
                    <Smile className="w-3 h-3 text-emerald-500" />
                    <span className="text-lg font-black text-emerald-600">
                      {person?.goodCSAT || 0}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1">
                    {person?.winRate || 0}% win
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {runnersUp.length > 0 && (
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
              <Medal className="w-4 h-4" /> Runners Up
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {runnersUp.map((person, idx) => (
                <div
                  key={person.name}
                  className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50"
                >
                  <span className="text-xs font-bold text-slate-400 w-5">
                    {idx + 4}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                      {person.name}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="text-emerald-600 font-bold">
                        {person.goodCSAT} 👍
                      </span>
                      <span>{person.winRate}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// DSAT ALERTS (Only for GST users, only active/unsolved)
// ============================================================================
const DSATAlerts = ({ badTickets = [], isLoading, isGSTUser }) => {
  const [showAll, setShowAll] = useState(false);

  // Filter to only show active (unsolved) DSAT tickets
  const activeBAD = badTickets.filter((t) => {
    const stage = t.stage?.name?.toLowerCase() || "";
    return !stage.includes("solved") && !stage.includes("closed");
  });

  const displayTickets = showAll ? activeBAD : activeBAD.slice(0, 6);

  // Only show for GST users
  if (!isGSTUser || (!activeBAD.length && !isLoading)) return null;

  return (
    <div className="bg-gradient-to-br from-rose-50 to-white dark:from-rose-900/10 dark:to-slate-900 border border-rose-200 dark:border-rose-900/50 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-rose-100 dark:border-rose-900/30 flex justify-between items-center">
        <h3 className="text-base font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> Active Negative Feedback (
          {activeBAD.length})
        </h3>
        {activeBAD.length > 6 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs font-semibold text-rose-600 flex items-center gap-1"
          >
            {showAll ? (
              <EyeOff className="w-3 h-3" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            {showAll ? "Show Less" : `Show All`}
          </button>
        )}
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayTickets.map((t) => (
          <div
            key={t.id || t.display_id}
            className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-rose-100 dark:border-rose-900/30 group"
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                {t.display_id}
              </span>
              <a
                href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 line-clamp-2 mb-3">
              {t.title}
            </p>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-600 bg-rose-50 dark:bg-rose-900/30 px-2 py-1 rounded-full">
                <Frown className="w-3 h-3" /> BAD
              </div>
              <span className="text-[10px] text-slate-400">{t.owner}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN DASHBOARD
// ============================================================================
const AnalyticsDashboard = ({ tickets = [], filterOwner, dateRange }) => {
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

  const [excludeZendesk, setExcludeZendesk] = useState(false);
  const [viewMode, setViewMode] = useState("gst");
  const [expandedMetric, setExpandedMetric] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [showTeam, setShowTeam] = useState(false);
  const [showGST, setShowGST] = useState(false);
  const [timeRange, setTimeRange] = useState(30);
  const [groupBy, setGroupBy] = useState("daily"); // daily, weekly, monthly

  const [expandedOverviewMetric, setExpandedOverviewMetric] = useState(null);

  const isDark = theme === "dark";
  const effectiveDateRange = useMemo(() => {
    if (dateRange?.start && dateRange?.end) {
      return {
        start: parseISO(dateRange.start),
        end: parseISO(dateRange.end),
        days:
          differenceInDays(parseISO(dateRange.end), parseISO(dateRange.start)) +
          1,
      };
    }
    const end = new Date();
    const start = subDays(end, 29);
    return { start, end, days: 30 };
  }, [dateRange]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (!t.created_date) return false;
      const ticketDate = parseISO(t.created_date);
      return (
        ticketDate >= effectiveDateRange.start &&
        ticketDate <= effectiveDateRange.end
      );
    });
  }, [tickets, effectiveDateRange]);

  // Admin Query Console State
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  const [adminQuery, setAdminQuery] = useState("");
  const [adminRawQuery, setAdminRawQuery] = useState("{}");
  const [adminQueryMode, setAdminQueryMode] = useState("natural"); // "natural" | "raw"
  const [adminResults, setAdminResults] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminPage, setAdminPage] = useState(1);
  const [adminPageSize, setAdminPageSize] = useState(50);
  const [adminTotalCount, setAdminTotalCount] = useState(0);
  const [queryCollapsed, setQueryCollapsed] = useState(true);
  const [editableQuery, setEditableQuery] = useState("");

  // Better date parsing function
  const parseDateString = (dateStr) => {
    if (!dateStr) return null;

    // Clean up the string
    const clean = dateStr.trim().toLowerCase();

    // Try various formats
    const formats = [
      // "jan 01 2026", "jan 1 2026"
      /^(\w{3})\s+(\d{1,2})\s+(\d{4})$/,
      // "01 jan 2026", "1 jan 2026"
      /^(\d{1,2})\s+(\w{3})\s+(\d{4})$/,
      // "2026-01-01"
      /^(\d{4})-(\d{2})-(\d{2})$/,
      // "01/01/2026"
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    ];

    const months = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };

    // Try "jan 01 2026" format
    let match = clean.match(/^(\w{3})\s+(\d{1,2})\s+(\d{4})$/);
    if (match) {
      const [, mon, day, year] = match;
      if (months[mon] !== undefined) {
        return new Date(parseInt(year), months[mon], parseInt(day));
      }
    }

    // Try "01 jan 2026" format
    match = clean.match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
    if (match) {
      const [, day, mon, year] = match;
      if (months[mon] !== undefined) {
        return new Date(parseInt(year), months[mon], parseInt(day));
      }
    }

    // Try "15 jan" (assume current year or 2026)
    match = clean.match(/^(\d{1,2})\s+(\w{3})$/);
    if (match) {
      const [, day, mon] = match;
      if (months[mon] !== undefined) {
        return new Date(2026, months[mon], parseInt(day));
      }
    }

    // Try "jan 15" (assume current year or 2026)
    match = clean.match(/^(\w{3})\s+(\d{1,2})$/);
    if (match) {
      const [, mon, day] = match;
      if (months[mon] !== undefined) {
        return new Date(2026, months[mon], parseInt(day));
      }
    }

    // Fallback to Date.parse
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  // Improved natural language query parser
  const parseNaturalQuery = (query) => {
    const q = query.toLowerCase().trim();
    const mongoQuery = {};

    // Extract owner/member name - more patterns
    const ownerPatterns = [
      /(?:tickets?\s+(?:of|for|by|from|owned\s+by|assigned\s+to))\s+(\w+)/i,
      /^(\w+)\s+tickets?/i,
      /^(\w+)\s+ticket/i,
      /(?:owner|member|assignee)[:\s=]+["']?(\w+)["']?/i,
      /^(\w+)\s+(?:last|from|between)/i,
    ];

    for (const pattern of ownerPatterns) {
      const match = q.match(pattern);
      if (match && match[1]) {
        // Check if it's not a keyword
        const keywords = [
          "tickets",
          "ticket",
          "last",
          "from",
          "where",
          "with",
          "high",
          "low",
          "good",
          "bad",
          "exclude",
        ];
        if (!keywords.includes(match[1].toLowerCase())) {
          mongoQuery.owner = { $regex: match[1], $options: "i" };
          break;
        }
      }
    }

    // Date range patterns
    // "last X days"
    const lastDaysMatch = q.match(/last\s+(\d+)\s+days?/i);
    if (lastDaysMatch) {
      const days = parseInt(lastDaysMatch[1]);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      mongoQuery.closed_date = {
        $gte: startDate.toISOString(),
        $lte: new Date().toISOString(),
      };
    }

    // "from X to Y" or "from X - Y" or "between X and Y"
    const dateRangePatterns = [
      /from\s+(.+?)\s+(?:to|-)\s+(.+?)(?:\s|$)/i,
      /between\s+(.+?)\s+(?:and|-)\s+(.+?)(?:\s|$)/i,
      /(\w+\s+\d{1,2}(?:\s+\d{4})?)\s*[-–]\s*(\w+\s+\d{1,2}(?:\s+\d{4})?)/i,
      /(\d{1,2}\s+\w+(?:\s+\d{4})?)\s*[-–]\s*(\d{1,2}\s+\w+(?:\s+\d{4})?)/i,
    ];

    for (const pattern of dateRangePatterns) {
      const match = q.match(pattern);
      if (match) {
        const startDate = parseDateString(match[1]);
        const endDate = parseDateString(match[2]);
        if (startDate && endDate) {
          // Set end date to end of day
          endDate.setHours(23, 59, 59, 999);
          mongoQuery.closed_date = {
            $gte: startDate.toISOString(),
            $lte: endDate.toISOString(),
          };
          break;
        }
      }
    }

    // FRR filters
    if (
      q.includes("frr met") ||
      q.includes("frr=1") ||
      q.includes("frr = 1") ||
      q.includes("where frr")
    ) {
      mongoQuery.frr = 1;
    } else if (
      q.includes("frr not met") ||
      q.includes("no frr") ||
      q.includes("frr=0") ||
      q.includes("frr = 0")
    ) {
      mongoQuery.frr = 0;
    }

    // CSAT filters
    if (
      q.includes("good csat") ||
      q.includes("positive csat") ||
      q.includes("csat=2") ||
      q.includes("csat = 2")
    ) {
      mongoQuery.csat = 2;
    } else if (
      q.includes("bad csat") ||
      q.includes("negative csat") ||
      q.includes("dsat") ||
      q.includes("csat=1") ||
      q.includes("csat = 1")
    ) {
      mongoQuery.csat = 1;
    }

    // RWT filters
    const rwtMatch = q.match(/rwt\s*[>]=?\s*(\d+)/);
    if (rwtMatch) {
      mongoQuery.rwt = { $gte: parseFloat(rwtMatch[1]) };
    } else if (q.includes("high rwt")) {
      mongoQuery.rwt = { $gte: 50 };
    }

    // FRT filters
    const frtMatch = q.match(/frt\s*[>]=?\s*(\d+)/);
    if (frtMatch) {
      mongoQuery.frt = { $gte: parseFloat(frtMatch[1]) };
    }

    // Iterations filters
    const iterMatch = q.match(/iterations?\s*[>]=?\s*(\d+)/);
    if (iterMatch) {
      mongoQuery.iterations = { $gte: parseInt(iterMatch[1]) };
    } else if (q.includes("high iteration")) {
      mongoQuery.iterations = { $gte: 3 };
    } else if (q.includes("low iteration") || q.includes("single iteration")) {
      mongoQuery.iterations = 1;
    }

    // Zendesk filter
    if (
      q.includes("exclude zendesk") ||
      q.includes("no zendesk") ||
      q.includes("devrev only")
    ) {
      mongoQuery.is_zendesk = { $ne: true };
    } else if (q.includes("zendesk only") || q.includes("only zendesk")) {
      mongoQuery.is_zendesk = true;
    }

    // Region filter
    const regionMatch = q.match(/region[:\s=]+["']?(\w+)["']?/i);
    if (regionMatch) {
      mongoQuery.region = { $regex: regionMatch[1], $options: "i" };
    }

    return mongoQuery;
  };

  // Execute search
  const executeAdminSearch = async (page = 1) => {
    setAdminLoading(true);
    setAdminPage(page);

    try {
      let queryToSend;

      // PRIORITY 1: If editableQuery has content, use it
  if (editableQuery && editableQuery.trim()) {
    try {
      queryToSend = JSON.parse(editableQuery);
    } catch (e) {
      setAdminResults({ error: `Invalid JSON: ${e.message}` });
      setAdminLoading(false);
      return;
    }
  }

     else if (adminQueryMode === "raw"){
        // Parse the raw JSON query
        try {
          queryToSend = JSON.parse(adminRawQuery);
        } catch (e) {
          setAdminResults({ error: `Invalid JSON: ${e.message}` });
          setAdminLoading(false);
          return;
        }
      } else {
        // Parse natural language
        queryToSend = parseNaturalQuery(adminQuery);
        // Update raw query display
        setAdminRawQuery(JSON.stringify(queryToSend, null, 2));
      }

      console.log("🔍 Executing Query:", queryToSend);

      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ""}/api/admin/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: queryToSend,
            page,
            pageSize: adminPageSize,
          }),
        }
      );

      const data = await res.json();
      console.log("📊 Results:", data);

      setAdminResults(data);
      setAdminTotalCount(data.totalCount || 0);
    } catch (e) {
      console.error("Search error:", e);
      setAdminResults({ error: e.message });
    } finally {
      setAdminLoading(false);
    }
  };

  // Download results
  const downloadResults = (fileType) => {
    if (!adminResults?.tickets?.length) return;

    const tickets = adminResults.tickets;

    if (fileType === "json") {
      const blob = new Blob([JSON.stringify(tickets, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tickets_export_${format(new Date(), "yyyy-MM-dd")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (fileType === "csv") {
      const headers = [
        "ticket_id",
        "title",
        "owner",
        "closed_date",
        "rwt",
        "frt",
        "frr",
        "csat",
        "iterations",
        "region",
        "is_zendesk",
      ];
      const csvRows = [headers.join(",")];

      tickets.forEach((t) => {
        const row = headers.map((h) => {
          let val = t[h];
          if (h === "closed_date" && val)
            val = format(new Date(val), "yyyy-MM-dd");
          if (h === "title") val = `"${(val || "").replace(/"/g, '""')}"`;
          return val ?? "";
        });
        csvRows.push(row.join(","));
      });

      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tickets_export_${format(new Date(), "yyyy-MM-dd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Copy query to clipboard
  const copyQuery = () => {
    navigator.clipboard.writeText(adminRawQuery);
  };

  // Add this function to parse natural language query:
  const parseSearchQuery = (query) => {
    const q = query.toLowerCase();
    const filters = {};

    // Owner/Member detection
    const ownerPatterns = [
      /(?:tickets?\s+(?:for|by|of|from|owned by|assigned to))\s+(\w+)/i,
      /(\w+)(?:'s)?\s+tickets?/i,
      /(?:owner|member|assignee)[:\s]+(\w+)/i,
    ];

    for (const pattern of ownerPatterns) {
      const match = q.match(pattern);
      if (match) {
        filters.owner = match[1];
        break;
      }
    }

    // Date range detection
    if (q.includes("last 7 days") || q.includes("last week")) {
      filters.dateRange = 7;
    } else if (q.includes("last 14 days") || q.includes("last 2 weeks")) {
      filters.dateRange = 14;
    } else if (q.includes("last 30 days") || q.includes("last month")) {
      filters.dateRange = 30;
    } else if (
      q.includes("last 90 days") ||
      q.includes("last 3 months") ||
      q.includes("last quarter")
    ) {
      filters.dateRange = 90;
    } else if (q.includes("this week")) {
      filters.dateRange = 7;
    } else if (q.includes("this month")) {
      filters.dateRange = 30;
    }

    // Custom date range: "from jan 1 to jan 15" or "between jan 1 and jan 15"
    const dateRangeMatch = q.match(
      /(?:from|between)\s+(\w+\s+\d+)(?:\s+to|\s+and)\s+(\w+\s+\d+)/i
    );
    if (dateRangeMatch) {
      filters.startDate = dateRangeMatch[1];
      filters.endDate = dateRangeMatch[2];
    }

    // Metric filters
    if (
      q.includes("frr met") ||
      q.includes("frr = 1") ||
      q.includes("frr is 1") ||
      q.includes("high frr")
    ) {
      filters.frr = 1;
    } else if (
      q.includes("frr not met") ||
      q.includes("frr = 0") ||
      q.includes("frr is 0") ||
      q.includes("low frr") ||
      q.includes("no frr")
    ) {
      filters.frr = 0;
    }

    if (
      q.includes("good csat") ||
      q.includes("positive csat") ||
      q.includes("csat = 2")
    ) {
      filters.csat = 2;
    } else if (
      q.includes("bad csat") ||
      q.includes("negative csat") ||
      q.includes("csat = 1") ||
      q.includes("dsat")
    ) {
      filters.csat = 1;
    }

    if (q.includes("high rwt") || q.includes("rwt > ")) {
      const rwtMatch = q.match(/rwt\s*>\s*(\d+)/);
      filters.rwtGt = rwtMatch ? parseInt(rwtMatch[1]) : 50;
    }

    if (q.includes("low iterations") || q.includes("iterations = 1")) {
      filters.iterations = 1;
    } else if (q.includes("high iterations") || q.includes("iterations > ")) {
      const iterMatch = q.match(/iterations\s*>\s*(\d+)/);
      filters.iterationsGt = iterMatch ? parseInt(iterMatch[1]) : 3;
    }

    // Zendesk filter
    if (q.includes("zendesk") || q.includes("imported")) {
      filters.isZendesk = true;
    } else if (
      q.includes("exclude zendesk") ||
      q.includes("no zendesk") ||
      q.includes("devrev only")
    ) {
      filters.isZendesk = false;
    }

    // Solved/Closed
    if (
      q.includes("solved") ||
      q.includes("closed") ||
      q.includes("resolved")
    ) {
      filters.status = "solved";
    }

    return filters;
  };

  // Add this function to execute search:
  // const executeAdminSearch = async () => {
  //   if (!adminSearchQuery.trim()) return;

  //   setAdminSearchLoading(true);
  //   const filters = parseSearchQuery(adminSearchQuery);

  //   console.log("🔍 Parsed Query:", filters);

  //   try {
  //     const params = new URLSearchParams();
  //     if (filters.owner) params.set("owner", filters.owner);
  //     if (filters.dateRange) params.set("dateRange", filters.dateRange);
  //     if (filters.startDate) params.set("startDate", filters.startDate);
  //     if (filters.endDate) params.set("endDate", filters.endDate);
  //     if (filters.frr !== undefined) params.set("frr", filters.frr);
  //     if (filters.csat !== undefined) params.set("csat", filters.csat);
  //     if (filters.rwtGt) params.set("rwtGt", filters.rwtGt);
  //     if (filters.iterations) params.set("iterations", filters.iterations);
  //     if (filters.iterationsGt) params.set("iterationsGt", filters.iterationsGt);
  //     if (filters.isZendesk !== undefined) params.set("isZendesk", filters.isZendesk);

  //     const res = await fetch(
  //       `${import.meta.env.VITE_API_URL || ""}/api/admin/search?${params.toString()}`
  //     );
  //     const data = await res.json();

  //     console.log("📊 Search Results:", data);
  //     setAdminSearchResults(data);
  //   } catch (e) {
  //     console.error("Search failed:", e);
  //     setAdminSearchResults({ error: e.message });
  //   } finally {
  //     setAdminSearchLoading(false);
  //   }
  // };

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
        frrPercent: "frrMet",
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
    [filteredTrends]
  );

  // Resolve current user to GST roster name
  const resolvedCurrentUser = useMemo(() => {
    if (!currentUser?.name) return null;
    const cleanName = currentUser.name.toLowerCase().trim();
    return (
      Object.values(FLAT_TEAM_MAP).find(
        (name) =>
          cleanName.includes(name.toLowerCase()) ||
          name.toLowerCase().includes(cleanName)
      ) || currentUser.name
    );
  }, [currentUser]);

  const isGSTUser = useMemo(
    () =>
      resolvedCurrentUser &&
      Object.values(FLAT_TEAM_MAP).includes(resolvedCurrentUser),
    [resolvedCurrentUser]
  );

const isSuperAdmin = useMemo(() => {
  const email = currentUser?.email?.toLowerCase();
  return email
    ? SUPER_ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)
    : false;
}, [currentUser]);


  // Get user's team
  const myTeamName = useMemo(() => {
    const foundTeamKey = Object.keys(TEAM_GROUPS).find((groupKey) => {
      const groupMembers = Object.values(TEAM_GROUPS[groupKey]);
      return groupMembers.includes(resolvedCurrentUser);
    });
    return foundTeamKey ? `Team ${foundTeamKey}` : "Team Mashnu";
  }, [resolvedCurrentUser]);

  // GST-only user list for dropdowns
  const gstUserNames = useMemo(() => Object.values(FLAT_TEAM_MAP).sort(), []);

  const getExpandedChartData = useCallback(
    (metricKey) => {
      // Use expandedAllTrends instead of analyticsData?.trends
      const trends =
        expandedAllTrends.length > 0
          ? expandedAllTrends
          : analyticsData?.trends || [];
      if (!trends.length) return [];

      const end = new Date();
      const start = subDays(end, expandedTimeRange - 1);

      // Filter by date range
      const filteredData = trends.filter((t) => {
        if (!t.date) return false;
        const d = parseISO(t.date);
        return d >= start && d <= end;
      });

      const dataKeyMap = {
        avgRWT: "avgRWT",
        csat: "positiveCSAT",
        frrPercent: "frrMet", // This maps to frrMet in the trends data
        avgIterations: "avgIterations",
        avgFRT: "avgFRT",
      };
      const dataKey = dataKeyMap[metricKey] || "solved";

      // Group data based on expandedGroupBy
      if (expandedGroupBy === "daily") {
        return filteredData.map((t) => ({
          name: format(parseISO(t.date), "MMM dd"),
          date: t.date,
          value: t[dataKey] || 0,
        }));
      }

      if (expandedGroupBy === "weekly") {
        const weeks = {};
        filteredData.forEach((t) => {
          const weekKey = format(parseISO(t.date), "yyyy-'W'ww");
          if (!weeks[weekKey]) {
            weeks[weekKey] = { values: [], date: t.date };
          }
          weeks[weekKey].values.push(t[dataKey] || 0);
        });

        return Object.entries(weeks)
          .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
          .map(([week, data]) => ({
            name: `Week ${week.split("W")[1]}`,
            date: data.date,
            value: data.values.reduce((a, b) => a + b, 0) / data.values.length,
          }));
      }

      if (expandedGroupBy === "monthly") {
        const months = {};
        filteredData.forEach((t) => {
          const monthKey = format(parseISO(t.date), "yyyy-MM");
          if (!months[monthKey]) {
            months[monthKey] = { values: [], date: t.date };
          }
          months[monthKey].values.push(t[dataKey] || 0);
        });

        return Object.entries(months)
          .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
          .map(([month, data]) => ({
            name: format(parseISO(data.date), "MMM yyyy"),
            date: data.date,
            value: data.values.reduce((a, b) => a + b, 0) / data.values.length,
          }));
      }

      return [];
    },
    [expandedAllTrends, analyticsData, expandedTimeRange, expandedGroupBy]
  );
  // Get period total
  const getExpandedPeriodTotal = useCallback(
    (metricKey) => {
      const chartData = getExpandedChartData(metricKey);
      if (!chartData.length) return "—";

      const total = chartData.reduce((sum, d) => sum + (d.value || 0), 0);

      // For averages, return the average not total
      if (["avgRWT", "avgFRT", "avgIterations"].includes(metricKey)) {
        return (total / chartData.length).toFixed(2);
      }

      return Math.round(total).toLocaleString();
    },
    [getExpandedChartData]
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
    [getExpandedChartData]
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
        metricKey
      );
      const isPositive = lowerIsBetter ? change < 0 : change > 0;

      return {
        value: `${change > 0 ? "+" : ""}${change}%`,
        isPositive,
      };
    },
    [getExpandedChartData]
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
    [analyticsData, selectedUsers, timeRange]
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
    [analyticsData, myTeamName, timeRange]
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
    [analyticsData, timeRange]
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
            groupBy === "monthly" ? "MMM" : "MMM dd"
          ),
          date,
        };

        // Add selected users data
        selectedUsers.forEach((user) => {
          const userDay = (analyticsData.individualTrends[user] || []).find(
            (d) => d.date === date
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
            }
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
    ]
  );

  // Initialize selected users with current user if GST
  useEffect(() => {
    if (isGSTUser && resolvedCurrentUser && selectedUsers.length === 0) {
      setSelectedUsers([resolvedCurrentUser]);
    }
  }, [isGSTUser, resolvedCurrentUser]);

  // Fetch server-side analytics
  useEffect(() => {
    fetchAnalyticsData({
      quarter: currentQuarter,
      excludeZendesk,
      owner: filterOwner !== "All" ? filterOwner : null,
      groupBy,
    });
  }, [
    currentQuarter,
    excludeZendesk,
    filterOwner,
    fetchAnalyticsData,
    groupBy,
  ]);

  // Fetch ALL historical data for expanded view (ignores quarter selection)
  useEffect(() => {
    const fetchAllTrends = async () => {
      if (!expandedOverviewMetric) return;

      setExpandedLoading(true);
      try {
        // Fetch Q4_25 + Q1_26 data (or use "all" if your API supports it)
        const [q4Res, q1Res] = await Promise.all([
          fetch(
            `${
              import.meta.env.VITE_API_URL || ""
            }/api/tickets/analytics?quarter=Q4_25&excludeZendesk=${excludeZendesk}`
          ).then((r) => r.json()),
          fetch(
            `${
              import.meta.env.VITE_API_URL || ""
            }/api/tickets/analytics?quarter=Q1_26&excludeZendesk=${excludeZendesk}`
          ).then((r) => r.json()),
        ]);

        // Combine trends from both quarters
        const allTrends = [...(q4Res.trends || []), ...(q1Res.trends || [])];

        // Sort by date
        allTrends.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Remove duplicates (by date)
        const uniqueTrends = allTrends.filter(
          (t, i, arr) => i === 0 || t.date !== arr[i - 1].date
        );

        setExpandedAllTrends(uniqueTrends);
      } catch (e) {
        console.error("Failed to fetch expanded data:", e);
      } finally {
        setExpandedLoading(false);
      }
    };

    fetchAllTrends();
  }, [expandedOverviewMetric, excludeZendesk]);

  const handleQuarterChange = useCallback(
    (quarter) => setCurrentQuarter(quarter),
    []
  );
  const handleRefresh = () =>
    fetchAnalyticsData({
      quarter: currentQuarter,
      excludeZendesk,
      forceRefresh: true,
    });

  const smallChartData = useMemo(() => {
    // Process volume from filtered tickets
    const volumeData = (() => {
      const daysInterval = eachDayOfInterval({
        start: effectiveDateRange.start,
        end: effectiveDateRange.end,
      });

      return daysInterval.map((day) => {
        const dateKey = format(day, "yyyy-MM-dd");
        const dayTickets = filteredTickets.filter((t) => {
          const ticketDate = format(parseISO(t.created_date), "yyyy-MM-dd");
          return ticketDate === dateKey;
        });
        return {
          name: format(day, "MMM dd"),
          date: dateKey,
          main: dayTickets.length,
        };
      });
    })();

    return {
      volume: volumeData,
      solved: filteredTrends.map((t) => ({
        name: format(parseISO(t.date), "MMM dd"),
        date: t.date,
        main: t.solved || 0,
      })),
      rwt: filteredTrends.map((t) => ({
        name: format(parseISO(t.date), "MMM dd"),
        date: t.date,
        main: t.avgRWT ? Number(t.avgRWT.toFixed(1)) : 0,
      })),
      backlog: filteredTrends.map((t) => ({
        name: format(parseISO(t.date), "MMM dd"),
        date: t.date,
        main: t.backlogCleared || 0,
      })),
    };
  }, [filteredTickets, filteredTrends, effectiveDateRange]);

  // Compute stats from filtered date range
  const filteredStats = useMemo(() => {
    // Use server stats directly if available (they're calculated correctly)
    const serverStats = analyticsData?.stats;

    if (serverStats && !filteredTrends.length) {
      return serverStats;
    }

    // If we have filtered trends, recalculate
    if (!filteredTrends.length && !filteredTickets.length) {
      return serverStats || {};
    }

    // Sum up daily values
    const totalSolved = filteredTrends.reduce(
      (sum, t) => sum + (t.solved || 0),
      0
    );

    // For averages, we need weighted average based on tickets per day
    let totalRWT = 0,
      rwtCount = 0;
    let totalFRT = 0,
      frtCount = 0;
    let totalIterations = 0,
      iterCount = 0;

    filteredTrends.forEach((t) => {
      if (t.avgRWT && t.solved) {
        totalRWT += t.avgRWT * t.solved;
        rwtCount += t.solved;
      }
      if (t.avgFRT && t.solved) {
        totalFRT += t.avgFRT * t.solved;
        frtCount += t.solved;
      }
      if (t.avgIterations && t.solved) {
        totalIterations += t.avgIterations * t.solved;
        iterCount += t.solved;
      }
    });

    const avgRWT = rwtCount > 0 ? totalRWT / rwtCount : 0;
    const avgFRT = frtCount > 0 ? totalFRT / frtCount : 0;
    const avgIterations = iterCount > 0 ? totalIterations / iterCount : 0;

    // CSAT and FRR are counts, not averages
    const positiveCSAT = filteredTrends.reduce(
      (sum, t) => sum + (t.positiveCSAT || 0),
      0
    );
    const frrMet = filteredTrends.reduce((sum, t) => sum + (t.frrMet || 0), 0);

    // FRR percentage should be frrMet / totalSolved (tickets), not days
    const frrPercent =
      totalSolved > 0 ? Math.round((frrMet / totalSolved) * 100) : 0;

    return {
      totalTickets: totalSolved || filteredTickets.length,
      avgRWT: avgRWT.toFixed(2),
      avgFRT: avgFRT.toFixed(2),
      avgIterations: avgIterations.toFixed(1),
      positiveCSAT,
      frrPercent,
      // Include raw counts for debugging
      _debug: {
        frrMet,
        totalSolved,
        daysCount: filteredTrends.length,
      },
    };
  }, [filteredTrends, filteredTickets, analyticsData]);

  // Expanded chart data
  const expandedData = useMemo(() => {
    if (!expandedMetric) return [];

    const individualTrends = analyticsData?.individualTrends || {};

    // For VOLUME - use real-time tickets with created_date
    if (expandedMetric === "volume") {
      const end = new Date();
      const start = subDays(end, 30);
      const daysInterval = eachDayOfInterval({ start, end });

      return daysInterval.map((day) => {
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
            const teamMembers = TEAM_GROUPS[myTeamName?.replace("Team ", "")]
              ? Object.values(TEAM_GROUPS[myTeamName.replace("Team ", "")])
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
    }

    // For SOLVED, RWT, BACKLOG - use server individualTrends
    const allDates = new Set();
    selectedUsers.forEach((user) => {
      (individualTrends[user] || []).forEach((d) => allDates.add(d.date));
    });

    const sortedDates = Array.from(allDates).sort().slice(-30);

    return sortedDates.map((date) => {
      const dataPoint = { name: format(parseISO(date), "MMM dd"), date };

      selectedUsers.forEach((user) => {
        const userDay = (individualTrends[user] || []).find(
          (d) => d.date === date
        );
        if (expandedMetric === "solved") {
          dataPoint[user] = userDay?.solved || 0;
        } else if (expandedMetric === "rwt") {
          dataPoint[user] = userDay?.avgRWT
            ? Number(userDay.avgRWT.toFixed(2))
            : 0;
        } else if (expandedMetric === "backlog") {
          dataPoint[user] = userDay?.backlogCleared || 0;
        }
      });

      // Team & GST totals
      if (showTeam || showGST) {
        let teamTotal = 0,
          gstTotal = 0;
        const teamMembers = TEAM_GROUPS[myTeamName?.replace("Team ", "")]
          ? Object.values(TEAM_GROUPS[myTeamName.replace("Team ", "")])
          : [];

        Object.entries(individualTrends).forEach(([user, days]) => {
          const dayData = days.find((d) => d.date === date);
          if (dayData) {
            const val =
              expandedMetric === "solved"
                ? dayData.solved
                : expandedMetric === "rwt"
                ? dayData.avgRWT
                : expandedMetric === "backlog"
                ? dayData.backlogCleared
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
  }, [
    analyticsData,
    expandedMetric,
    selectedUsers,
    showTeam,
    showGST,
    myTeamName,
    tickets,
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

            <button
              onClick={() => setShowAdminConsole(true)}
              className="
    flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all
    bg-white text-slate-700 border border-slate-200 hover:border-emerald-400 hover:text-emerald-600
    dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:border-emerald-500 dark:hover:text-emerald-400
    shadow-sm hover:shadow-md
  "
            >
              <Search className="w-4 h-4" />
              Query
            </button>
          </div>
        </div>
      )}
      {/* ADMIN QUERY CONSOLE - FULLSCREEN MODAL */}
      {showAdminConsole && isSuperAdmin && (
        <div
          className="fixed inset-0 z-[200] flex flex-col
  bg-white text-slate-900
  dark:bg-slate-950 dark:text-slate-100
"
        >
          {/* Header */}
          <div
            className="
  flex items-center justify-between px-6 py-4 border-b
  bg-white border-slate-200
  dark:bg-slate-900 dark:border-slate-800
"
          >
            <div className="flex items-center gap-4">
              <Terminal className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-white">
                Admin Query Console
              </h2>
            </div>
            <button
              onClick={() => setShowAdminConsole(false)}
              className="p-2 hover:bg-slate-800 rounded-lg"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
          {/* Query Input Area */}
          <div
            className="
  px-6 py-4 border-b
  bg-slate-50 border-slate-200
  dark:bg-slate-900/50 dark:border-slate-800
"
          >
            {adminQueryMode === "natural" ? (
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                    <input
                      type="text"
                      value={adminQuery}
                      onChange={(e) => setAdminQuery(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && executeAdminSearch(1)
                      }
                      placeholder="e.g., 'Rohan tickets from jan 01 2026 - jan 15 2026' or 'tickets where frr met last 30 days'"
                      className="
  w-full pl-12 pr-4 py-3 rounded-xl text-sm
  bg-slate-50 dark:bg-slate-900/50
  border border-slate-200 dark:border-slate-800
  text-slate-900 dark:text-white
  placeholder:text-slate-700 dark:placeholder:text-slate-400
  focus:outline-none focus:ring-2 focus:ring-indigo-500
"
                    />
                  </div>
                  <button
                    onClick={() => executeAdminSearch(1)}
                    disabled={adminLoading}
                    className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2 min-w-[120px] justify-center"
                  >
                    {adminLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    Execute
                  </button>
                </div>

                {/* Quick Examples */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Examples:</span>
                  {[
                    "Rohan tickets last 7 days",
                    "tickets where frr met",
                    "Adarsh from jan 01 2026 - jan 15 2026",
                    "good csat last 30 days",
                    "high rwt > 50",
                    "exclude zendesk",
                    "iterations > 3",
                  ].map((example) => (
                    <button
                      key={example}
                      onClick={() => setAdminQuery(example)}
                      className="px-2.5 py-1 border-b border-slate-200 dark:border-slate-800 
  bg-slate-50 dark:bg-slate-900/50 text-slate-400 rounded-lg text-xs hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <textarea
                      value={adminRawQuery}
                      onChange={(e) => setAdminRawQuery(e.target.value)}
                      placeholder='{"owner": {"$regex": "rohan", "$options": "i"}, "closed_date": {"$gte": "2026-01-01"}}'
                      className="w-full h-32 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-emerald-400 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600 resize-none"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => executeAdminSearch(1)}
                      disabled={adminLoading}
                      className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2"
                    >
                      {adminLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      Execute
                    </button>
                    <button
                      onClick={copyQuery}
                      className="px-6 py-3 bg-slate-800 text-slate-300 rounded-xl text-sm font-bold hover:bg-slate-700 flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copy
                    </button>
                  </div>
                </div>

                {/* Query Templates */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Templates:</span>
                  {[
                    {
                      label: "By Owner",
                      query: '{"owner": {"$regex": "name", "$options": "i"}}',
                    },
                    {
                      label: "Date Range",
                      query:
                        '{"closed_date": {"$gte": "2026-01-01", "$lte": "2026-01-15"}}',
                    },
                    { label: "FRR Met", query: '{"frr": 1}' },
                    { label: "Good CSAT", query: '{"csat": 2}' },
                    { label: "High RWT", query: '{"rwt": {"$gte": 50}}' },
                    {
                      label: "No Zendesk",
                      query: '{"is_zendesk": {"$ne": true}}',
                    },
                  ].map((tpl) => (
                    <button
                      key={tpl.label}
                      onClick={() => setAdminRawQuery(tpl.query)}
                      className="px-2.5 py-1 bg-slate-800 text-slate-400 rounded-lg text-xs hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Results Area */}
          <div className="flex-1 overflow-auto p-6">
            {adminResults?.error ? (
              <div className="p-6 bg-rose-900/20 border border-rose-500/30 rounded-xl text-rose-400">
                <div className="font-bold mb-2">Error</div>
                <div className="text-sm">{adminResults.error}</div>
              </div>
            ) : adminResults ? (
              <div className="space-y-4">
               
                {/* Stats Cards */}
                <div className="grid grid-cols-7 gap-3">
                  <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-500 mb-1">
                      Total Tickets
                    </div>
                    <div className="text-2xl font-bold text-slate-800 dark:text-white">
                      {adminResults.stats?.totalTickets || 0}
                    </div>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">Avg RWT</div>
                    <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                      {adminResults.stats?.avgRWT?.toFixed(2) || 0}
                      <span className="text-sm font-normal text-slate-500 ml-1">
                        hrs
                      </span>
                    </div>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">Avg FRT</div>
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {adminResults.stats?.avgFRT?.toFixed(2) || 0}
                      <span className="text-sm font-normal text-slate-500 ml-1">
                        hrs
                      </span>
                    </div>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">FRR Met</div>
                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                      {adminResults.stats?.frrMetCount || 0}
                      <span className="text-sm font-normal text-slate-500">
                        /{adminResults.stats?.totalTickets || 0}
                      </span>
                    </div>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">Good CSAT</div>
                    <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {adminResults.stats?.goodCSATCount || 0}
                    </div>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">Bad CSAT</div>
                    <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                      {adminResults.stats?.badCSATCount || 0}
                    </div>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">
                      Avg Iterations
                    </div>
                    <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">
                      {adminResults.stats?.avgIterations?.toFixed(1) || 0}
                    </div>
                  </div>
                </div>

                {/* Query Display & Actions */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <button
                      onClick={() => setQueryCollapsed(!queryCollapsed)}
                      className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 mb-2"
                    >
                      <ChevronRight
                        className={`w-4 h-4 transition-transform ${
                          !queryCollapsed ? "rotate-90" : ""
                        }`}
                      />
                      MongoDB Query {!queryCollapsed && "(editable)"}
                    </button>
                    {!queryCollapsed && (
                      <div className="p-3 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                        <textarea
                          value={
                            editableQuery ||
                            JSON.stringify(adminResults.query || {}, null, 2)
                          }
                          onChange={(e) => setEditableQuery(e.target.value)}
                          className="w-full h-32 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-emerald-600 dark:text-emerald-400 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button
                          onClick={() => {
                            try {
                              const parsed = JSON.parse(editableQuery);
                              setAdminRawQuery(editableQuery);
                              executeAdminSearch(1);
                            } catch (e) {
                              alert("Invalid JSON: " + e.message);
                            }
                          }}
                          className="mt-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-500"
                        >
                          Run Edited Query
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Download Buttons */}
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => downloadResults("csv")}
                      disabled={!adminResults.tickets?.length}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Download CSV
                    </button>
                    <button
                      onClick={() => downloadResults("json")}
                      disabled={!adminResults.tickets?.length}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-500 disabled:opacity-50"
                    >
                      <FileJson className="w-4 h-4" />
                      Download JSON
                    </button>
                  </div>
                </div>

               
                {/* Pagination */}
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    Showing {(adminPage - 1) * adminPageSize + 1} -{" "}
                    {Math.min(adminPage * adminPageSize, adminTotalCount)} of{" "}
                    {adminTotalCount} tickets
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={adminPageSize}
                      onChange={(e) => {
                        setAdminPageSize(Number(e.target.value));
                        executeAdminSearch(1);
                      }}
                      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-700 dark:text-white"
                    >
                      <option value={25}>25 per page</option>
                      <option value={50}>50 per page</option>
                      <option value={100}>100 per page</option>
                      <option value={200}>200 per page</option>
                    </select>
                    <button
                      onClick={() => executeAdminSearch(adminPage - 1)}
                      disabled={adminPage <= 1 || adminLoading}
                      className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 border border-slate-200 dark:border-transparent"
                    >
                      <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-white" />
                    </button>
                    <span className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm text-slate-700 dark:text-white border border-slate-200 dark:border-transparent">
                      Page {adminPage} of{" "}
                      {Math.ceil(adminTotalCount / adminPageSize) || 1}
                    </span>
                    <button
                      onClick={() => executeAdminSearch(adminPage + 1)}
                      disabled={
                        adminPage >=
                          Math.ceil(adminTotalCount / adminPageSize) ||
                        adminLoading
                      }
                      className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 border border-slate-200 dark:border-transparent"
                    >
                      <ChevronRight className="w-4 h-4 text-slate-600 dark:text-white" />
                    </button>
                  </div>
                </div>

                {/* Tickets Table */}
                {adminResults.tickets?.length > 0 ? (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="overflow-auto max-h-[calc(100vh-500px)]">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0">
  <tr>
    <th className="px-4 py-3 text-left text-slate-600 dark:text-slate-400 font-medium">
      Ticket ID
    </th>
    <th className="px-4 py-3 text-left text-slate-600 dark:text-slate-400 font-medium">
      Title
    </th>
    <th className="px-4 py-3 text-left text-slate-600 dark:text-slate-400 font-medium">
      Owner
    </th>
    <th className="px-4 py-3 text-left text-slate-600 dark:text-slate-400 font-medium">
      Closed
    </th>
    <th className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-medium">
      RWT
    </th>
    <th className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-medium">
      FRT
    </th>
    <th className="px-4 py-3 text-center text-slate-600 dark:text-slate-400 font-medium">
      FRR
    </th>
    <th className="px-4 py-3 text-center text-slate-600 dark:text-slate-400 font-medium">
      CSAT
    </th>
    <th className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-medium">
      Iter
    </th>
    <th className="px-4 py-3 text-left text-slate-600 dark:text-slate-400 font-medium">
      Region
    </th>
  </tr>
</thead>

                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
  {adminResults.tickets.map((t, i) => (
    <tr key={t.ticket_id || i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <td className="px-4 py-3">
        <a 
          href={`https://app.devrev.ai/clevertap/works/${t.ticket_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 dark:text-indigo-400 font-mono hover:underline"
        >
          {t.ticket_id || t.display_id}
        </a>
      </td>
      <td className="px-4 py-3 text-slate-800 dark:text-white max-w-[300px] truncate" title={t.title}>
        {t.title}
      </td>
      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{t.owner}</td>
      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
        {t.closed_date ? format(new Date(t.closed_date), "MMM dd, yyyy") : "-"}
      </td>
      <td className="px-4 py-3 text-right">
        <span className={t.rwt > 50 ? "text-rose-600 dark:text-rose-400" : t.rwt > 24 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
          {t.rwt?.toFixed(1) || "-"}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className={t.frt > 4 ? "text-rose-600 dark:text-rose-400" : t.frt > 2 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
          {t.frt?.toFixed(1) || "-"}
        </span>
      </td>
      <td className="px-4 py-3 text-center">
        {t.frr === 1 ? (
          <span className="inline-flex items-center justify-center w-6 h-6 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full">✓</span>
        ) : (
          <span className="inline-flex items-center justify-center w-6 h-6 bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-full">✗</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        {t.csat === 2 ? (
          <span className="text-lg">👍</span>
        ) : t.csat === 1 ? (
          <span className="text-lg">👎</span>
        ) : (
          <span className="text-slate-400">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-right text-cyan-600 dark:text-cyan-400">{t.iterations || "-"}</td>
      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">{t.region || "-"}</td>
    </tr>
  ))}
</tbody>

                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="p-12 text-center text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800">
                    <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <div className="text-lg font-medium">No tickets found</div>
                    <div className="text-sm mt-1">
                      Try adjusting your search query
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500">
                <div className="text-center">
                  <Terminal className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <div className="text-lg font-medium">
                    Enter a query to search tickets
                  </div>
                  <div className="text-sm mt-2">
                    Use natural language or raw MongoDB queries
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <PerformanceMetricsCards
        stats={filteredStats}
        trends={filteredTrends}
        currentQuarter={currentQuarter}
        currentGroupBy={groupBy}
        onQuarterChange={handleQuarterChange}
        excludeZendesk={excludeZendesk}
        onExcludeZendeskChange={() => setExcludeZendesk(!excludeZendesk)}
        onRefresh={handleRefresh}
        isRefreshing={analyticsLoading}
        onExpandMetric={(metricKey) => setExpandedOverviewMetric(metricKey)} // ADD THIS
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

      {/* 4 METRIC CHARTS */}
      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-8 mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5 text-indigo-500" /> Performance Analytics
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(METRICS).map(([key, config]) => (
          <div
            key={key}
            className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 relative group hover:border-indigo-500/30 transition-colors"
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
                      borderRadius: "8px",
                      border: "none",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="main"
                    stroke={config.color}
                    fill={`url(#grad-${key})`}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
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
                    }
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
                onClick={() => setExpandedOverviewMetric(null)}
                className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            {/* Controls Bar */}
            <div className="px-8 py-4 bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-4">
              {/* Date Range Selector */}
              <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <Calendar className="w-4 h-4 text-slate-400" />
                <select
                  className="bg-transparent text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer min-w-[140px]"
                  value={expandedTimeRange}
                  onChange={(e) => setExpandedTimeRange(Number(e.target.value))}
                >
                  <option value={7}>Last 7 Days</option>
                  <option value={14}>Last 14 Days</option>
                  <option value={30}>Last 30 Days</option>
                  <option value={60}>Last 60 Days</option>
                  <option value={90}>Last 90 Days</option>
                </select>
              </div>

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
              <div className="ml-auto text-sm text-slate-500 flex items-center gap-2">
                <span className="font-medium">{expandedTimeRange} days</span>
                <span>•</span>
                <span>
                  {format(subDays(new Date(), expandedTimeRange - 1), "MMM dd")}{" "}
                  - {format(new Date(), "MMM dd, yyyy")}
                </span>
              </div>
            </div>

            {/* Stats Summary Cards */}
            <div className="px-8 py-5 bg-white dark:bg-slate-900/50">
              <div className="grid grid-cols-4 gap-5">
                <div className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-700">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Current Value
                  </div>
                  <div
                    className="text-4xl font-black"
                    style={{
                      color: OVERVIEW_METRICS[expandedOverviewMetric].color,
                    }}
                  >
                    {filteredStats[
                      OVERVIEW_METRICS[expandedOverviewMetric].dataKey
                    ] || "—"}
                    <span className="text-lg font-normal text-slate-400 ml-1">
                      {OVERVIEW_METRICS[expandedOverviewMetric].unit}
                    </span>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-white dark:from-blue-900/20 dark:to-slate-900 rounded-2xl p-5 border border-blue-100 dark:border-blue-900/50">
                  <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">
                    Period Total
                  </div>
                  <div className="text-4xl font-black text-blue-600">
                    {getExpandedPeriodTotal(expandedOverviewMetric)}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/20 dark:to-slate-900 rounded-2xl p-5 border border-emerald-100 dark:border-emerald-900/50">
                  <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-2">
                    {expandedGroupBy === "daily"
                      ? "Daily"
                      : expandedGroupBy === "weekly"
                      ? "Weekly"
                      : "Monthly"}{" "}
                    Average
                  </div>
                  <div className="text-4xl font-black text-emerald-600">
                    {getExpandedAverage(expandedOverviewMetric)}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-violet-50 to-white dark:from-violet-900/20 dark:to-slate-900 rounded-2xl p-5 border border-violet-100 dark:border-violet-900/50">
                  <div className="text-xs font-bold text-violet-600 uppercase tracking-wider mb-2">
                    Trend
                  </div>
                  <div
                    className={`text-4xl font-black ${
                      getExpandedTrend(expandedOverviewMetric).isPositive
                        ? "text-emerald-500"
                        : "text-rose-500"
                    }`}
                  >
                    {getExpandedTrend(expandedOverviewMetric).value}
                    {getExpandedTrend(expandedOverviewMetric).isPositive ? (
                      <TrendingUp className="inline w-6 h-6 ml-2" />
                    ) : (
                      <TrendingDown className="inline w-6 h-6 ml-2" />
                    )}
                  </div>
                </div>
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
                      formatter={(value, name) => [
                        <span
                          className="text-lg font-bold"
                          style={{
                            color:
                              OVERVIEW_METRICS[expandedOverviewMetric].color,
                          }}
                        >
                          {typeof value === "number" ? value.toFixed(2) : value}{" "}
                          {OVERVIEW_METRICS[expandedOverviewMetric].unit}
                        </span>,
                        OVERVIEW_METRICS[expandedOverviewMetric].label,
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={OVERVIEW_METRICS[expandedOverviewMetric].color}
                      fill="url(#expandedAreaGrad)"
                      strokeWidth={3}
                      dot={{
                        fill: OVERVIEW_METRICS[expandedOverviewMetric].color,
                        strokeWidth: 0,
                        r: 5,
                      }}
                      activeDot={{
                        r: 8,
                        strokeWidth: 3,
                        stroke: "#fff",
                        fill: OVERVIEW_METRICS[expandedOverviewMetric].color,
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
              <div className="relative group">
                <button className="flex items-center gap-2 bg-white dark:bg-slate-900 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-500 transition-all min-w-[220px] justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {selectedUsers.length > 0
                        ? `${selectedUsers.length} Users Selected`
                        : "Select Users..."}
                    </span>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </button>

                <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-2 hidden group-hover:block max-h-[60vh] overflow-y-auto z-[60]">
                  {gstUserNames.map((user) => (
                    <label
                      key={user}
                      className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user)}
                        onChange={(e) => {
                          if (e.target.checked)
                            setSelectedUsers([...selectedUsers, user]);
                          else
                            setSelectedUsers(
                              selectedUsers.filter((u) => u !== user)
                            );
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-200">
                        {user}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Time Range */}
              <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <Calendar className="w-4 h-4 text-slate-400" />
                <select
                  className="bg-transparent text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
                  value={timeRange}
                  onChange={(e) => setTimeRange(Number(e.target.value))}
                >
                  <option value={7}>Last 7 Days</option>
                  <option value={14}>Last 14 Days</option>
                  <option value={30}>Last 30 Days</option>
                  <option value={90}>Last 3 Months</option>
                </select>
              </div>

              <div className="h-8 w-px bg-slate-300 dark:bg-slate-700 mx-2"></div>

              <button
                onClick={() => setShowTeam(!showTeam)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${
                  showTeam
                    ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 text-indigo-600"
                    : "border-transparent text-slate-500 hover:bg-slate-100"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full border ${
                    showTeam
                      ? "bg-indigo-500 border-indigo-500"
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
                myTeamName={myTeamName}
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
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
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
                      stroke="#6366f1"
                      fill="none"
                      strokeWidth={3}
                    />
                  )}
                  {showGST && (
                    <Area
                      type="monotone"
                      dataKey="compare_gst"
                      name="GST Total"
                      stroke="#10b981"
                      fill="none"
                      strokeWidth={3}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
