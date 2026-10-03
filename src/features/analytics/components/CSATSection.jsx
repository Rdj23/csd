// ============================================================================
// CSAT LEADERBOARD COMPONENT
// ============================================================================
import React from "react";
import { Crown, Medal, Smile } from "lucide-react";

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

export default CSATLeaderboard;
