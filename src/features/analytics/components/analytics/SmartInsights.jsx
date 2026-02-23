// ============================================================================
// SMART INSIGHTS PANEL - Performance comparison insights
// ============================================================================
import React from "react";
import { Users, TrendingUp, TrendingDown } from "lucide-react";
import { METRICS } from "./analyticsConfig";
import { TEAM_GROUPS, FLAT_TEAM_MAP } from "../../../../utils";

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
  const subjectLabel = isGroup ? "Group Tickets" : "My Tickets";
  const subjectText = isGroup ? "Selected users" : "You";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* My/Group Tickets */}
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

      {/* Vs Team */}
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

      {/* Vs GST */}
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

export default SmartInsights;
