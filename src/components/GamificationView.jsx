import React, { useState, useEffect, useMemo } from "react";
import {
  Trophy,
  Medal,
  Award,
  TrendingUp,
  Clock,
  CheckCircle,
  Star,
  Users,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Calendar,
  Target,
  Zap,
  User,
  Eye,
} from "lucide-react";
import axios from "axios";
import { FLAT_TEAM_MAP } from "../utils";

const GamificationView = ({ quarter = "Q1_26", currentUser = null, isAdmin = false }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("L1");
  const [sortBy, setSortBy] = useState("rank");
  const [sortDir, setSortDir] = useState("asc");
  const [selectedGSTUser, setSelectedGSTUser] = useState(null);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // Get list of GST users for dropdown
  const gstUsers = useMemo(() => Object.values(FLAT_TEAM_MAP).sort(), []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";
      const res = await axios.get(`${API_BASE}/api/gamification?quarter=${quarter}`);
      setData(res.data);
    } catch (e) {
      console.error("Failed to load gamification data", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [quarter]);

  const getRankBadge = (rank) => {
    if (rank === 1) return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 text-white shadow-lg">
        <Trophy className="w-4 h-4" />
      </div>
    );
    if (rank === 2) return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow">
        <Medal className="w-4 h-4" />
      </div>
    );
    if (rank === 3) return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-600 text-white shadow">
        <Award className="w-4 h-4" />
      </div>
    );
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-sm font-bold">
        {rank}
      </div>
    );
  };

  const sortedData = () => {
    if (!data?.data?.[activeTab]) return [];
    const list = [...data.data[activeTab]];
    
    list.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      
      if (sortDir === "asc") return valA > valB ? 1 : -1;
      return valA < valB ? 1 : -1;
    });
    
    return list;
  };

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir(col === "rank" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return null;
    return sortDir === "asc" 
      ? <ChevronUp className="w-3 h-3" /> 
      : <ChevronDown className="w-3 h-3" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-500">Loading leaderboard...</p>
        </div>
      </div>
    );
  }

  const topThree = sortedData().slice(0, 3);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-xl shadow-lg">
              <Trophy className="w-6 h-6 text-white" />
            </div>
            GST Gamification
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* GST User Selector (Admin Only) */}
          {isAdmin && (
            <div className="relative">
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                  selectedGSTUser
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300"
                }`}
              >
                <Eye className="w-4 h-4" />
                {selectedGSTUser ? `View: ${selectedGSTUser}` : "View as GST User"}
                <ChevronDown className={`w-4 h-4 transition-transform ${showUserDropdown ? "rotate-180" : ""}`} />
              </button>

              {showUserDropdown && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => {
                      setSelectedGSTUser(null);
                      setShowUserDropdown(false);
                    }}
                    className={`w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 ${
                      !selectedGSTUser ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : ""
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    All Engineers (Admin View)
                  </button>
                  <div className="border-t border-slate-100 dark:border-slate-800" />
                  {gstUsers.map((user) => (
                    <button
                      key={user}
                      onClick={() => {
                        setSelectedGSTUser(user);
                        setShowUserDropdown(false);
                      }}
                      className={`w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 ${
                        selectedGSTUser === user ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : ""
                      }`}
                    >
                      <User className="w-4 h-4" />
                      {user}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab Switcher */}
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1 shadow-inner">
            {["L1", "L2"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  activeTab === tab
                    ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-md"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                {tab} Engineers ({data?.data?.[tab]?.length || 0})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Individual User Stats Card (when GST user is selected) */}
      {selectedGSTUser && (() => {
        const userData = [...(data?.data?.L1 || []), ...(data?.data?.L2 || [])].find(
          (eng) => eng.name === selectedGSTUser
        );
        if (!userData) return (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center">
            <p className="text-amber-700 dark:text-amber-400">No data found for {selectedGSTUser}</p>
          </div>
        );

        return (
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-2xl p-6 border border-indigo-200 dark:border-indigo-800 shadow-lg">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shadow-lg">
                  {userData.name.charAt(0)}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">{userData.name}</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{userData.designation} • {userData.team}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getRankBadge(userData.rank)}
                <span className="text-2xl font-bold text-slate-900 dark:text-white">#{userData.rank}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 text-center shadow">
                <p className="text-xs text-slate-500 mb-1">Days Worked</p>
                <p className="text-xl font-bold text-slate-800 dark:text-white">{userData.daysWorked}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 text-center shadow">
                <p className="text-xs text-slate-500 mb-1">Tickets Solved</p>
                <p className="text-xl font-bold text-emerald-600">{userData.solved}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 text-center shadow">
                <p className="text-xs text-slate-500 mb-1">Productivity</p>
                <p className="text-xl font-bold text-amber-600">{userData.productivity}/day</p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 text-center shadow">
                <p className="text-xs text-slate-500 mb-1">Avg RWT</p>
                <p className="text-xl font-bold text-purple-600">{userData.avgRWT}h</p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 text-center shadow">
                <p className="text-xs text-slate-500 mb-1">Avg Iterations</p>
                <p className="text-xl font-bold text-blue-600">{userData.avgIterations}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 text-center shadow">
                <p className="text-xs text-slate-500 mb-1">FRR %</p>
                <p className={`text-xl font-bold ${userData.frrPercent >= 50 ? "text-emerald-600" : userData.frrPercent >= 35 ? "text-amber-600" : "text-red-600"}`}>
                  {userData.frrPercent}%
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 text-center shadow">
                <p className="text-xs text-slate-500 mb-1">Positive CSAT</p>
                <p className="text-xl font-bold text-yellow-600">{userData.positiveCSAT}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-4 text-center shadow">
                <p className="text-xs text-slate-500 mb-1">Score</p>
                <p className="text-xl font-bold text-indigo-600">{userData.weightedAvg}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Top 3 Podium */}
      {topThree.length >= 3 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* 2nd Place */}
          <div className="transform translate-y-4">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 shadow-lg hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between mb-3">
                {getRankBadge(2)}
                <span className="text-xs font-medium text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-full">{topThree[1]?.team}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">{topThree[1]?.name}</h3>
              <p className="text-xs text-slate-500 mb-3">{topThree[1]?.designation}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                  <CheckCircle className="w-3 h-3 text-emerald-500" />
                  <span className="font-semibold">{topThree[1]?.solved}</span> solved
                </div>
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                  <Target className="w-3 h-3 text-blue-500" />
                  <span className="font-semibold">{topThree[1]?.frrPercent}%</span> FRR
                </div>
              </div>
            </div>
          </div>

          {/* 1st Place */}
          <div className="transform -translate-y-2">
            <div className="bg-gradient-to-br from-yellow-50 to-amber-100 dark:from-yellow-900/30 dark:to-amber-900/30 rounded-2xl p-6 border-2 border-yellow-300 dark:border-yellow-700 shadow-xl hover:shadow-2xl transition-shadow relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-yellow-300/20 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="flex items-center justify-between mb-3 relative z-10">
                {getRankBadge(1)}
                <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400 bg-yellow-200 dark:bg-yellow-900/50 px-2 py-1 rounded-full">{topThree[0]?.team}</span>
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{topThree[0]?.name}</h3>
              <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-3 font-medium">{topThree[0]?.designation} • Champion 🏆</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="font-bold">{topThree[0]?.solved}</span> solved
                </div>
                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <Target className="w-3.5 h-3.5 text-blue-500" />
                  <span className="font-bold">{topThree[0]?.frrPercent}%</span> FRR
                </div>
                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <Clock className="w-3.5 h-3.5 text-purple-500" />
                  <span className="font-bold">{topThree[0]?.avgRWT}h</span> RWT
                </div>
                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-bold">{topThree[0]?.positiveCSAT}</span> CSAT
                </div>
              </div>
            </div>
          </div>

          {/* 3rd Place */}
          <div className="transform translate-y-4">
            <div className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-2xl p-5 border border-orange-200 dark:border-orange-800 shadow-lg hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between mb-3">
                {getRankBadge(3)}
                <span className="text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/50 px-2 py-1 rounded-full">{topThree[2]?.team}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">{topThree[2]?.name}</h3>
              <p className="text-xs text-slate-500 mb-3">{topThree[2]?.designation}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                  <CheckCircle className="w-3 h-3 text-emerald-500" />
                  <span className="font-semibold">{topThree[2]?.solved}</span> solved
                </div>
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                  <Target className="w-3 h-3 text-blue-500" />
                  <span className="font-semibold">{topThree[2]?.frrPercent}%</span> FRR
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Leaderboard Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                {[
                  { key: "rank", label: "#", width: "w-16" },
                  { key: "name", label: "Engineer", width: "w-40" },
                  { key: "team", label: "Team", width: "w-28" },
                  { key: "daysWorked", label: "Days", width: "w-20" },
                  { key: "solved", label: "Solved", width: "w-24" },
                  { key: "productivity", label: "Productivity", width: "w-28" },
                  { key: "avgRWT", label: "RWT (hrs)", width: "w-24" },
                  { key: "avgIterations", label: "Iterations", width: "w-24" },
                  { key: "frrPercent", label: "FRR %", width: "w-24" },
                  { key: "positiveCSAT", label: "CSAT", width: "w-20" },
                  { key: "weightedAvg", label: "Score", width: "w-24" },
                ].map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${col.width}`}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      <SortIcon col={col.key} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sortedData().map((eng, idx) => (
                <tr 
                  key={eng.name} 
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                    idx < 3 ? "bg-gradient-to-r from-transparent via-yellow-50/30 to-transparent dark:via-yellow-900/10" : ""
                  }`}
                >
                  <td className="px-4 py-3">{getRankBadge(eng.rank)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold shadow">
                        {eng.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white text-sm">{eng.name}</p>
                        <p className="text-xs text-slate-400">{eng.designation}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{eng.team}</td>
                  <td className="px-4 py-3 font-mono text-sm">{eng.daysWorked}</td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-slate-900 dark:text-white">{eng.solved}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{eng.productivity}</span>
                      <span className="text-xs text-slate-400">/day</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">{eng.avgRWT}h</td>
                  <td className="px-4 py-3 font-mono text-sm">{eng.avgIterations}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                      eng.frrPercent >= 50 
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400" 
                        : eng.frrPercent >= 35
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400"
                    }`}>
                      {eng.frrPercent}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-amber-400" />
                      <span className="font-semibold">{eng.positiveCSAT}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-bold ${
                      eng.rank === 1 
                        ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-white shadow"
                        : eng.rank <= 3
                          ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          : "text-slate-500"
                    }`}>
                      {eng.weightedAvg}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400 justify-center">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-emerald-500" />
          <span>FRR ≥50%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <span>FRR 35-49%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>FRR &lt;35%</span>
        </div>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>Productivity = Solved ÷ Days Worked</span>
      </div>
    </div>
  );
};

export default GamificationView;