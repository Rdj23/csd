import React, { useMemo, useState } from "react";
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
} from "recharts";
import {
  TrendingUp,
  Clock,
  AlertCircle,
  ExternalLink,
  Trophy,
  Medal,
  Crown,
  User,
  Sparkles,
  Loader2,
  Activity,
  TrendingDown,
  X,
  Maximize2,
  CheckCircle,
  ArrowUpRight,
  Smile,
  Frown,
} from "lucide-react";
import axios from "axios";
import { getCSATStatus, FLAT_TEAM_MAP } from "../utils";
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
const AnalyticsDashboard = ({ tickets, filterOwner }) => {
  const { theme } = useTicketStore();
  const isDark = theme === "dark";

  // State for Expansion
  const [expandedChart, setExpandedChart] = useState(null);

  const days = useMemo(() => {
    if (!tickets.length) return 30;

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

  const podium = [allPerformers[1], allPerformers[0], allPerformers[2]];
  const runnersUp = allPerformers.slice(3);
  const colors = {
    grid: isDark ? "#1e293b" : "#f1f5f9",
    text: isDark ? "#94a3b8" : "#64748b",
    tooltipBg: isDark ? "#0f172a" : "#ffffff",
  };

  // --- MODAL RENDERER (Centered & Blurred) ---
  const renderExpandedModal = (title, children) => {
    if (!expandedChart) return null;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-in fade-in duration-200">
        {/* Click outside to close */}
        <div
          className="absolute inset-0"
          onClick={() => setExpandedChart(null)}
        ></div>

        <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-[500px] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 relative flex flex-col z-10 p-6">
          <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-3">
                <Activity className="w-5 h-5 text-indigo-500" /> {title}
              </h2>
              <p className="text-xs text-slate-500 mt-1">Performance</p>
            </div>
            <button
              onClick={() => setExpandedChart(null)}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-slate-500" />
            </button>
          </div>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in pb-20">
      {/* SECTION 1: CSAT CHAMPIONS (Podium Style) */}
      <div className="flex flex-col xl:flex-row gap-6">
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
              const heightClass = isGold ? "h-full" : "h-[65%]";
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
                  <div
                    className={`w-full rounded-t-3xl border-t border-x bg-gradient-to-b ${colorClass} flex flex-col items-center justify-start ${paddingClass} pb-4 shadow-sm relative overflow-hidden group hover:opacity-90 cursor-pointer`}
                  >
                    {isGold && (
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 bg-amber-400/20 blur-[60px] rounded-full pointer-events-none"></div>
                    )}
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
        <div className="xl:w-[30%] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-0 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
            <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
              Honorable Mentions
            </h3>
          </div>

          <div className="overflow-y-auto max-h-[400px] p-2 space-y-1">
            {runnersUp.map((person, idx) => (
              <div
                key={person.name}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <span className="text-xs font-bold text-slate-400 w-4">
                  #{idx + 4}
                </span>

                <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-xs font-bold">
                  {person.name.charAt(0)}
                </div>

                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <p className="text-xs font-bold truncate">{person.name}</p>
                    <span className="text-[10px]">{person.good} Good</span>
                  </div>

                  <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full">
                    <div
                      className="h-full bg-emerald-400 rounded-full"
                      style={{ width: `${person.winRate}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* --- SECTION 2: ANALYTICS GRIDS --- */}
      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-8 mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5 text-indigo-500" /> 30-Day Performance
        Trends
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CHART 1: INCOMING TRAFFIC (CREATED) - AREA CHART */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 relative group">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 uppercase tracking-wide">
                <ArrowUpRight className="w-4 h-4 text-indigo-500" /> Incoming
                Volume
              </h3>
              <p className="text-xs text-slate-500">Tickets Created Daily</p>
            </div>
            <button
              onClick={() =>
                setExpandedChart({
                  type: "created",
                  title: "Incoming Ticket Volume",
                })
              }
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>

          <InsightCard
            metric="volume"
            data={dailyData}
            context={context}
            comparison={
              comparisonStats?.volume
                ? {
                    userVal: comparisonStats.volume.userVal,
                    teamVal: comparisonStats.volume.teamVal,
                  }
                : null
            }
          />

          <div className="h-[250px] w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
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
                  dy={10}
                  minTickGap={30}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: colors.text, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartsTooltip
                  cursor={{ stroke: "#6366f1", strokeWidth: 1 }}
                  contentStyle={{
                    backgroundColor: colors.tooltipBg,
                    borderRadius: "8px",
                    border: "none",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="created"
                  name="New Tickets"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#colorCreated)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 2: SOLVED THROUGHPUT - AREA CHART (Changed from Bar) */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 relative group">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 uppercase tracking-wide">
                <CheckCircle className="w-4 h-4 text-emerald-500" /> Solved
                Output
              </h3>
              <p className="text-xs text-slate-500">Tickets Solved Daily</p>
            </div>
            <button
              onClick={() =>
                setExpandedChart({ type: "solved", title: "Solved Throughput" })
              }
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>

          <InsightCard
            metric="volume"
            data={dailyData}
            context={context}
            comparison={
              comparisonStats?.volume
                ? {
                    userVal: comparisonStats.volume.userVal,
                    teamVal: comparisonStats.volume.teamVal,
                  }
                : null
            }
          />

          <div className="h-[250px] w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="colorSolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
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
                  dy={10}
                  minTickGap={30}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: colors.text, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartsTooltip
                  cursor={{ fill: isDark ? "#1e293b" : "#f8fafc" }}
                  contentStyle={{
                    backgroundColor: colors.tooltipBg,
                    borderRadius: "8px",
                    border: "none",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="solved"
                  name="Solved Tickets"
                  stroke="#10b981"
                  fill="url(#colorSolved)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 3: RWT TREND */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 relative group">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 uppercase tracking-wide">
                <Clock className="w-4 h-4 text-amber-500" /> Resolution Time
              </h3>
              <p className="text-xs text-slate-500">
                Avg hours to close (Daily Trend)
              </p>
            </div>
            <button
              onClick={() =>
                setExpandedChart({
                  type: "rwt",
                  title: "Average Resolution Time",
                })
              }
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>

          <InsightCard
            metric="rwt"
            data={dailyData}
            context={context}
            comparison={
              comparisonStats?.rwt
                ? {
                    userVal: comparisonStats.rwt.userVal,
                    teamVal: comparisonStats.rwt.teamVal,
                  }
                : null
            }
          />

          <div className="h-[250px] w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="colorRwt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
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
                  dy={10}
                  minTickGap={30}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: colors.text, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  unit="h"
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: colors.tooltipBg,
                    borderRadius: "8px",
                    border: "none",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="rwt"
                  name="Avg RWT (Hours)"
                  stroke="#f59e0b"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorRwt)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 4: TECHNICAL DEBT */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 relative group">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 uppercase tracking-wide">
                <TrendingDown className="w-4 h-4 text-rose-500" /> Backlog
                Clearance
              </h3>
              <p className="text-xs text-slate-500">
                Old Tickets (15+ days) Solved
              </p>
            </div>
            <button
              onClick={() =>
                setExpandedChart({
                  type: "debt",
                  title: "Technical Debt Clearance",
                })
              }
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>

          <InsightCard metric="aging" data={dailyData} context={context} />

          <div className="h-[250px] w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData}>
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
                  dy={10}
                  minTickGap={30}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: colors.text, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: colors.tooltipBg,
                    borderRadius: "8px",
                    border: "none",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="oldClosed"
                  name="Backlog Cleared"
                  stroke="#e11d48"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* NEGATIVE FEEDBACK (Preserved) */}
      {badTickets.length > 0 && (
        <div className="bg-rose-50/50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/50 rounded-xl p-6 transition-colors mt-8">
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
                <div className="flex items-center gap-2 mt-2">
                  <Frown className="w-3 h-3 text-rose-500" />
                  <span className="text-[10px] text-slate-500">
                    {format(parseISO(t.created_date), "MMM d")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- EXPANDED CHART MODAL (Centered, Blurred, Visible Text) --- */}
      {expandedChart &&
        renderExpandedModal(
          expandedChart.title,
          // Logic to render specific chart based on type
          expandedChart.type === "created" ? (
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="expCreated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke={colors.grid}
              />
              {/* ✅ FIX: Forced text color for visibility in modal */}
              <XAxis
                dataKey="name"
                tick={{ fill: colors.text }}
                interval="preserveStartEnd"
                minTickGap={15}
              />
              <YAxis tick={{ fill: colors.text }} />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: colors.tooltipBg,
                  borderRadius: "8px",
                  border: "none",
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="created"
                name="Tickets Created"
                stroke="#6366f1"
                fill="url(#expCreated)"
                strokeWidth={3}
              />
            </AreaChart>
          ) : expandedChart.type === "solved" ? (
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="expSolved" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke={colors.grid}
              />
              <XAxis
                dataKey="name"
                tick={{ fill: colors.text }}
                interval="preserveStartEnd"
                minTickGap={15}
              />
              <YAxis tick={{ fill: colors.text }} />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: colors.tooltipBg,
                  borderRadius: "8px",
                  border: "none",
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="solved"
                name="Tickets Solved"
                stroke="#10b981"
                fill="url(#expSolved)"
                strokeWidth={3}
              />
            </AreaChart>
          ) : expandedChart.type === "rwt" ? (
            <AreaChart data={dailyData}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke={colors.grid}
              />
              <XAxis
                dataKey="name"
                tick={{ fill: colors.text }}
                interval="preserveStartEnd"
                minTickGap={15}
              />
              <YAxis tick={{ fill: colors.text }} unit="h" />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: colors.tooltipBg,
                  borderRadius: "8px",
                  border: "none",
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="rwt"
                name="Avg RWT"
                stroke="#f59e0b"
                fill="#f59e0b"
                fillOpacity={0.2}
                strokeWidth={3}
              />
            </AreaChart>
          ) : (
            <LineChart data={dailyData}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke={colors.grid}
              />
              <XAxis
                dataKey="name"
                tick={{ fill: colors.text }}
                interval="preserveStartEnd"
                minTickGap={15}
              />
              <YAxis tick={{ fill: colors.text }} />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: colors.tooltipBg,
                  borderRadius: "8px",
                  border: "none",
                }}
              />
              <Legend />
              <Line
                type="step"
                dataKey="oldClosed"
                name="Backlog Cleared"
                stroke="#e11d48"
                strokeWidth={3}
              />
            </LineChart>
          )
        )}
    </div>
  );
};

export default AnalyticsDashboard;
