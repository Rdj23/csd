import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { getCSATStatus, FLAT_TEAM_MAP, TEAM_GROUPS } from "../utils";
import { useTicketStore } from "../store";

const HIDDEN_USERS = ["System", "DevRev Bot", "A", "V", "n", "Undefined", "null", "Anmol", "anmol-sawhney"];


// ============================================================================
// METRICS CONFIG
// ============================================================================
const METRICS = {
  volume: { label: "Incoming Volume", icon: ArrowUpRight, color: "#6366f1", desc: "Tickets Created" },
  solved: { label: "Solved", icon: CheckCircle, color: "#10b981", desc: "Tickets Solved" },
  rwt: { label: "Avg Resolution", icon: Clock, color: "#f59e0b", desc: "Hours to Solve" },
  backlog: { label: "Backlog Clearance", icon: ArchiveRestore, color: "#f97316", desc: "Solved (Age > 15 Days)" },
};

const QUARTERS = [
  { id: "Q4_25", label: "Q4 '25" },
  { id: "Q1_26", label: "Q1 '26" },
];

const CHART_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4", "#8b5cf6"];

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
  const getTicketDate = (t) => metric === "volume" ? t.created_date : t.actual_close_date;

  for (const t of tickets) {
    if (!isGlobal) {
      const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || t.owned_by?.[0]?.display_name || "";
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
      const diff = differenceInHours(parseISO(t.actual_close_date), parseISO(t.created_date));
      return diff > 0 ? diff : 0;
    }
    if (metric === "backlog") {
      if (!t.actual_close_date || !t.created_date) return 0;
      const ageInDays = differenceInDays(parseISO(t.actual_close_date), parseISO(t.created_date));
      return ageInDays > 15 ? 1 : 0;
    }
    return 0;
  };

  return daysInterval.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const dailyTickets = ticketsByDate[dateKey] || [];
    const subjectValues = dailyTickets.map(getTicketValue).filter((v) => v !== null);

    let mainVal = 0;
    if (metric === "rwt") {
      mainVal = subjectValues.length ? Math.round(subjectValues.reduce((a, b) => a + b, 0) / subjectValues.length) : 0;
    } else {
      mainVal = subjectValues.reduce((a, b) => a + b, 0);
    }

    return { name: format(day, "MMM dd"), main: mainVal, date: day };
  });
};

// Multi-user data for expanded view
const processMultiUserData = (tickets, metric, timeRange, selectedUsers, showTeam, showGST, currentUserTeamName) => {
  const end = new Date();
  const start = subDays(end, timeRange);
  const daysInterval = eachDayOfInterval({ start, end });

  const getTicketDate = (t) => metric === "volume" ? t.created_date : t.actual_close_date;
  const getTicketValue = (t) => {
    if (metric === "volume" || metric === "solved") return 1;
    if (metric === "rwt") {
      if (!t.created_date || !t.actual_close_date) return null;
      return Math.max(0, differenceInHours(parseISO(t.actual_close_date), parseISO(t.created_date)));
    }
    if (metric === "backlog") {
      if (!t.actual_close_date || !t.created_date) return 0;
      return differenceInDays(parseISO(t.actual_close_date), parseISO(t.created_date)) > 15 ? 1 : 0;
    }
    return 0;
  };

  
  const teamMembers = currentUserTeamName && TEAM_GROUPS[currentUserTeamName]
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
        const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || t.owned_by?.[0]?.display_name || "";
        return owner === user;
      });
      const values = userTickets.map(getTicketValue).filter((v) => v !== null);
      

      if (metric === "rwt") {
        dataPoint[user] = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
      } else {
        dataPoint[user] = values.reduce((a, b) => a + b, 0);
      }
    });

    
    // Team & GST comparison
    if (showTeam || showGST) {
      const teamTickets = dailyTickets.filter((t) => {
        const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || t.owned_by?.[0]?.display_name || "";
        return teamMembers.some((m) => owner.includes(m));
      });
      
      const gstTickets = dailyTickets.filter((t) => {
        const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || t.owned_by?.[0]?.display_name || "";
        return gstMembers.some((m) => owner.includes(m));
      });

      if (showTeam) {
        const teamVals = teamTickets.map(getTicketValue).filter((v) => v !== null);
        dataPoint["compare_team"] = metric === "rwt" && teamVals.length
          ? Math.round(teamVals.reduce((a, b) => a + b, 0) / teamVals.length)
          : teamVals.reduce((a, b) => a + b, 0);
      }

      if (showGST) {
        const gstVals = gstTickets.map(getTicketValue).filter((v) => v !== null);
        dataPoint["compare_gst"] = metric === "rwt" && gstVals.length
          ? Math.round(gstVals.reduce((a, b) => a + b, 0) / gstVals.length)
          : gstVals.reduce((a, b) => a + b, 0);
      }
    }

    return dataPoint;
  });
};

// ============================================================================
// PERFORMANCE METRICS CARDS (Server-side data)
// ============================================================================
const PerformanceMetricsCards = ({ stats, trends, onQuarterChange, currentQuarter, isLoading }) => {
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarter || "Q4_25");

  const handleQuarterChange = (qId) => {
    setSelectedQuarter(qId);
    onQuarterChange(qId);
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
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
          <Icon className="w-4 h-4 text-slate-500" />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-black text-slate-800 dark:text-white">{isLoading ? "..." : value}</span>
        <span className="text-sm font-semibold text-slate-400">{unit}</span>
      </div>
      <div className="h-12 w-full mt-auto">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={getSparklineData(sparkKey)}>
            <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.2} strokeWidth={2} dot={false} />
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard title="Avg RWT" value={stats?.avgRWT || "0.0"} unit="Hrs" color="#8b5cf6" sparkKey="avgRWT" icon={Clock} />
        <MetricCard title="Positive CSAT" value={stats?.positiveCSAT || 0} unit="Count" color="#10b981" sparkKey="csat" icon={Smile} />
        <MetricCard title="FRR Met" value={`${stats?.frrPercent || 0}`} unit="%" color="#f59e0b" sparkKey="frrPercent" icon={Zap} />
        <MetricCard title="Avg Iterations" value={stats?.avgIterations || "0.0"} unit="" color="#3b82f6" sparkKey="avgIterations" icon={Layers} />
        <MetricCard title="Avg FRT" value={stats?.avgFRT || "0.0"} unit="Hrs" color="#f43f5e" sparkKey="avgFRT" icon={TrendingUp} />
      </div>
    </div>
  );
};

// ============================================================================
// SMART INSIGHTS PANEL
// ============================================================================
const SmartInsights = ({ data, metric, showTeam, showGST, selectedUsers, myTeamName }) => {
  if (!selectedUsers || selectedUsers.length === 0) {
    return (
      <div className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 mb-6 flex flex-col items-center justify-center text-center">
        <Users className="w-6 h-6 text-indigo-400 mb-3" />
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">No Assignee Selected</h3>
        <p className="text-xs text-slate-500 max-w-xs mt-1">Select users from the dropdown to see performance stats.</p>
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  const calculateSelectedTotal = (dataset) => {
    return dataset.reduce((acc, day) => {
      let dailySum = 0;
      selectedUsers.forEach(user => { dailySum += (day[user] || 0); });
      return acc + dailySum;
    }, 0);
  };

  const myTotal = calculateSelectedTotal(data);
  const teamTotal = data.reduce((acc, d) => acc + (d.compare_team || 0), 0);
  const gstTotal = data.reduce((acc, d) => acc + (d.compare_gst || 0), 0);

  const teamSize = myTeamName && TEAM_GROUPS[myTeamName?.replace("Team ", "")] 
    ? Object.values(TEAM_GROUPS[myTeamName.replace("Team ", "")]).length : 5;
  const teamAvg = teamTotal > 0 ? Math.round(teamTotal / teamSize) : 0;

  const gstSize = Object.values(FLAT_TEAM_MAP).length || 20;
  const gstAvg = gstTotal > 0 ? Math.round(gstTotal / gstSize) : 0;

  const mid = Math.floor(data.length / 2);
  const firstHalfTotal = calculateSelectedTotal(data.slice(0, mid));
  const secondHalfTotal = calculateSelectedTotal(data.slice(mid));
  const trendDiff = secondHalfTotal - firstHalfTotal;
  const trendPcent = firstHalfTotal > 0 ? Math.round((trendDiff / firstHalfTotal) * 100) : 100;

  const isGroup = selectedUsers.length > 1;
  const subjectLabel = isGroup ? "Group Velocity" : "My Velocity";
  const subjectText = isGroup ? "Selected users" : "You";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-slate-900 border border-indigo-100 dark:border-indigo-500/20 p-4 rounded-2xl shadow-sm relative overflow-hidden">
        <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-1">{subjectLabel}</h4>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-800 dark:text-white">{myTotal}</span>
          <span className="text-xs text-slate-500 font-medium">{METRICS[metric]?.desc || "Units"}</span>
        </div>
        <div className={`text-xs font-bold mt-2 flex items-center gap-1 ${trendDiff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
          {trendDiff >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(trendPcent)}% {trendDiff >= 0 ? 'Increase' : 'Decrease'}
        </div>
      </div>

      {showTeam ? (
        <div className="bg-gradient-to-br from-violet-50 to-white dark:from-violet-900/20 dark:to-slate-900 border border-violet-100 dark:border-violet-500/20 p-4 rounded-2xl shadow-sm">
          <h4 className="text-xs font-bold text-violet-500 uppercase tracking-wider mb-1">Vs {myTeamName || "Team"}</h4>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-800 dark:text-white">
              {myTotal - teamAvg > 0 ? `+${myTotal - teamAvg}` : myTotal - teamAvg}
            </span>
            <span className="text-xs text-slate-500 font-medium">vs Team Avg</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {subjectText} contributed <strong className="text-violet-600">{Math.round((myTotal / (teamTotal || 1)) * 100)}%</strong> of team's volume.
          </p>
        </div>
      ) : (
        <div className="border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-center text-xs text-slate-400">
          Select "Vs Team" to see analysis
        </div>
      )}

      {showGST ? (
        <div className="bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/20 dark:to-slate-900 border border-emerald-100 dark:border-emerald-500/20 p-4 rounded-2xl shadow-sm">
          <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-1">Vs Global (GST)</h4>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-800 dark:text-white">
              {Math.round((myTotal / (gstAvg || 1)) * 100)}%
            </span>
            <span className="text-xs text-slate-500 font-medium">of Avg Load</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Global Avg: <strong>{gstAvg}</strong>. {subjectText} {myTotal > gstAvg ? "leading" : "trailing"} by <strong className="text-emerald-600">{Math.abs(myTotal - gstAvg)}</strong>.
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
// DSAT ALERTS (Only for GST users, only active/unsolved)
// ============================================================================
const DSATAlerts = ({ badTickets = [], isLoading, isGSTUser }) => {
  const [showAll, setShowAll] = useState(false);
  
  // Filter to only show active (unsolved) DSAT tickets
  const activeBAD = badTickets.filter(t => {
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
          <AlertCircle className="w-5 h-5" /> Active Negative Feedback ({activeBAD.length})
        </h3>
        {activeBAD.length > 6 && (
          <button onClick={() => setShowAll(!showAll)} className="text-xs font-semibold text-rose-600 flex items-center gap-1">
            {showAll ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showAll ? "Show Less" : `Show All`}
          </button>
        )}
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayTickets.map((t) => (
          <div key={t.id || t.display_id} className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-rose-100 dark:border-rose-900/30 group">
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
// MAIN DASHBOARD
// ============================================================================
const AnalyticsDashboard = ({ tickets = [], filterOwner }) => {
  const { theme, currentUser, analyticsData, analyticsLoading, fetchAnalyticsData } = useTicketStore();
  const [currentQuarter, setCurrentQuarter] = useState("Q4_25");
  const [excludeZendesk, setExcludeZendesk] = useState(false);
  const [viewMode, setViewMode] = useState("gst");
  const [expandedMetric, setExpandedMetric] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [showTeam, setShowTeam] = useState(false);
  const [showGST, setShowGST] = useState(false);
  const [timeRange, setTimeRange] = useState(30);
  const [groupBy, setGroupBy] = useState("daily"); // daily, weekly, monthly

  const isDark = theme === "dark";

     const serverTrends = analyticsData?.trends || [];

  // Resolve current user to GST roster name
  const resolvedCurrentUser = useMemo(() => {
    if (!currentUser?.name) return null;
    const cleanName = currentUser.name.toLowerCase().trim();
    return Object.values(FLAT_TEAM_MAP).find(name => 
      cleanName.includes(name.toLowerCase()) || name.toLowerCase().includes(cleanName)
    ) || currentUser.name;
  }, [currentUser]);

  const isGSTUser = useMemo(() => 
    resolvedCurrentUser && Object.values(FLAT_TEAM_MAP).includes(resolvedCurrentUser), 
  [resolvedCurrentUser]);

  // Get user's team
  const myTeamName = useMemo(() => {
    const foundTeamKey = Object.keys(TEAM_GROUPS).find(groupKey => {
      const groupMembers = Object.values(TEAM_GROUPS[groupKey]);
      return groupMembers.includes(resolvedCurrentUser);
    });
    return foundTeamKey ? `Team ${foundTeamKey}` : "Team Mashnu";
  }, [resolvedCurrentUser]);

  // GST-only user list for dropdowns
  const gstUserNames = useMemo(() => Object.values(FLAT_TEAM_MAP).sort(), []);

  // Initialize selected users with current user if GST
  useEffect(() => {
    if (isGSTUser && resolvedCurrentUser && selectedUsers.length === 0) {
      setSelectedUsers([resolvedCurrentUser]);
    }
  }, [isGSTUser, resolvedCurrentUser]);

  // Fetch server-side analytics
  useEffect(() => {
    fetchAnalyticsData({ quarter: currentQuarter, excludeZendesk, owner: filterOwner !== "All" ? filterOwner : null, groupBy });
  }, [currentQuarter, excludeZendesk, filterOwner, fetchAnalyticsData,groupBy]);

  const handleQuarterChange = useCallback((quarter) => setCurrentQuarter(quarter), []);
  const handleRefresh = () => fetchAnalyticsData({ quarter: currentQuarter, excludeZendesk, forceRefresh: true });

 
  // Chart data from server trends
  const smallChartData = useMemo(() => {
    const serverTrends = analyticsData?.trends || [];
    
    return {
      volume: serverTrends.map(t => ({ name: t.date, main: t.solved || 0 })),
      solved: serverTrends.map(t => ({ name: t.date, main: t.solved || 0 })),
      rwt: serverTrends.map(t => ({ name: t.date, main: t.avgRWT || 0 })),
      backlog: serverTrends.map(t => ({ name: t.date, main: t.backlogCleared || 0 })),
    };
  }, [analyticsData]);
  // Expanded chart data - use server individualTrends
  const expandedData = useMemo(() => {
    if (!expandedMetric) return [];
    
    const individualTrends = analyticsData?.individualTrends || {};
    const allDates = new Set();
    
    // Collect all dates from selected users
    selectedUsers.forEach(user => {
      (individualTrends[user] || []).forEach(d => allDates.add(d.date));
    });
    
    const sortedDates = Array.from(allDates).sort();
    
    return sortedDates.slice(-timeRange).map(date => {
      const dataPoint = { name: format(parseISO(date), "MMM dd"), date };
      
      selectedUsers.forEach(user => {
        const userDay = (individualTrends[user] || []).find(d => d.date === date);
        if (expandedMetric === "volume") {
          dataPoint[user] = userDay?.created || 0;
        } else if (expandedMetric === "solved") {
          dataPoint[user] = userDay?.solved || 0;
        } else if (expandedMetric === "rwt") {
          dataPoint[user] = userDay?.avgRWT || 0;
        } else if (expandedMetric === "backlog") {
          dataPoint[user] = userDay?.backlogCleared || 0;
        }
      });
      
      // Team & GST totals
      if (showTeam || showGST) {
        let teamTotal = 0, gstTotal = 0;
        Object.entries(individualTrends).forEach(([user, days]) => {
          const dayData = days.find(d => d.date === date);
          if (dayData) {
            const val = expandedMetric === "solved" ? dayData.solved : 
                       expandedMetric === "rwt" ? dayData.avgRWT : 
                       expandedMetric === "backlog" ? dayData.backlogCleared : 0;
            gstTotal += val || 0;
            // Check if user is in current user's team
            const myTeamMembers = TEAM_GROUPS[myTeamName?.replace("Team ", "")] || {};
            if (Object.values(myTeamMembers).includes(user)) {
              teamTotal += val || 0;
            }
          }
        });
        if (showTeam) dataPoint.compare_team = teamTotal;
        if (showGST) dataPoint.compare_gst = gstTotal;
      }
      
      return dataPoint;
    });
  }, [analyticsData, expandedMetric, timeRange, selectedUsers, showTeam, showGST, myTeamName]);
  const colors = {
    grid: isDark ? "#1e293b" : "#f1f5f9",
    text: isDark ? "#94a3b8" : "#64748b",
    tooltipBg: isDark ? "#0f172a" : "#ffffff",
  };

  return (
    <div className="space-y-8 p-6 max-w-[1600px] mx-auto">
      {/* TOP CONTROLS */}
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

      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {[
              { id: "daily", label: "Daily" },
              { id: "weekly", label: "Weekly" },
              { id: "monthly", label: "Monthly" },
            ].map(g => (
              <button key={g.id} onClick={() => setGroupBy(g.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${groupBy === g.id ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {g.label}
              </button>
            ))}
          </div>

      {/* PERFORMANCE METRICS */}
      <PerformanceMetricsCards 
        stats={analyticsData?.stats} 
        trends={analyticsData?.trends} 
        currentQuarter={currentQuarter} 
        onQuarterChange={handleQuarterChange} 
        isLoading={analyticsLoading} 
      />

      {/* 4 METRIC CHARTS */}
      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-8 mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5 text-indigo-500" /> Performance Analytics
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(METRICS).map(([key, config]) => (
          <div key={key} className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 relative group hover:border-indigo-500/30 transition-colors">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                  <config.icon className="w-4 h-4" style={{ color: config.color }} /> {config.label}
                </h3>
                <p className="text-xs text-slate-500">{config.desc}</p>
              </div>
              <button
                onClick={() => { setExpandedMetric(key); setShowTeam(false); setShowGST(false); }}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-indigo-500 transition-colors"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            <div className="h-[160px] w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={smallChartData[key]}>
                  <defs>
                    <linearGradient id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={config.color} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={config.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="name" tick={{ fill: colors.text, fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis tick={{ fill: colors.text, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <RechartsTooltip formatter={(value) => [`${value}`, config.desc]} contentStyle={{ backgroundColor: colors.tooltipBg, borderRadius: "8px", border: "none" }} />
                  <Area type="monotone" dataKey="main" stroke={config.color} fill={`url(#grad-${key})`} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {/* CSAT + DSAT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CSATLeaderboard leaderboard={analyticsData?.leaderboard} isLoading={analyticsLoading} />
        <DSATAlerts badTickets={tickets.filter(t => getCSATStatus(t) === "Bad")} isLoading={analyticsLoading} isGSTUser={isGSTUser} />
      </div>

      {/* EXPANDED MODAL */}
      {expandedMetric && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="absolute inset-0" onClick={() => setExpandedMetric(null)}></div>

          <div className="bg-white dark:bg-slate-900 w-[95vw] h-[90vh] rounded-3xl shadow-2xl border border-white/10 relative flex flex-col z-10 overflow-hidden">
            {/* HEADER */}
            <div className="px-8 py-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-center shrink-0 rounded-t-3xl">
              <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ backgroundColor: `${METRICS[expandedMetric].color}20` }}>
                  {React.createElement(METRICS[expandedMetric].icon, { className: "w-6 h-6", style: { color: METRICS[expandedMetric].color } })}
                </div>
                {METRICS[expandedMetric].label} Analysis
              </h2>
              <button onClick={() => setExpandedMetric(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
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
                      {selectedUsers.length > 0 ? `${selectedUsers.length} Users Selected` : "Select Users..."}
                    </span>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </button>

                <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-2 hidden group-hover:block max-h-[60vh] overflow-y-auto z-[60]">
                  {gstUserNames.map((user) => (
                    <label key={user} className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedUsers([...selectedUsers, user]);
                          else setSelectedUsers(selectedUsers.filter((u) => u !== user));
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-200">{user}</span>
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
                className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${showTeam ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 text-indigo-600" : "border-transparent text-slate-500 hover:bg-slate-100"}`}
              >
                <div className={`w-3 h-3 rounded-full border ${showTeam ? "bg-indigo-500 border-indigo-500" : "border-slate-400"}`}></div>
                Vs Team
              </button>

              <button
                onClick={() => setShowGST(!showGST)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${showGST ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 text-emerald-600" : "border-transparent text-slate-500 hover:bg-slate-100"}`}
              >
                <div className={`w-3 h-3 rounded-full border ${showGST ? "bg-emerald-500 border-emerald-500" : "border-slate-400"}`}></div>
                Vs GST
              </button>
            </div>

            {/* INSIGHTS */}
            <div className="px-8 pt-6 pb-2 bg-slate-50/50 dark:bg-slate-900/50">
              <SmartInsights data={expandedData} metric={expandedMetric} showTeam={showTeam} showGST={showGST} selectedUsers={selectedUsers} myTeamName={myTeamName} />
            </div>

            {/* CHART */}
            <div className="flex-1 w-full bg-slate-50/50 dark:bg-slate-900/50 p-6 relative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={expandedData} margin={{ top: 20, right: 30, left: 10, bottom: 0 }}>
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

                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#1e293b" : "#e2e8f0"} />
                  <XAxis dataKey="name" tick={{ fill: isDark ? "#94a3b8" : "#64748b", fontSize: 11, fontWeight: 500 }} axisLine={false} tickLine={false} dy={10} minTickGap={30} />
                  <YAxis tick={{ fill: isDark ? "#94a3b8" : "#64748b", fontSize: 11, fontWeight: 500 }} axisLine={false} tickLine={false} />
                  <RechartsTooltip contentStyle={{ backgroundColor: isDark ? "#0f172a" : "#ffffff", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)" }} />
                  <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="circle" />

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
                    <Area type="monotone" dataKey="compare_team" name="Team Total" stroke="#6366f1" fill="none" strokeWidth={3} />
                  )}
                  {showGST && (
                    <Area type="monotone" dataKey="compare_gst" name="GST Total" stroke="#10b981" fill="none" strokeWidth={3} />
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