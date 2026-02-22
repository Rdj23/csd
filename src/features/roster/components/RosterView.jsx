import React, { useState, useEffect, useMemo } from "react";
import {
  Users,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  Briefcase,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { fetchFullRoster } from "../../../api/rosterApi";

const RosterView = () => {
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all, onShift, off
  const [teamFilter, setTeamFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const loadRoster = async () => {
    setLoading(true);
    try {
      const data = await fetchFullRoster();
      setRoster(data);
    } catch (e) {
      console.error("Failed to load roster:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoster();
  }, []);

  const teams = useMemo(() => {
    if (!roster?.engineers) return [];
    return [...new Set(roster.engineers.map((e) => e.team))].sort();
  }, [roster]);

  const filteredEngineers = useMemo(() => {
    if (!roster?.engineers) return [];
    let list = [...roster.engineers];

    if (filter === "onShift") list = list.filter((e) => e.isOnShift);
    if (filter === "off") list = list.filter((e) => !e.isOnShift);
    if (teamFilter !== "all") list = list.filter((e) => e.team === teamFilter);

    list.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (sortDir === "asc") return valA > valB ? 1 : -1;
      return valA < valB ? 1 : -1;
    });

    return list;
  }, [roster, filter, teamFilter, sortBy, sortDir]);

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir(col === "name" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3" />
    ) : (
      <ChevronDown className="w-3 h-3" />
    );
  };

  const onShiftCount = roster?.engineers?.filter((e) => e.isOnShift).length || 0;
  const offCount = roster?.engineers?.filter((e) => !e.isOnShift).length || 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-500">Loading roster...</p>
        </div>
      </div>
    );
  }

  if (!roster || roster.error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center">
          <p className="text-amber-700 dark:text-amber-400">
            {roster?.error || "Roster data not available. Please sync the roster first."}
          </p>
          <button
            onClick={loadRoster}
            className="mt-4 px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm hover:bg-indigo-600 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <Users className="w-6 h-6 text-indigo-500" /> Team Roster
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Today: {roster.date} &middot; {onShiftCount} on shift &middot; {offCount} off
          </p>
        </div>
        <button
          onClick={loadRoster}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => setFilter("all")}
          className={`p-4 rounded-xl border transition-all ${
            filter === "all"
              ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700"
              : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-200"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total</span>
          </div>
          <p className="text-2xl font-bold text-slate-800 dark:text-white">{roster.engineers.length}</p>
        </button>
        <button
          onClick={() => setFilter("onShift")}
          className={`p-4 rounded-xl border transition-all ${
            filter === "onShift"
              ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700"
              : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-200"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">On Shift</span>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{onShiftCount}</p>
        </button>
        <button
          onClick={() => setFilter("off")}
          className={`p-4 rounded-xl border transition-all ${
            filter === "off"
              ? "bg-slate-100 dark:bg-slate-700/50 border-slate-400 dark:border-slate-600"
              : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Off / Leave</span>
          </div>
          <p className="text-2xl font-bold text-slate-500">{offCount}</p>
        </button>
      </div>

      {/* Team Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-slate-500">Team:</span>
        <button
          onClick={() => setTeamFilter("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            teamFilter === "all"
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200"
          }`}
        >
          All
        </button>
        {teams.map((team) => (
          <button
            key={team}
            onClick={() => setTeamFilter(team)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              teamFilter === team
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200"
            }`}
          >
            {team}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              {[
                { key: "name", label: "Name" },
                { key: "team", label: "Team" },
                { key: "designation", label: "Level" },
                { key: "shift", label: "Shift" },
                { key: "isOnShift", label: "Status" },
                { key: "workload", label: "Active Tickets" },
                { key: "daysWorked", label: "Days Worked" },
              ].map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-4 py-3 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:text-indigo-500 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    <SortIcon col={col.key} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEngineers.map((eng, i) => (
              <tr
                key={eng.name}
                className={`border-b border-slate-100 dark:border-slate-800 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30 ${
                  eng.isOnShift ? "" : "opacity-60"
                }`}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                        eng.isOnShift
                          ? "bg-gradient-to-br from-emerald-400 to-emerald-600"
                          : "bg-gradient-to-br from-slate-300 to-slate-400"
                      }`}
                    >
                      {eng.name.charAt(0)}
                    </div>
                    <span className="font-medium text-sm text-slate-800 dark:text-white">{eng.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{eng.team}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-md text-xs font-bold ${
                      eng.designation === "L2"
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400"
                    }`}
                  >
                    {eng.designation}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {eng.shift}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {eng.isOnShift ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                      <CheckCircle className="w-3 h-3" /> On Shift
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {eng.reason || eng.status}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                    <span
                      className={`text-sm font-bold ${
                        eng.workload > 10
                          ? "text-red-600"
                          : eng.workload > 5
                          ? "text-amber-600"
                          : "text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {eng.isOnShift ? eng.workload : "—"}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-300">
                  {eng.daysWorked}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredEngineers.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400">
            No engineers match the current filters.
          </div>
        )}
      </div>
    </div>
  );
};

export default RosterView;
