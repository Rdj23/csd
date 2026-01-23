import React, { useState, useEffect, useMemo } from "react";
import {
  Trophy,
  Medal,
  Award,
  Clock,
  CheckCircle,
  Star,
  Users,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Target,
  Zap,
  User,
  Shield,
} from "lucide-react";
import axios from "axios";
import { FLAT_TEAM_MAP } from "../utils";

// Map email to GST name
const EMAIL_TO_NAME_MAP = {
  "rohan.jadhav@clevertap.com": "Rohan",
  "archie@clevertap.com": "Archie",
  "neha.yadav@clevertap.com": "Neha",
  "shreya.khale@clevertap.com": "Shreya",
  "vaibhav.agarwal@clevertap.com": "Vaibhav",
  "adarsh@clevertap.com": "Adarsh",
  "abhishek.vishwakarma@clevertap.com": "Abhishek",
  "shubhankar@clevertap.com": "Shubhankar",
  "musaveer.manekia@clevertap.com": "Musaveer",
  "anurag.ghatge@clevertap.com": "Anurag",
  "debashish.muni@clevertap.com": "Debashish",
  "aditya.mishra@clevertap.com": "Aditya",
  "shweta.m@clevertap.com": "Shweta",
  "nikita.narwani@clevertap.com": "Nikita",
  "mohammed.khan@clevertap.com": "Tuaha Khan",
  "harsh.singh@clevertap.com": "Harsh",
  "tamanna.khan@clevertap.com": "Tamanna",
  "shreyas.naikwadi@clevertap.com": "Shreyas",
  "adish@clevertap.com": "Adish",
};

const GamificationView = ({ quarter = "Q1_26", currentUser = null, isAdmin = false }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("L1");
  const [sortBy, setSortBy] = useState("rank");
  const [sortDir, setSortDir] = useState("asc");
  const [viewAsGST, setViewAsGST] = useState(false); // Admin toggle to view as GST user

  // Resolve current user's GST name from email
  const currentUserName = useMemo(() => {
    if (!currentUser?.email) return null;
    return EMAIL_TO_NAME_MAP[currentUser.email.toLowerCase()] || null;
  }, [currentUser]);

  // Determine if we should show full leaderboard or just user's card
  const showFullLeaderboard = isAdmin && !viewAsGST;

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

  // Get current user's data
  const currentUserData = useMemo(() => {
    if (!currentUserName || !data) return null;
    return [...(data?.data?.L1 || []), ...(data?.data?.L2 || [])].find(
      (eng) => eng.name === currentUserName
    );
  }, [currentUserName, data]);

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

  // Helper to get color class based on percentile
  const getPercentileColor = (percentile) => {
    if (percentile >= 80) return "text-emerald-600";
    if (percentile >= 60) return "text-blue-600";
    if (percentile >= 40) return "text-amber-600";
    return "text-red-600";
  };

  const getPercentileBgColor = (percentile) => {
    if (percentile >= 80) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400";
    if (percentile >= 60) return "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400";
    if (percentile >= 40) return "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400";
    return "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400";
  };

  // Individual User Stats Card Component
  const UserStatsCard = ({ userData, showRank = true }) => {
    if (!userData) return (
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center">
        <p className="text-amber-700 dark:text-amber-400">No data found for your profile</p>
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
          {showRank && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                {getRankBadge(userData.rank)}
                <span className="text-2xl font-bold text-slate-900 dark:text-white">#{userData.rank}</span>
              </div>
              <span className={`text-lg font-bold ${getPercentileColor(userData.percentile)}`}>
                {userData.percentile}%
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow">
            <p className="text-xs text-slate-500 mb-1">Days Worked</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white">{userData.daysWorked}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow">
            <p className="text-xs text-slate-500 mb-1">Solved</p>
            <p className="text-xl font-bold text-emerald-600">{userData.solved}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow">
            <p className="text-xs text-slate-500 mb-1">Productivity (30%)</p>
            <p className={`text-xl font-bold ${getPercentileColor(userData.productivityPercentile)}`}>
              {userData.productivityPercentile ?? 0}%
            </p>
            <p className="text-xs text-slate-400 mt-1">{userData.productivity}/day</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow">
            <p className="text-xs text-slate-500 mb-1">CSAT % (15%)</p>
            <p className={`text-xl font-bold ${getPercentileColor(userData.csatPercentPercentile)}`}>
              {userData.csatPercentPercentile ?? 0}%
            </p>
            <p className="text-xs text-slate-400 mt-1">{userData.csatPercent}%</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow">
            <p className="text-xs text-slate-500 mb-1"># CSATs (10%)</p>
            <p className={`text-xl font-bold ${getPercentileColor(userData.positiveCSATPercentile)}`}>
              {userData.positiveCSATPercentile ?? 0}%
            </p>
            <p className="text-xs text-slate-400 mt-1">{userData.positiveCSAT} positive</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow">
            <p className="text-xs text-slate-500 mb-1">RWT (15%)</p>
            <p className={`text-xl font-bold ${getPercentileColor(userData.avgRWTPercentile)}`}>
              {userData.avgRWTPercentile ?? 0}%
            </p>
            <p className="text-xs text-slate-400 mt-1">{userData.avgRWT}h avg</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow">
            <p className="text-xs text-slate-500 mb-1">Iterations (15%)</p>
            <p className={`text-xl font-bold ${getPercentileColor(userData.avgIterationsPercentile)}`}>
              {userData.avgIterationsPercentile ?? 0}%
            </p>
            <p className="text-xs text-slate-400 mt-1">{userData.avgIterations} avg</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow">
            <p className="text-xs text-slate-500 mb-1">FRR (15%)</p>
            <p className={`text-xl font-bold ${getPercentileColor(userData.frrPercentPercentile)}`}>
              {userData.frrPercentPercentile ?? 0}%
            </p>
            <p className="text-xs text-slate-400 mt-1">{userData.frrPercent}%</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center shadow border-2 border-indigo-300 dark:border-indigo-700">
            <p className="text-xs text-slate-500 mb-1">Final Percentile</p>
            <p className={`text-xl font-bold ${getPercentileColor(userData.percentile)}`}>
              {userData.percentile ?? 0}%
            </p>
            <p className="text-xs text-slate-400 mt-1">weighted</p>
          </div>
        </div>
      </div>
    );
  };

  // GST User View (non-admin) - Only show their own card
  if (!isAdmin) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-xl shadow-lg">
                <Trophy className="w-6 h-6 text-white" />
              </div>
              My Performance
            </h1>
            <p className="text-sm text-slate-500 mt-1">Your individual stats for {quarter.replace("_", " ")}</p>
          </div>
        </div>

        {/* User's Stats Card */}
        <UserStatsCard userData={currentUserData} showRank={false} />
      </div>
    );
  }

  // Admin View
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-xl shadow-lg">
              <Trophy className="w-6 h-6 text-white" />
            </div>
            {viewAsGST ? "My Performance" : "GST Gamification"}
          </h1>
          {viewAsGST && (
            <p className="text-sm text-slate-500 mt-1">Viewing as: {currentUserName || currentUser?.email}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Admin/GST View Toggle */}
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1 shadow-inner">
            <button
              onClick={() => setViewAsGST(false)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                !viewAsGST
                  ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-md"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Shield className="w-4 h-4" />
              Admin View
            </button>
            <button
              onClick={() => setViewAsGST(true)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                viewAsGST
                  ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-md"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <User className="w-4 h-4" />
              My Stats
            </button>
          </div>

          {/* Tab Switcher (only in Admin View) */}
          {!viewAsGST && (
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
                  {tab} ({data?.data?.[tab]?.length || 0})
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* GST View Mode - Show only user's card */}
      {viewAsGST && (
        <UserStatsCard userData={currentUserData} showRank={false} />
      )}

      {/* Admin View Mode - Show full leaderboard */}
      {!viewAsGST && (
        <>
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
                  <p className="text-xs text-slate-500 mb-2">{topThree[1]?.designation}</p>
                  <div className="text-center mb-3">
                    <span className={`text-2xl font-bold ${getPercentileColor(topThree[1]?.percentile)}`}>
                      {topThree[1]?.percentile ?? 0}%
                    </span>
                    <p className="text-xs text-slate-400">Final Percentile</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span className="font-semibold">{topThree[1]?.productivityPercentile ?? 0}%</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                      <Target className="w-3 h-3 text-blue-500" />
                      <span className="font-semibold">{topThree[1]?.frrPercentPercentile ?? 0}%</span>
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
                  <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-2 font-medium">{topThree[0]?.designation} • Champion</p>
                  <div className="text-center mb-3">
                    <span className="text-3xl font-bold text-emerald-600">
                      {topThree[0]?.percentile ?? 0}%
                    </span>
                    <p className="text-xs text-yellow-700 dark:text-yellow-400">Final Percentile</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      <Zap className="w-3.5 h-3.5 text-amber-500" />
                      <span className="font-bold">{topThree[0]?.productivityPercentile ?? 0}%</span> Prod
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      <Target className="w-3.5 h-3.5 text-blue-500" />
                      <span className="font-bold">{topThree[0]?.frrPercentPercentile ?? 0}%</span> FRR
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      <Clock className="w-3.5 h-3.5 text-purple-500" />
                      <span className="font-bold">{topThree[0]?.avgRWTPercentile ?? 0}%</span> RWT
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      <Star className="w-3.5 h-3.5 text-amber-500" />
                      <span className="font-bold">{topThree[0]?.positiveCSATPercentile ?? 0}%</span> CSAT
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
                  <p className="text-xs text-slate-500 mb-2">{topThree[2]?.designation}</p>
                  <div className="text-center mb-3">
                    <span className={`text-2xl font-bold ${getPercentileColor(topThree[2]?.percentile)}`}>
                      {topThree[2]?.percentile ?? 0}%
                    </span>
                    <p className="text-xs text-slate-400">Final Percentile</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span className="font-semibold">{topThree[2]?.productivityPercentile ?? 0}%</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                      <Target className="w-3 h-3 text-blue-500" />
                      <span className="font-semibold">{topThree[2]?.frrPercentPercentile ?? 0}%</span>
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
                      { key: "rank", label: "#", width: "w-14" },
                      { key: "name", label: "Engineer", width: "w-36" },
                      { key: "daysWorked", label: "Days", width: "w-16" },
                      { key: "solved", label: "Solved", width: "w-18" },
                      { key: "productivityPercentile", label: "Productivity (30%)", width: "w-32" },
                      { key: "csatPercentPercentile", label: "CSAT % (15%)", width: "w-28" },
                      { key: "positiveCSATPercentile", label: "# CSATs (10%)", width: "w-28" },
                      { key: "avgRWTPercentile", label: "RWT (15%)", width: "w-24" },
                      { key: "avgIterationsPercentile", label: "Iter (15%)", width: "w-24" },
                      { key: "frrPercentPercentile", label: "FRR (15%)", width: "w-24" },
                      { key: "percentile", label: "Final %", width: "w-24" },
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
                            <p className="text-xs text-slate-400">{eng.designation} • {eng.team}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-sm text-slate-600 dark:text-slate-400">{eng.daysWorked}</td>
                      <td className="px-4 py-3 text-center font-bold text-slate-900 dark:text-white">{eng.solved}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getPercentileBgColor(eng.productivityPercentile)}`}>
                            {eng.productivityPercentile ?? 0}%
                          </span>
                          <span className="text-xs text-slate-400 mt-0.5">{eng.productivity}/day</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getPercentileBgColor(eng.csatPercentPercentile)}`}>
                            {eng.csatPercentPercentile ?? 0}%
                          </span>
                          <span className="text-xs text-slate-400 mt-0.5">{eng.csatPercent}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getPercentileBgColor(eng.positiveCSATPercentile)}`}>
                            {eng.positiveCSATPercentile ?? 0}%
                          </span>
                          <span className="text-xs text-slate-400 mt-0.5">{eng.positiveCSAT} CSATs</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getPercentileBgColor(eng.avgRWTPercentile)}`}>
                            {eng.avgRWTPercentile ?? 0}%
                          </span>
                          <span className="text-xs text-slate-400 mt-0.5">{eng.avgRWT}h</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getPercentileBgColor(eng.avgIterationsPercentile)}`}>
                            {eng.avgIterationsPercentile ?? 0}%
                          </span>
                          <span className="text-xs text-slate-400 mt-0.5">{eng.avgIterations} iter</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getPercentileBgColor(eng.frrPercentPercentile)}`}>
                            {eng.frrPercentPercentile ?? 0}%
                          </span>
                          <span className="text-xs text-slate-400 mt-0.5">{eng.frrPercent}% FRR</span>
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
                          {eng.percentile ?? 0}%
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
              <span>≥80%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span>60-79%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span>40-59%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span>&lt;40%</span>
            </div>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span>Percentile = ((Total - Rank + 1) / Total) × 100</span>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span>L2 CSAT% weight: 20%</span>
          </div>
        </>
      )}
    </div>
  );
};

export default GamificationView;
