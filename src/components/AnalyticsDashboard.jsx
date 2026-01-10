import React, { useMemo, useState, useCallback, useEffect } from "react";
import { format, parseISO } from "date-fns";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, Line,
} from "recharts";
import {
  Activity, Trophy, Users, Check, Clock, TrendingUp,
  Layers, AlertCircle, ExternalLink, Frown, Smile, Crown,
  Medal, Globe, ListFilter, RefreshCw, Eye, EyeOff, Zap,
} from "lucide-react";
import { FLAT_TEAM_MAP } from "../utils";
import { useTicketStore } from "../store";

const HIDDEN_USERS = ["System", "DevRev Bot", "Undefined", "null"];
const QUARTERS = [
  { id: "Q3_25", label: "Q3 '25" },
  { id: "Q4_25", label: "Q4 '25" },
  { id: "Q1_26", label: "Q1 '26" },
];
const Q1_WEEKS = [
  { id: "Q1_26_W1", label: "W1" },
  { id: "Q1_26_W2", label: "W2" },
  { id: "Q1_26_W3", label: "W3" },
  { id: "Q1_26_W4", label: "W4" },
];
const CHART_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4", "#8b5cf6"];

// ============================================================================
// PERFORMANCE METRICS CARDS
// ============================================================================
const PerformanceMetricsCards = ({ stats, trends, onQuarterChange, currentQuarter, isLoading }) => {
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarter || "Q4_25");
  const [selectedWeek, setSelectedWeek] = useState(null);

  const handleQuarterChange = (qId) => {
    setSelectedQuarter(qId);
    setSelectedWeek(null);
    onQuarterChange(qId);
  };

  const handleWeekChange = (wId) => {
    setSelectedWeek(wId);
    onQuarterChange(wId);
  };

  const getSparklineData = (key) => {
    if (!trends?.length) return [];
    return trends.slice(-14).map(t => ({
      date: t.date,
      value: key === 'csat' ? t.positiveCSAT : key === 'solved' ? t.solved : t[key] || 0
    }));
  };

  const MetricCard = ({ title, value, unit, color, sparkKey, icon: Icon }) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:shadow-lg transition-all h-44">
      <div className="flex justify-between items-start">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{title}</span>
        <div className={`p-2 rounded-xl bg-${color}-50 dark:bg-${color}-900/30`}>
          <Icon className={`w-4 h-4 text-${color}-500`} />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-black text-slate-800 dark:text-white">{isLoading ? "..." : value}</span>
        <span className="text-sm font-semibold text-slate-400">{unit}</span>
      </div>
      <div className="h-12 w-full mt-auto">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={getSparklineData(sparkKey)}>
            <Area type="monotone" dataKey="value" stroke={`var(--color-${color}-500, #6366f1)`} fill={`var(--color-${color}-100, #e0e7ff)`} strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
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
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          {QUARTERS.map(q => (
            <button key={q.id} onClick={() => handleQuarterChange(q.id)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${selectedQuarter === q.id ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {selectedQuarter === "Q1_26" && (
        <div className="flex items-center gap-2 pl-1">
          <span className="text-xs text-slate-500 font-medium">Weekly:</span>
          <div className="flex gap-1">
            <button onClick={() => handleWeekChange("Q1_26")}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${!selectedWeek ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>
              All Q1
            </button>
            {Q1_WEEKS.map(w => (
              <button key={w.id} onClick={() => handleWeekChange(w.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${selectedWeek === w.id ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard title="Avg RWT" value={stats?.avgRWT || "0.0"} unit="Hrs" color="violet" sparkKey="avgRWT" icon={Clock} />
        <MetricCard title="Positive CSAT" value={stats?.positiveCSAT || 0} unit="Count" color="emerald" sparkKey="csat" icon={Smile} />
        <MetricCard title="FRR Met" value={`${stats?.frrPercent || 0}`} unit="%" color="amber" sparkKey="frrPercent" icon={Zap} />
        <MetricCard title="Avg Iterations" value={stats?.avgIterations || "0.0"} unit="" color="blue" sparkKey="avgIterations" icon={Layers} />
        <MetricCard title="Avg FRT" value={stats?.avgFRT || "0.0"} unit="Hrs" color="rose" sparkKey="avgFRT" icon={TrendingUp} />
      </div>
    </div>
  );
};

// ============================================================================
// CSAT LEADERBOARD
// ============================================================================
const CSATLeaderboard = ({ leaderboard = [], isLoading }) => {
  const podium = leaderboard.slice(0, 3);
  const runnersUp = leaderboard.slice(3, 15);
  const podiumOrder = podium.length >= 3 ? [podium[1], podium[0], podium[2]] : podium;

  const getPodiumStyle = (idx) => {
    const styles = [
      { height: "h-32", color: "from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-800", border: "border-slate-300", rank: 2 },
      { height: "h-40", color: "from-amber-200 to-amber-100 dark:from-amber-900/50 dark:to-amber-800/30", border: "border-amber-400", rank: 1 },
      { height: "h-28", color: "from-orange-200 to-orange-100 dark:from-orange-900/30 dark:to-orange-800/20", border: "border-orange-300", rank: 3 },
    ];
    return styles[idx] || styles[2];
  };

  if (isLoading) return <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border animate-pulse h-96" />;

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
              <div key={person?.name || idx} className="flex flex-col items-center">
                <div className={`relative mb-3 ${isGold ? "-mt-8" : ""}`}>
                  {isGold && <Crown className="absolute -top-6 left-1/2 -translate-x-1/2 w-8 h-8 text-amber-500 animate-bounce" />}
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold border-4 ${style.border} bg-gradient-to-br ${style.color}`}>
                    {person?.name?.[0] || "?"}
                  </div>
                  <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${style.rank === 1 ? "bg-amber-500 text-white" : style.rank === 2 ? "bg-slate-400 text-white" : "bg-orange-400 text-white"}`}>
                    {style.rank}
                  </div>
                </div>
                <div className={`${style.height} w-24 bg-gradient-to-t ${style.color} rounded-t-xl flex flex-col items-center justify-start pt-4 border-x border-t ${style.border}`}>
                  <span className="text-sm font-bold text-slate-800 dark:text-white text-center px-1 truncate w-full">{person?.name?.split(" ")[0] || "—"}</span>
                  <div className="flex items-center gap-1 mt-1">
                    <Smile className="w-3 h-3 text-emerald-500" />
                    <span className="text-lg font-black text-emerald-600">{person?.goodCSAT || 0}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1">{person?.winRate || 0}% win</span>
                </div>
              </div>
            );
          })}
        </div>
        {runnersUp.length > 0 && (
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><Medal className="w-4 h-4" /> Runners Up</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {runnersUp.map((person, idx) => (
                <div key={person.name} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <span className="text-xs font-bold text-slate-400 w-5">{idx + 4}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{person.name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="text-emerald-600 font-bold">{person.goodCSAT} 👍</span>
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
// DSAT ALERTS
// ============================================================================
const DSATAlerts = ({ badTickets = [], isLoading }) => {
  const [showAll, setShowAll] = useState(false);
  const displayTickets = showAll ? badTickets : badTickets.slice(0, 6);

  if (!badTickets.length && !isLoading) return null;

  return (
    <div className="bg-gradient-to-br from-rose-50 to-white dark:from-rose-900/10 dark:to-slate-900 border border-rose-200 dark:border-rose-900/50 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-rose-100 dark:border-rose-900/30 flex justify-between items-center">
        <h3 className="text-base font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> Negative Feedback ({badTickets.length})
        </h3>
        {badTickets.length > 6 && (
          <button onClick={() => setShowAll(!showAll)} className="text-xs font-semibold text-rose-600 flex items-center gap-1">
            {showAll ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showAll ? "Show Less" : `Show All`}
          </button>
        )}
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayTickets.map((t) => (
          <div key={t.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-rose-100 dark:border-rose-900/30 group">
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">{t.display_id}</span>
              <a href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 line-clamp-2 mb-3">{t.title}</p>
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
// INDIVIDUAL CHARTS
// ============================================================================
const IndividualCharts = ({ individualTrends = {}, currentUser, isGSTUser }) => {
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [compareMode, setCompareMode] = useState(null);
  const [timeView, setTimeView] = useState("daily");

  const allUsers = useMemo(() => Object.keys(individualTrends).filter(u => !HIDDEN_USERS.includes(u)).sort(), [individualTrends]);

  useEffect(() => {
    if (isGSTUser && currentUser && allUsers.includes(currentUser)) setSelectedUsers([currentUser]);
  }, [isGSTUser, currentUser, allUsers]);

  const chartData = useMemo(() => {
    if (!selectedUsers.length) return [];
    const allDates = new Set();
    selectedUsers.forEach(user => (individualTrends[user] || []).forEach(d => allDates.add(d.date)));
    const sortedDates = Array.from(allDates).sort();

    const grouped = {};
    sortedDates.forEach(date => {
      let key = date;
      if (timeView === "weekly") key = format(parseISO(date), "yyyy-'W'ww");
      else if (timeView === "monthly") key = date.substring(0, 7);

      if (!grouped[key]) {
        grouped[key] = { name: key };
        selectedUsers.forEach(u => { grouped[key][u] = 0; });
        grouped[key].compare_gst = 0;
      }
      selectedUsers.forEach(user => {
        const userDay = (individualTrends[user] || []).find(d => d.date === date);
        if (userDay) grouped[key][user] += userDay.solved;
      });
      Object.keys(individualTrends).forEach(user => {
        const userDay = (individualTrends[user] || []).find(d => d.date === date);
        if (userDay) grouped[key].compare_gst += userDay.solved;
      });
    });
    return Object.values(grouped).slice(-30);
  }, [selectedUsers, individualTrends, timeView]);

  const handleUserToggle = (user) => {
    setSelectedUsers(prev => prev.includes(user) ? prev.filter(u => u !== user) : [...prev, user].slice(0, 5));
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap justify-between items-center gap-4">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-500" /> Individual Performance
          <span className="text-xs font-normal text-slate-400">(60 Days)</span>
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            {["daily", "weekly", "monthly"].map(v => (
              <button key={v} onClick={() => setTimeView(v)}
                className={`px-3 py-1 text-[10px] font-bold rounded-md ${timeView === v ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm" : "text-slate-500"}`}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button onClick={() => setCompareMode(compareMode === "gst" ? null : "gst")}
            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border ${compareMode === "gst" ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "border-slate-200 text-slate-500"}`}>
            Vs GST
          </button>
        </div>
      </div>
      <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
        <div className="flex flex-wrap gap-2">
          {allUsers.slice(0, 20).map((user, idx) => (
            <button key={user} onClick={() => handleUserToggle(user)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all ${selectedUsers.includes(user) ? "text-white shadow-md" : "bg-white dark:bg-slate-800 text-slate-600 border border-slate-200"}`}
              style={selectedUsers.includes(user) ? { backgroundColor: CHART_COLORS[selectedUsers.indexOf(user) % CHART_COLORS.length] } : {}}>
              {user.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>
      <div className="p-6 h-80">
        {selectedUsers.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">Select engineers to view trends</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} />
              <RechartsTooltip contentStyle={{ backgroundColor: "#0f172a", borderRadius: 12, border: "none" }} />
              <Legend />
              {selectedUsers.map((user, idx) => (
                <Area key={user} type="monotone" dataKey={user} name={user} stroke={CHART_COLORS[idx % CHART_COLORS.length]} fill={CHART_COLORS[idx % CHART_COLORS.length]} fillOpacity={0.2} strokeWidth={2} dot={false} />
              ))}
              {compareMode === "gst" && <Line type="monotone" dataKey="compare_gst" name="GST Total" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} />}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN DASHBOARD
// ============================================================================
const AnalyticsDashboard = ({ filterOwner }) => {
  const { theme, currentUser, analyticsData, analyticsLoading, fetchAnalyticsData } = useTicketStore();
  const [currentQuarter, setCurrentQuarter] = useState("Q4_25");
  const [excludeZendesk, setExcludeZendesk] = useState(false);
  const [viewMode, setViewMode] = useState("gst");

  const resolvedCurrentUser = useMemo(() => {
    if (!currentUser?.name) return null;
    const cleanName = currentUser.name.toLowerCase().trim();
    return Object.values(FLAT_TEAM_MAP).find(name => cleanName.includes(name.toLowerCase()) || name.toLowerCase().includes(cleanName)) || currentUser.name;
  }, [currentUser]);

  const isGSTUser = useMemo(() => resolvedCurrentUser && Object.values(FLAT_TEAM_MAP).includes(resolvedCurrentUser), [resolvedCurrentUser]);

  useEffect(() => {
    fetchAnalyticsData({ quarter: currentQuarter, excludeZendesk, owner: filterOwner !== "All" ? filterOwner : null });
  }, [currentQuarter, excludeZendesk, filterOwner, fetchAnalyticsData]);

  const handleQuarterChange = useCallback((quarter) => setCurrentQuarter(quarter), []);
  const handleRefresh = () => fetchAnalyticsData({ quarter: currentQuarter, excludeZendesk, forceRefresh: true });

  return (
    <div className="space-y-8 p-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button onClick={() => setViewMode("gst")}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${viewMode === "gst" ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm" : "text-slate-500"}`}>
              <Users className="w-4 h-4" /> GST View
            </button>
            <button onClick={() => setViewMode("global")}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${viewMode === "global" ? "bg-white dark:bg-slate-700 text-emerald-600 shadow-sm" : "text-slate-500"}`}>
              <Globe className="w-4 h-4" /> Global View
            </button>
          </div>
          {resolvedCurrentUser && (
            <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full">
              👤 {resolvedCurrentUser} {isGSTUser && <span className="text-emerald-500">(GST)</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setExcludeZendesk(!excludeZendesk)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border ${excludeZendesk ? "bg-slate-800 text-white border-slate-800" : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200"}`}>
            {excludeZendesk ? <Check className="w-3 h-3" /> : <ListFilter className="w-3 h-3" />} Exclude Zendesk
          </button>
          <button onClick={handleRefresh} disabled={analyticsLoading}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-indigo-600 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${analyticsLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <PerformanceMetricsCards stats={analyticsData?.stats} trends={analyticsData?.trends} currentQuarter={currentQuarter} onQuarterChange={handleQuarterChange} isLoading={analyticsLoading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CSATLeaderboard leaderboard={analyticsData?.leaderboard} isLoading={analyticsLoading} />
        <IndividualCharts individualTrends={analyticsData?.individualTrends} currentUser={resolvedCurrentUser} isGSTUser={isGSTUser} />
      </div>

      {/* MISSING CHARTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ticket Creation Chart */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" /> Ticket Creation Trend
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analyticsData?.trends || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip />
                <Area type="monotone" dataKey="solved" name="Tickets Closed" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* RWT Trend Chart */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-violet-500" /> RWT Trend
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analyticsData?.trends || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip />
                <Area type="monotone" dataKey="avgRWT" name="Avg RWT (hrs)" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Backlog Clearance Chart */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <Check className="w-5 h-5 text-emerald-500" /> Backlog Clearance (&gt;15 days)
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analyticsData?.backlogCleared || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip />
                <Area type="monotone" dataKey="count" name="Old Tickets Cleared" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

      <DSATAlerts badTickets={analyticsData?.badTickets} isLoading={analyticsLoading} />
    </div>
  );
};

export default AnalyticsDashboard;