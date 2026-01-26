// ============================================================================
// PERFORMANCE OVERVIEW SECTION - KPI Cards with Sparklines and Insights
// ============================================================================
import React, { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  Check,
  Clock,
  Layers,
  ListFilter,
  Maximize2,
  RefreshCw,
  Smile,
  TrendingUp,
  TrendingDown,
  Trophy,
  Zap,
  Activity,
} from "lucide-react";
import { trackEvent } from "../../utils/clevertap";

// Week definitions for Q1 (ISO 8601 - Monday to Sunday)
// ISO Week 1 is the first week with 4+ days in the new year
// Jan 1, 2026 = Wednesday, so Week 1 includes Dec 29-31 (2025) and Jan 1-4 (2026)
const Q1_WEEKS = [
  { id: 1, label: "W1", start: "2025-12-29", end: "2026-01-04", range: "Dec 29 - Jan 4" },
  { id: 2, label: "W2", start: "2026-01-05", end: "2026-01-11", range: "Jan 5-11" },
  { id: 3, label: "W3", start: "2026-01-12", end: "2026-01-18", range: "Jan 12-18" },
  { id: 4, label: "W4", start: "2026-01-19", end: "2026-01-25", range: "Jan 19-25" },
  { id: 5, label: "W5", start: "2026-01-26", end: "2026-02-01", range: "Jan 26 - Feb 1" },
  { id: 6, label: "W6", start: "2026-02-02", end: "2026-02-08", range: "Feb 2-8" },
];

// Month definitions with week ranges
const Q1_MONTHS = [
  { id: 1, label: "M1", name: "January", weeks: "W1-W4", range: "Jan 1-31" },
  { id: 2, label: "M2", name: "February", weeks: "W5-W8", range: "Feb 1-28" },
  { id: 3, label: "M3", name: "March", weeks: "W9-W13", range: "Mar 1-31" },
];

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
  excludeNOC,
  onExcludeNOCChange,
  onRefresh,
  isRefreshing,
  onExpandMetric,
}) => {
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarter || "Q1_26");
  const [groupBy, setGroupBy] = useState(currentGroupBy || "daily");
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);

  // Current quarter is Q1_26
  const isCurrentQuarter = selectedQuarter === "Q1_26";

  // Get current week and month numbers
  const today = new Date();
  const currentMonthNum = today.getMonth() >= 0 && today.getMonth() <= 2 ? today.getMonth() + 1 : 1;

  // Calculate current week number based on today's date
  const getCurrentWeekNum = () => {
    for (const week of Q1_WEEKS) {
      const weekEnd = new Date(week.end + "T23:59:59");
      if (today <= weekEnd) {
        return week.id;
      }
    }
    return Q1_WEEKS.length;
  };

  const currentWeekNum = getCurrentWeekNum();

  const handleQuarterChange = (qId) => {
    trackEvent("Analytics Quarter Changed", { Quarter: qId });
    setSelectedQuarter(qId);
    setGroupBy("daily");
    setSelectedWeek(null);
    setSelectedMonth(null);
    onQuarterChange(qId);
  };

  const handleGroupByChange = (g) => {
    if (!isCurrentQuarter) return;
    setGroupBy(g);
    setSelectedWeek(null);
    setSelectedMonth(null);
    onGroupByChange?.(g);
  };

  const handleWeekSelect = (weekId) => {
    if (weekId > currentWeekNum) return;
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
      value: key === "csat" ? t.positiveCSAT : key === "solved" ? t.solved : t[key] || 0,
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
      if (metricKey === "frrPercent") return t.frrPercent || 0; // ✅ FIX: Use frrPercent, not frrMet
      if (metricKey === "avgIterations") return t.avgIterations || 0;
      if (metricKey === "avgFRT") return t.avgFRT || 0;
      return 0;
    };

    const thisWeekAvg = thisWeek.reduce((a, t) => a + getValue(t), 0) / (thisWeek.length || 1);
    const lastWeekAvg = lastWeek.reduce((a, t) => a + getValue(t), 0) / (lastWeek.length || 1);
    const change = lastWeekAvg > 0 ? (((thisWeekAvg - lastWeekAvg) / lastWeekAvg) * 100).toFixed(1) : 0;

    const isLowerBetter = ["avgRWT", "avgFRT", "avgIterations"].includes(metricKey);
    const trendDirection = thisWeekAvg > lastWeekAvg ? "up" : thisWeekAvg < lastWeekAvg ? "down" : "stable";
    const isGood = isLowerBetter ? trendDirection === "down" : trendDirection === "up";

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
          : `${Math.abs(change)}% ${isLowerBetter ? "higher" : "lower"} than last week`,
    };
  };

  // Metric Card with Hover Insights - Enhanced with modern animations
  const MetricCard = ({ title, value, unit, color, sparkKey, icon: Icon, metricKey, onExpand, index = 0 }) => {
    const [isHovered, setIsHovered] = useState(false);
    const insights = getInsights(metricKey, value);

    return (
      <div
        className={`metric-card relative flex flex-col justify-between h-44 group cursor-pointer animate-slide-up stagger-${index + 1} ${isHovered ? 'z-10' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => onExpand && onExpand(metricKey)}
        style={{ animationDelay: `${index * 0.05}s` }}
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
              <span className={`text-xs font-bold ${insights.isGood ? "text-emerald-400" : insights.trendDirection === "stable" ? "text-slate-400" : "text-rose-400"}`}>
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
                <span className="font-medium text-slate-300">{insights.lastWeekAvg}</span>
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
      {/* Week Selector - Only when Weekly is selected for Q1_26 */}
      {isCurrentQuarter && groupBy === "weekly" && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
          <span className="text-xs font-medium text-slate-500 mr-2">Select Week:</span>
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
          <span className="text-xs font-medium text-slate-500 mr-2">Select Month:</span>
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
                <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 px-3 py-2 bg-slate-900 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20 shadow-xl">
                  <div className="font-bold mb-1">{month.name}</div>
                  <div className="text-slate-300">{month.range}</div>
                  <div className="text-indigo-300 mt-1">Weeks: {month.weeks}</div>
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

      {/* Header with Controls */}
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
            {excludeZendesk ? <Check className="w-3 h-3" /> : <ListFilter className="w-3 h-3" />}
            Exclude Zendesk
          </button>
          {/* Exclude NOC */}
          <button
            onClick={onExcludeNOCChange}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              excludeNOC
                ? "bg-rose-600 text-white border-rose-600"
                : "bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"
            }`}
          >
            {excludeNOC ? <Check className="w-3 h-3" /> : <ListFilter className="w-3 h-3" />}
            Exclude NOC
          </button>
          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-indigo-600 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Metric Cards - Animated grid */}
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
          index={0}
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
          index={1}
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
          index={2}
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
          index={3}
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
          index={4}
        />
      </div>
    </div>
  );
};

export default PerformanceMetricsCards;
