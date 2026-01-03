import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  format,
  subDays,
  eachDayOfInterval,
  isSameDay,
  parseISO,
  differenceInHours,
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
  LineChart,
  Line,
  BarChart,
} from "recharts";
import {
  CheckCircle,
  Maximize2,
  X,
  Sparkles,
  ArrowUpRight,
  Activity,
  Trophy,
  Users,
  User,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  TrendingDown,
  ArchiveRestore,
  Layers,
  AlertCircle,
  ExternalLink,
  Frown,
  Smile,
  Crown,
  Medal,
} from "lucide-react";
import axios from "axios";
import { getCSATStatus, FLAT_TEAM_MAP, TEAM_GROUPS } from "../utils";
import { useTicketStore } from "../store";
import { differenceInDays } from "date-fns";

const HIDDEN_USERS = [
  "System",
  "DevRev Bot",
  "A",
  "V",
  "n",
  "Undefined",
  "null",
];

// ✅ 4th Chart is now Backlog Clearance
const METRICS = {
  volume: {
    label: "Incoming Volume",
    icon: ArrowUpRight,
    color: "#6366f1",
    desc: "Tickets Created",
  },
  solved: {
    label: "Throughput",
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
// ============================================================================
// 2. DATA PROCESSING ENGINE
// ============================================================================

// [Existing METRICS object remains here...]

// 1. UPDATED: Handles "All" subject for Global View
// 1. OPTIMIZED: High Performance Date Indexing (Fixes Lag)
const processChartData = (tickets, metric, timeRange, subject, currentUser) => {
  if (!tickets || tickets.length === 0) return [];

  const end = new Date();
  const start = subDays(end, timeRange);
  const daysInterval = eachDayOfInterval({ start, end });

  // A. IDENTIFY SUBJECT
  let subjectName = subject === "Me" ? currentUser?.name : subject;
  const isGlobal = subject === "All";

  const isTeam = TEAM_GROUPS[subjectName];

  // B. INDEXING: Group tickets by Date first (The Speed Fix)
  const ticketsByDate = {};
  const getTicketDate = (t) =>
    metric === "volume" ? t.created_date : t.actual_close_date;

  // Single pass through data (O(N))
  for (const t of tickets) {
    // 1. Subject Filter
    if (!isGlobal) {
      const owner =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "";
      // TEAM selected → match any team member
      if (isTeam) {
        const teamMembers = Object.values(TEAM_GROUPS[subjectName]);
        if (!teamMembers.some((m) => owner.includes(m))) continue;
      }
      // INDIVIDUAL selected
      else {
        if (!owner.toLowerCase().includes(subjectName?.toLowerCase())) continue;
      }
    }

    // 2. Date Indexing
    const dateRaw = getTicketDate(t);
    if (!dateRaw) continue;
    const dateKey = format(parseISO(dateRaw), "yyyy-MM-dd");

    if (!ticketsByDate[dateKey]) ticketsByDate[dateKey] = [];
    ticketsByDate[dateKey].push(t);
  }

  // Helper for Values
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
    if (metric === "csat")
      return getCSATStatus(t) === "Good"
        ? 100
        : getCSATStatus(t) === "Bad"
        ? 0
        : null;
    return 0;
  };

  // C. BUILD DATASET (Instant Lookup)
  return daysInterval.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const dailyTickets = ticketsByDate[dateKey] || [];

    const subjectValues = dailyTickets
      .map(getTicketValue)
      .filter((v) => v !== null);

    let mainVal = 0;
    if (metric === "rwt" || metric === "csat") {
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

// 2. NEW HELPER: For Expanded Multi-User Plotting
// 2. UPDATED HELPER: Multi-User with Correct Averages
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

  // Metric Helpers
  const getTicketDate = (t) =>
    metric === "volume" ? t.created_date : t.actual_close_date;
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

  // Identify Team Members (for Team Avg)
  const teamMembers =
    currentUserTeamName && TEAM_GROUPS[currentUserTeamName]
      ? Object.values(TEAM_GROUPS[currentUserTeamName])
      : [];

  return daysInterval.map((day) => {
    const dailyTickets = tickets.filter((t) => {
      const d = getTicketDate(t);
      return d && isSameDay(parseISO(d), day);
    });

    let dataPoint = { name: format(day, "MMM dd"), date: day };

    // A. Plot Selected Users
    selectedUsers.forEach((user) => {
      const userTickets = dailyTickets.filter((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        return owner === user;
      });
      const values = userTickets.map(getTicketValue).filter((v) => v !== null);

      if (metric === "rwt" || metric === "csat") {
        dataPoint[user] = values.length
          ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
          : 0;
      } else {
        dataPoint[user] = values.reduce((a, b) => a + b, 0);
      }
    });

    // C. Calculate "Team" & "GST" (Raw Sums)
    if (showTeam || showGST) {
      const teamTickets = dailyTickets.filter((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        return teamMembers.some((m) => owner.includes(m));
      });
      const gstTickets = dailyTickets; // GST = Everyone

      if (showTeam) {
        const teamVals = teamTickets
          .map(getTicketValue)
          .filter((v) => v !== null);
        // RAW SUM for Volume/Solved/Backlog
        if (
          metric === "volume" ||
          metric === "solved" ||
          metric === "backlog"
        ) {
          dataPoint["compare_team"] = teamVals.reduce((a, b) => a + b, 0);
        } else {
          // Avg for RWT/CSAT
          dataPoint["compare_team"] = teamVals.length
            ? Math.round(teamVals.reduce((a, b) => a + b, 0) / teamVals.length)
            : 0;
        }
      }

      if (showGST) {
        const gstVals = gstTickets
          .map(getTicketValue)
          .filter((v) => v !== null);
        // RAW SUM for Volume/Solved/Backlog
        if (
          metric === "volume" ||
          metric === "solved" ||
          metric === "backlog"
        ) {
          dataPoint["compare_gst"] = gstVals.reduce((a, b) => a + b, 0);
        } else {
          // Avg for RWT/CSAT
          dataPoint["compare_gst"] = gstVals.length
            ? Math.round(gstVals.reduce((a, b) => a + b, 0) / gstVals.length)
            : 0;
        }
      }
    }

    return dataPoint;
  });
};

const processComparisonData = (
  tickets,
  timeRange,
  mode,
  selectedUsers,
  currentUser,
  filterOwner
) => {
  // 1. Define Time Range
  const end = new Date();
  const start = subDays(end, timeRange);
  const daysInterval = eachDayOfInterval({ start, end });

  // 2. Helper to check name matches
  const isMatch = (ticketOwner, targetName) => {
    if (!targetName || targetName === "All") return true;
    if (!ticketOwner) return false;
    const tName = ticketOwner.toLowerCase();
    const uName = targetName.toLowerCase();
    return tName.includes(uName) || uName.includes(tName);
  };

  const mainUserName =
    filterOwner && filterOwner !== "All" ? filterOwner : currentUser?.name;

  // 3. Count Helper
  const getCount = (date, userToMatch) => {
    return tickets.filter((t) => {
      if (!t.created_date || !isSameDay(parseISO(t.created_date), date))
        return false;
      const ownerName =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "";
      return isMatch(ownerName, userToMatch);
    }).length;
  };

  // 4. Group Average Helper
  const getGroupAvg = (date, groupType) => {
    let groupMembers = [];
    if (groupType === "gst") {
      groupMembers = Object.values(FLAT_TEAM_MAP);
    } else if (groupType === "team") {
      const teamName = Object.keys(TEAM_GROUPS).find((key) =>
        Object.values(TEAM_GROUPS[key]).some((member) =>
          isMatch(member, mainUserName)
        )
      );
      groupMembers = teamName ? Object.values(TEAM_GROUPS[teamName]) : [];
    }

    const totalTickets = tickets.filter((t) => {
      if (!t.created_date || !isSameDay(parseISO(t.created_date), date))
        return false;
      const owner =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "";
      return groupMembers.some((m) => isMatch(owner, m));
    }).length;

    return groupMembers.length
      ? Math.round((totalTickets / groupMembers.length) * 10) / 10
      : 0;
  };

  // 5. Build Dataset
  return daysInterval.map((day) => {
    const dayLabel = format(day, "MMM dd");
    const mainValue =
      mode === "users" && selectedUsers.length === 1
        ? getCount(day, selectedUsers[0])
        : getCount(day, mainUserName);

    let dataPoint = {
      name: dayLabel,
      main: mainValue,
      date: day,
      // Dynamic keys for multi-user comparison will be added below
    };

    if (mode === "time") {
      const prevDate = subDays(day, timeRange);
      dataPoint["compare_prev"] = getCount(prevDate, mainUserName);
      dataPoint["label_prev"] = `Prev ${timeRange} Days`;
    } else if (mode === "team") {
      dataPoint["compare_team"] = getGroupAvg(day, "team");
      dataPoint["label_team"] = "Team Avg";
    } else if (mode === "gst") {
      dataPoint["compare_gst"] = getGroupAvg(day, "gst");
      dataPoint["label_gst"] = "GST Avg";
    } else if (mode === "users" && selectedUsers.length > 0) {
      // Loop through selected users and add their data
      selectedUsers.forEach((user) => {
        dataPoint[`compare_${user}`] = getCount(day, user);
      });
    }

    return dataPoint;
  });
};

// --- INSIGHT GENERATOR ---
const generateInsight = (data, mode, selectedUsers) => {
  if (!data || data.length === 0) return "No data available.";

  const totalMain = data.reduce((acc, d) => acc + d.main, 0);

  if (mode === "none")
    return `You handled ${totalMain} tickets in this period. Select options to compare.`;

  if (mode === "time") {
    const totalPrev = data.reduce((acc, d) => acc + (d.compare_prev || 0), 0);
    const diff = totalMain - totalPrev;
    const pcent = totalPrev ? Math.round((diff / totalPrev) * 100) : 0;
    return diff > 0
      ? `🚀 Workload UP ${pcent}% vs previous period (${totalMain} vs ${totalPrev}).`
      : `📉 Workload DOWN ${Math.abs(pcent)}% vs previous period.`;
  }

  if (mode === "team" || mode === "gst") {
    const avgKey = mode === "team" ? "compare_team" : "compare_gst";
    const totalAvg = Math.round(
      data.reduce((acc, d) => acc + (d[avgKey] || 0), 0)
    );
    const pcent = totalAvg
      ? Math.round(((totalMain - totalAvg) / totalAvg) * 100)
      : 0;
    return pcent > 0
      ? `🏆 You handled ${pcent}% more tickets than the ${
          mode === "gst" ? "GST" : "Team"
        } average.`
      : `📊 You are at ${100 + pcent}% of the ${
          mode === "gst" ? "GST" : "Team"
        } average workload.`;
  }

  if (mode === "users" && selectedUsers.length > 0) {
    // Find who has the max
    let maxUser = "You";
    let maxVal = totalMain;

    selectedUsers.forEach((u) => {
      const uTotal = data.reduce((acc, d) => acc + (d[`compare_${u}`] || 0), 0);
      if (uTotal > maxVal) {
        maxVal = uTotal;
        maxUser = u;
      }
    });

    if (maxUser === "You")
      return `⚔️ You handled the most tickets (${maxVal}) in this group.`;
    return `⚔️ ${maxUser} handled the most tickets (${maxVal}) in this group.`;
  }

  return "Analysis complete.";
};

// --- MULTI-SELECT DROPDOWN COMPONENT ---
const MultiUserSelect = ({ allUsers, selectedUsers, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const toggleUser = (user) => {
    if (selectedUsers.includes(user)) {
      onChange(selectedUsers.filter((u) => u !== user));
    } else {
      onChange([...selectedUsers, user]);
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-400 transition-colors min-w-[160px] justify-between"
      >
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {selectedUsers.length === 0
              ? "Select Peers..."
              : `${selectedUsers.length} Selected`}
          </span>
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400" />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto p-2">
          {allUsers.map((user) => (
            <div
              key={user}
              onClick={() => toggleUser(user)}
              className="flex items-center gap-3 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
            >
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center ${
                  selectedUsers.includes(user)
                    ? "bg-indigo-500 border-indigo-500"
                    : "border-slate-400"
                }`}
              >
                {selectedUsers.includes(user) && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </div>
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {user}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- HELPER: Process DAILY Data (Granular) ---
const processDailyData = (tickets, days = 30) => {
  const end = new Date();
  const start = subDays(end, days);

  const daysInterval = eachDayOfInterval({ start, end });

  return daysInterval.map((day) => {
    const dayLabel = format(day, "MMM dd");

    const created = tickets.filter(
      (t) => t.created_date && isSameDay(parseISO(t.created_date), day)
    );
    const solved = tickets.filter(
      (t) =>
        t.actual_close_date && isSameDay(parseISO(t.actual_close_date), day)
    );

    // RWT Calculation
    const totalRwtHours = solved.reduce((acc, t) => {
      const c = parseISO(t.created_date);
      const cl = parseISO(t.actual_close_date);
      return acc + differenceInHours(cl, c);
    }, 0);
    const avgRwt = solved.length
      ? Math.round(totalRwtHours / solved.length)
      : 0;

    // Debt Cleared (>15 days)
    const oldClosed = solved.filter((t) => {
      const c = parseISO(t.created_date);
      const cl = parseISO(t.actual_close_date);
      return differenceInHours(cl, c) / 24 > 15;
    }).length;

    return {
      name: dayLabel,
      created: created.length,
      solved: solved.length,
      rwt: avgRwt,
      oldClosed: oldClosed,
    };
  });
};

// --- SUB-COMPONENT: AI Insight Card ---
const InsightCard = ({ metric, data, context, comparison }) => {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);

  const generateInsight = async () => {
    setLoading(true);
    try {
      const API_BASE = "http://localhost:5000";
      const res = await axios.post(`${API_BASE}/api/analytics/insight`, {
        metric,
        chartData: data,
        context,
        comparison,
      });
      setInsight(res.data.insight);
    } catch (e) {
      setInsight("Rate limit exceeded. Try again in 30s.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute top-4 right-14 z-20">
      {!insight ? (
        <button
          onClick={generateInsight}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm border border-indigo-100 hover:border-indigo-300"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          {comparison ? "Compare vs Team" : "Analyze Trend"}
        </button>
      ) : (
        <div className="absolute right-0 top-8 w-72 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border border-indigo-100 dark:border-indigo-900/50 p-4 rounded-xl shadow-xl animate-in fade-in slide-in-from-top-2 z-50">
          <button
            onClick={() => setInsight(null)}
            className="absolute top-2 right-2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3 h-3" />
          </button>
          <h4 className="text-[10px] uppercase font-bold text-indigo-500 mb-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Gemini Analyst
          </h4>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
            {insight}
          </p>
        </div>
      )}
    </div>
  );
};

// --- MAIN DASHBOARD ---
const AnalyticsDashboard = ({
 tickets = [],                // ✅ Fix: Default to empty array
  sidebarFilteredTickets = [], // ✅ Fix: Default to empty array
  filterOwner,
}) => {
  const {
    theme,
    currentUser,
    tickets: activeTickets,
    analyticsTickets,
  } = useTicketStore();
  // Use History if available, else Active
  // Robust Fallback for Data
  const sourceTickets =
    analyticsTickets && analyticsTickets.length > 0
      ? analyticsTickets
      : activeTickets || [];
  const isDark = theme === "dark";
  const [expandedMetric, setExpandedMetric] = useState(null);
  // 1. SMART IDENTITY RESOLVER
  const resolvedCurrentUser = useMemo(() => {
    if (!currentUser?.name) return null;
    const cleanLoginName = currentUser.name.toLowerCase().trim();
    const rosterNames = Object.values(FLAT_TEAM_MAP);

    // Priority: Exact Match -> Partial Match (e.g. "Rohan" in "Rohan Jadhav")
    return (
      rosterNames.find((rName) => {
        const cleanRoster = rName.toLowerCase().trim();
        return (
          cleanLoginName === cleanRoster ||
          cleanLoginName.includes(cleanRoster) ||
          cleanRoster.includes(cleanLoginName)
        );
      }) || currentUser.name
    );
  }, [currentUser]);

  const isGSTUser = !!resolvedCurrentUser;

  // 2. STATE INITIALIZATION
  // Auto-select the resolved user (e.g., "Rohan")
  const [selectedUsers, setSelectedUsers] = useState(
    isGSTUser ? [resolvedCurrentUser] : []
  );

  // --- STATE ---
  const [subject, setSubject] = useState("Me");

  const [showTeam, setShowTeam] = useState(true);
  const [showGST, setShowGST] = useState(true);
  const isTeamSelected = Object.keys(TEAM_GROUPS).includes(subject);

  // Comparison State
  const [compareMode, setCompareMode] = useState("none"); // none, time, team, gst, users
  const [selectedPeers, setSelectedPeers] = useState([]);
  const [timeRange, setTimeRange] = useState(30);

  const days = useMemo(() => {
    // ✅ Fix: Check if tickets exists AND is an array before accessing .length or .map
    if (!tickets || !Array.isArray(tickets) || !tickets.length) return 30;

    const dates = tickets
      .map((t) => t.created_date)
      .filter(Boolean)
      .map((d) => parseISO(d))
      .sort((a, b) => a - b);

    const diff = differenceInDays(dates[dates.length - 1], dates[0]);

    return Math.max(diff + 1, 30); // fallback safety
  }, [tickets]);

  const { dailyData, comparisonStats } = useMemo(() => {
    const globalDaily = processDailyData(tickets, days);

    let comp = null;
    if (filterOwner !== "All") {
      const userTickets = tickets.filter(
        (t) =>
          t.owned_by?.[0]?.display_id === filterOwner.split(" ")[0] ||
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] === filterOwner
      );

      const globalRWT =
        globalDaily.reduce((acc, d) => acc + d.rwt, 0) /
        (globalDaily.filter((d) => d.rwt > 0).length || 1);

      const globalSolved = globalDaily.reduce((acc, d) => acc + d.solved, 0);

      const userDaily = processDailyData(userTickets, days);

      const userRWT =
        userDaily.reduce((acc, d) => acc + d.rwt, 0) /
        (userDaily.filter((d) => d.rwt > 0).length || 1);

      const userSolved = userTickets.filter((t) => t.actual_close_date).length;

      comp = {
        rwt: {
          userVal: `${Math.round(userRWT)}h`,
          teamVal: `${Math.round(globalRWT)}h`,
        },
        volume: {
          userVal: `${userSolved}`,
          teamVal: `${Math.round(globalSolved / 10)} (Avg)`,
        },
        userDaily,
      };
    }

    return {
      dailyData: comp ? comp.userDaily : globalDaily,
      comparisonStats: comp,
    };
  }, [tickets, filterOwner, days]);

  const context = filterOwner === "All" ? "Global Team" : filterOwner;

  // --- CSAT LOGIC ---
  const { badTickets, allPerformers } = useMemo(() => {
    const badList = [];
    const ownerStats = {};
    tickets.forEach((t) => {
      const ownerId = t.owned_by?.[0]?.display_id;
      if (ownerId && FLAT_TEAM_MAP[ownerId]) {
        let realName = t.owned_by?.[0]?.display_name || FLAT_TEAM_MAP[ownerId];
        if (typeof realName !== "string") realName = "";
        realName = realName.trim();
        if (
          realName &&
          realName.length > 2 &&
          !HIDDEN_USERS.includes(realName)
        ) {
          if (!ownerStats[realName])
            ownerStats[realName] = {
              name: realName,
              good: 0,
              bad: 0,
              total: 0,
            };
          const sentiment = getCSATStatus(t);
          if (sentiment === "Good") ownerStats[realName].good += 1;
          if (sentiment === "Bad") ownerStats[realName].bad += 1;
          ownerStats[realName].total += 1;
        }
      }
      const sentiment = getCSATStatus(t);
      const isBad = sentiment === "Bad";
      const matchesOwner =
        filterOwner === "All" ||
        t.owned_by?.[0]?.display_id === filterOwner.split(" ")[0];
      if (isBad && matchesOwner) badList.push(t);
    });
    const sortedPerformers = Object.values(ownerStats)
      .map((p) => ({
        ...p,
        winRate: p.total > 0 ? Math.round((p.good / p.total) * 100) : 0,
      }))
      .sort((a, b) => {
        if (b.good !== a.good) return b.good - a.good;
        return b.winRate - a.winRate;
      });
    return { badTickets: badList, allPerformers: sortedPerformers };
  }, [tickets, filterOwner]);

  // --- CHART DATA (Small) ---
  const defaultData = useMemo(() => {
    return processComparisonData(
      tickets,
      30,
      "none",
      [],
      currentUser,
      filterOwner
    );
  }, [tickets, currentUser, filterOwner]);


// --- SMALL CHARTS DATA ---
  const smallChartData = useMemo(() => {
    // Use the tickets prop which is already filtered by date and team
    const dataToUse = tickets && tickets.length > 0 ? tickets : sourceTickets;
    
    // Determine subject based on filterOwner
    let subject = "All";
    if (filterOwner && filterOwner !== "All") {
      subject = filterOwner;
    }

    // Calculate date range from the ACTUAL filtered data
    let dynamicDays = 30; // Default fallback
    if (dataToUse.length > 0) {
      const dates = dataToUse
        .map((t) => t.created_date)
        .filter(Boolean)
        .map((d) => parseISO(d))
        .sort((a, b) => a - b);

      if (dates.length > 0) {
        const oldestDate = dates[0];
        const newestDate = dates[dates.length - 1];
        const diff = differenceInDays(newestDate, oldestDate);
        // Use the actual span of data, minimum 1 day for "Today"
        dynamicDays = diff === 0 ? 1 : diff + 1;
      }
    }

    return {
      volume: processChartData(dataToUse, "volume", dynamicDays, subject, currentUser),
      solved: processChartData(dataToUse, "solved", dynamicDays, subject, currentUser),
      rwt: processChartData(dataToUse, "rwt", dynamicDays, subject, currentUser),
      backlog: processChartData(dataToUse, "backlog", dynamicDays, subject, currentUser),
    };
  }, [tickets, sourceTickets, currentUser, filterOwner]);

  // Helper: Find my team name
  const myTeamName = useMemo(() => {
    if (!resolvedCurrentUser) return null;
    return Object.keys(TEAM_GROUPS).find((key) =>
      Object.values(TEAM_GROUPS[key]).some((m) =>
        resolvedCurrentUser.includes(m)
      )
    );
  }, [resolvedCurrentUser]);

  // --- EXPANDED CHART DATA ---
  const expandedData = useMemo(() => {
    if (!expandedMetric) return [];
    return processMultiUserData(
      sourceTickets,
      expandedMetric,
      timeRange,
      selectedUsers,
      showTeam,
      showGST,
      myTeamName
    );
  }, [
    sourceTickets,
    expandedMetric,
    timeRange,
    selectedUsers,
    showTeam,
    showGST,
    myTeamName,
  ]);

  const colors = {
    grid: isDark ? "#1e293b" : "#f1f5f9",
    text: isDark ? "#94a3b8" : "#64748b",
    tooltipBg: isDark ? "#0f172a" : "#ffffff",
  };
  const allUserNames = Object.values(FLAT_TEAM_MAP).sort();
  const allTeamNames = Object.keys(TEAM_GROUPS).sort();
  const insight = useMemo(
    () => generateInsight(expandedData, compareMode, selectedPeers),
    [expandedData, compareMode, selectedPeers]
  );

  // --- MODAL RENDERER (Centered & Blurred) ---
  // const renderExpandedModal = (title, children) => {
  //   if (!expandedChart) return null;
  //   return (
  //     <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-in fade-in duration-200">
  //       {/* Click outside to close */}
  //       <div
  //         className="absolute inset-0"
  //         onClick={() => setExpandedChart(null)}
  //       ></div>

  //       <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-[500px] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 relative flex flex-col z-10 p-6">
  //         <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-slate-800 pb-4">
  //           <div>
  //             <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-3">
  //               <Activity className="w-5 h-5 text-indigo-500" /> {title}
  //             </h2>
  //             <p className="text-xs text-slate-500 mt-1">Performance</p>
  //           </div>
  //           <button
  //             onClick={() => setExpandedChart(null)}
  //             className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
  //           >
  //             <X className="w-6 h-6 text-slate-500" />
  //           </button>
  //         </div>
  //         <div className="flex-1 w-full min-h-0">
  //           <ResponsiveContainer width="100%" height="100%">
  //             {children}
  //           </ResponsiveContainer>
  //         </div>
  //       </div>
  //     </div>
  //   );
  // };

  // Split into Top 3 and Runners Up
  const podium = [allPerformers[1], allPerformers[0], allPerformers[2]];
  const runnersUp = allPerformers.slice(3);

  return (
    <div className="space-y-8 animate-in fade-in pb-20">
      {/* SECTION 1: CSAT CHAMPIONS (Podium Style) */}
      {/* 1. PODIUM */}

      {/* SECTION 1: CHAMPIONS ARENA */}
      <div className="flex flex-col xl:flex-row gap-6">
        {/* 70% Width: The Podium */}
        <div className="xl:w-[70%] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm relative overflow-hidden transition-colors">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50"></div>

          <div className="flex items-center justify-between mb-8">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" /> CSAT Champions
            </h3>
            <span className="text-xs font-medium text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
              Top Performers
            </span>
          </div>

          <div className="flex items-end justify-center gap-2 sm:gap-6 h-72 sm:h-96 pb-2">
            {podium.map((person, idx) => {
              if (!person) return null;

              const isGold = idx === 1;
              const rank = isGold ? 1 : idx === 0 ? 2 : 3;

              // 🚀 FIX: Increased non-gold height to 65% so text fits
              const heightClass = isGold ? "h-full" : "h-[65%]";

              // 🚀 FIX: Only Gold gets large padding (pt-10). Others get small padding (pt-3)
              const paddingClass = isGold ? "pt-10" : "pt-3";

              const colorClass = isGold
                ? "from-amber-100 to-amber-50/10 border-amber-200 text-amber-600 dark:from-amber-500/20 dark:to-slate-900 dark:border-amber-500/50 dark:text-amber-400"
                : rank === 2
                ? "from-slate-200 to-slate-50/10 border-slate-300 text-slate-600 dark:from-slate-600/20 dark:to-slate-900 dark:border-slate-500/50 dark:text-slate-400"
                : "from-orange-100 to-orange-50/10 border-orange-200 text-orange-700 dark:from-orange-600/20 dark:to-slate-900 dark:border-orange-500/50 dark:text-orange-400";

              return (
                <div
                  key={person.name}
                  className={`relative flex flex-col items-center justify-end w-1/3 max-w-[180px] ${heightClass} transition-all duration-700 ease-out`}
                >
                  {/* Avatar & Badge (Lifted -mt-16) */}
                  <div
                    className={`relative mb-4 flex flex-col items-center z-20 ${
                      isGold ? "-mt-16" : ""
                    }`}
                  >
                    {isGold && (
                      <Crown
                        className="w-10 h-10 text-amber-500 mb-2 animate-bounce"
                        fill="currentColor"
                      />
                    )}
                    <div
                      className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-2xl font-bold border-4 shadow-xl bg-white dark:bg-slate-800 ${
                        colorClass.split(" ")[2]
                      }`}
                    >
                      {person.name.charAt(0)}
                    </div>
                    <div
                      className={`absolute -bottom-3 px-3 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-white dark:bg-slate-800 border shadow-md ${
                        colorClass.split(" ")[2]
                      }`}
                    >
                      Rank #{rank}
                    </div>
                  </div>

                  {/* The Bar */}
                  <div
                    className={`w-full rounded-t-3xl border-t border-x bg-gradient-to-b ${colorClass} flex flex-col items-center justify-start ${paddingClass} pb-4 shadow-sm relative overflow-hidden group hover:opacity-90 cursor-pointer`}
                  >
                    {isGold && (
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 bg-amber-400/20 blur-[60px] rounded-full pointer-events-none"></div>
                    )}

                    {/* 🚀 FIX: Removed forced color class. Added relative + z-20 */}
                    <h4 className="font-bold text-sm sm:text-base text-center px-1 mb-2 truncate w-full z-20 relative">
                      {person.name}
                    </h4>

                    <div className="flex items-center gap-1 bg-white/60 dark:bg-black/30 px-4 py-1.5 rounded-full z-10 backdrop-blur-md shadow-sm border border-white/20">
                      <Smile className="w-4 h-4" />
                      <span className="text-sm font-bold">{person.good}</span>
                    </div>
                    <p className="text-[10px] mt-3 opacity-70 z-10 font-medium">
                      {person.winRate}% Positive
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 30% Width: The Leaderboard List */}
        <div className="xl:w-[30%] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-0 shadow-sm flex flex-col overflow-hidden transition-colors">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
            <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
              <Medal className="w-4 h-4 text-slate-400" /> Honorable Mentions
            </h3>
          </div>

          <div className="overflow-y-auto max-h-[400px] p-2 space-y-1 custom-scrollbar">
            {runnersUp.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs py-10">
                <User className="w-8 h-8 mb-2 opacity-20" />
                <p>No other active agents.</p>
              </div>
            ) : (
              runnersUp.map((person, idx) => (
                <div
                  key={person.name}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group border border-transparent hover:border-slate-100 dark:hover:border-slate-700"
                >
                  <span className="text-xs font-bold text-slate-400 w-4 text-center">
                    #{idx + 4}
                  </span>

                  <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
                    {person.name.charAt(0)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                        {person.name}
                      </p>
                      <span className="text-[10px] font-medium text-slate-500">
                        {person.good} Good
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 rounded-full"
                        style={{ width: `${person.winRate}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-8 mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5 text-indigo-500" /> Performance Analytics
      </h2>

      {/* 2. CHARTS GRID */}
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
                <p className="text-xs text-slate-500">
                  {config.desc} (Last 14 Days)
                </p>
              </div>
              <button
                onClick={() => {
                  setExpandedMetric(key);
                  setSubject("Me");
                  setShowTeam(true);
                  setShowGST(true);
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
                    labelFormatter={(label) => `${label}`}
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

      {/* 5. EXPANDED VIEW (Multi-Select) */}
      {expandedMetric && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div
            className="absolute inset-0"
            onClick={() => setExpandedMetric(null)}
          ></div>

          <div className="bg-white dark:bg-slate-900 w-[95vw] h-[90vh] rounded-3xl shadow-2xl border border-white/10 relative flex flex-col z-10 overflow-visible ring-1 ring-white/5">
            {/* HEADER (Identity Correctness: No "Analyzing Rohan" text) */}
            <div className="px-8 py-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-center shrink-0 rounded-t-3xl">
              <div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                  <div
                    className={`p-2 rounded-xl bg-opacity-10`}
                    style={{
                      backgroundColor: `${METRICS[expandedMetric].color}20`,
                    }}
                  >
                    {React.createElement(METRICS[expandedMetric].icon, {
                      className: "w-6 h-6",
                      color: METRICS[expandedMetric].color,
                    })}
                  </div>
                  {METRICS[expandedMetric].label} Analysis
                </h2>
              </div>
              <button
                onClick={() => setExpandedMetric(null)}
                className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all hover:rotate-90"
              >
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            {/* CONTROLS (Simplification: Checkbox List) */}
            <div className="px-8 py-4 bg-slate-50/80 dark:bg-slate-950/50 backdrop-blur border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-4 shrink-0 relative z-50">
              {/* Multi-User Checkbox Dropdown */}
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
                  <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" />
                </button>

                {/* Dropdown Menu */}
                <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-2 hidden group-hover:block max-h-[60vh] overflow-y-auto z-[60]">
                  {allUserNames.map((user) => (
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
                    ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 text-indigo-600 dark:text-indigo-300"
                    : "border-transparent text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                    ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 text-emerald-600 dark:text-emerald-300"
                    : "border-transparent text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
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

           {/* CHART AREA (Modern Design) */}
            <div className="flex-1 w-full bg-slate-50/50 dark:bg-slate-900/50 p-6 relative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={expandedData}
                  margin={{ top: 20, right: 30, left: 10, bottom: 0 }}
                >
                  <defs>
                    {/* Modern Gradients */}
                    <linearGradient id="colorTeam" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorGST" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={isDark ? "#1e293b" : "#e2e8f0"}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: isDark ? "#94a3b8" : "#64748b", fontSize: 11, fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                    minTickGap={30}
                  />
                  <YAxis
                    tick={{ fill: isDark ? "#94a3b8" : "#64748b", fontSize: 11, fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      borderRadius: "12px",
                      border: "1px solid rgba(255,255,255,0.1)",
                      boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)"
                    }}
                    cursor={{ stroke: isDark ? "#334155" : "#cbd5e1", strokeWidth: 1, strokeDasharray: "4 4" }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: "20px" }}
                    iconType="circle"
                  />

                  {/* MODERN COLOR PALETTE */}
                  {selectedUsers.map((user, index) => {
                    // Clean, distinct colors: Indigo, Emerald, Amber, Rose, Cyan
                    const palette = [
                      "#6366f1",
                      "#10b981",
                      "#f59e0b",
                      "#f43f5e",
                      "#06b6d4",
                    ];
                    const color = palette[index % palette.length];

                    return (
                      <Area
                        key={user}
                        type="monotone"
                        dataKey={user}
                        name={user}
                        stroke={color}
                        fill={color}
                        fillOpacity={0.1} // Subtle fill
                        strokeWidth={3}
                        activeDot={{ r: 6, strokeWidth: 0, fill: color }}
                        animationDuration={1000}
                      />
                    );
                  })}

                  {selectedUsers.length === 0 && (
                    <text
                      x="50%"
                      y="50%"
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="14"
                    >
                      Select users from the dropdown to analyze data
                    </text>
                  )}

                  {/* COMPARISON LINES - Solid & Uniform */}
                  {showTeam && (
                    <Area
                      type="monotone"
                      dataKey="compare_team"
                      name="Team Total"
                      stroke="#6366f1" // Indigo
                      fill="none"
                      strokeWidth={3}
                      // Removed strokeDasharray to make it solid
                      animationDuration={1000}
                    />
                  )}
                  {showGST && (
                    <Area
                      type="monotone"
                      dataKey="compare_gst"
                      name="GST Total"
                      stroke="#10b981" // Emerald
                      fill="none"
                      strokeWidth={3}
                      // Removed strokeDasharray to make it solid
                      animationDuration={1000}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: ALERTS (Negative Feedback) */}
      {badTickets.length > 0 && (
        <div className="bg-rose-50/50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/50 rounded-xl p-6 transition-colors">
          <h3 className="text-rose-800 dark:text-rose-400 font-bold flex items-center gap-2 mb-4 text-xs uppercase tracking-wide">
            <AlertCircle className="w-4 h-4" /> Negative Feedback (
            {badTickets.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {badTickets.map((t) => (
              <div
                key={t.id}
                className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-rose-100 dark:border-rose-900/30 hover:border-rose-300 transition-all cursor-pointer group"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold text-slate-400 font-mono bg-slate-50 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                    {t.display_id}
                  </span>
                  <a
                    href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                    target="_blank"
                    className="text-slate-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 line-clamp-2 mb-3">
                  {t.title}
                </p>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/50 px-2 py-1 rounded-full">
                    <Frown className="w-3 h-3" /> BAD RATING
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {format(parseISO(t.created_date), "MMM d")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
