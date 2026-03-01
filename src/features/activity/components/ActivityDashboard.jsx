import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw, Users, Eye, EyeOff,
  ChevronLeft, ChevronRight, Zap, ChevronUp, ChevronDown,
  Search, AlertTriangle, GitBranch,
} from "lucide-react";
import {
  fetchMembers, fetchDailySummary, fetchSummary,
  fetchDrillDown, fetchRangeDrillDown, triggerActivitySync,
  fetchActivityLeaderboard, fetchCalendar, fetchDependencyTable,
} from "../../../api/activityApi";
import { EMAIL_TO_NAME_MAP } from "../../../utils";
import HourlyChart from "./HourlyChart";
import DailyChart from "./DailyChart";
import DrillDownModal from "./DrillDownModal";
import SmartDateRangePicker from "../../../components/common/SmartDateRangePicker";

const TODAY = new Date().toISOString().slice(0, 10);
const CHART_MAX_DAYS = 7;

const LEADERBOARD_COLS = [
  { key: "user_name", label: "Engineer" },
  { key: "external_count", label: "External", center: true },
  { key: "internal_count", label: "Internal", center: true },
  { key: "coop_count", label: "Co-op Tickets", center: true },
  { key: "total_points", label: "Points", center: true },
  { key: "ticket_count", label: "Tickets", center: true },
  { key: "days_active", label: "Days Active", center: true },
];

const DEP_COLS = [
  { key: "engineer", label: "Engineer" },
  { key: "coop_received", label: "Co-op Received", center: true },
  { key: "ticket_count", label: "Tickets", center: true },
  { key: "helper_count", label: "Helpers", center: true },
];

// Non-GST admins don't get pre-selected
const NON_GST_ADMINS = ["anmol.sawhney@clevertap.com", "mashnu@clevertap.com"];

export default function ActivityDashboard({ isDark, currentUser, isAdmin }) {
  const [members, setMembers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [dateRange, setDateRange] = useState({ start: TODAY, end: TODAY });

  const [daily, setDaily] = useState(null);
  const [drillDownEntries, setDrillDownEntries] = useState(null);
  const [drillDownHour, setDrillDownHour] = useState(null);
  const [rangeSummary, setRangeSummary] = useState(null);

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [showSyncTip, setShowSyncTip] = useState(false);

  const [visibilityFilter, setVisibilityFilter] = useState({ external: true, internal: false });

  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [lbSort, setLbSort] = useState({ key: "total_points", asc: false });

  const [dependency, setDependency] = useState([]);
  const [depLoading, setDepLoading] = useState(false);
  const [depSort, setDepSort] = useState({ key: "coop_received", asc: false });

  const [calendarDays, setCalendarDays] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Resolve logged-in user's GST name
  const myName = useMemo(() => {
    if (!currentUser?.email) return null;
    const email = currentUser.email.toLowerCase();
    if (NON_GST_ADMINS.includes(email)) return null;
    return EMAIL_TO_NAME_MAP[email] || null;
  }, [currentUser]);

  // Load members, pre-select logged-in user
  useEffect(() => {
    fetchMembers()
      .then((m) => {
        setMembers(m);
        if (m.length > 0 && !selectedUser) {
          setSelectedUser(myName && m.includes(myName) ? myName : m[0]);
        }
      })
      .catch(console.error);
  }, [myName]);

  const isMultiDay = dateRange.start && dateRange.end && dateRange.start !== dateRange.end;
  const rangeDays = useMemo(() => {
    if (!dateRange.start || !dateRange.end) return 0;
    return Math.round((new Date(dateRange.end) - new Date(dateRange.start)) / 86400000);
  }, [dateRange]);
  const chartBlocked = rangeDays >= CHART_MAX_DAYS;

  // Data fetching
  useEffect(() => {
    if (!selectedUser) return;
    if (isMultiDay) return;
    setLoading(true);
    fetchDailySummary(selectedUser, selectedDate)
      .then(setDaily).catch(console.error).finally(() => setLoading(false));
  }, [selectedUser, selectedDate, dateRange.start, dateRange.end]);

  useEffect(() => {
    if (!selectedUser || !dateRange.start || !dateRange.end) return;
    fetchSummary(selectedUser, dateRange.start, dateRange.end)
      .then(setRangeSummary).catch(console.error);
  }, [selectedUser, dateRange.start, dateRange.end]);

  useEffect(() => {
    if (!selectedUser || !dateRange.start || !dateRange.end) return;
    if (dateRange.start === dateRange.end || chartBlocked) { setCalendarDays([]); return; }
    setCalendarLoading(true);
    fetchCalendar(selectedUser, dateRange.start, dateRange.end)
      .then(setCalendarDays).catch(console.error).finally(() => setCalendarLoading(false));
  }, [selectedUser, dateRange.start, dateRange.end, chartBlocked]);

  useEffect(() => {
    if (!dateRange.start || !dateRange.end) return;
    setLeaderboardLoading(true);
    fetchActivityLeaderboard(dateRange.start, dateRange.end)
      .then(setLeaderboard).catch(console.error).finally(() => setLeaderboardLoading(false));
  }, [dateRange.start, dateRange.end]);

  useEffect(() => {
    if (!dateRange.start || !dateRange.end) return;
    setDepLoading(true);
    fetchDependencyTable(dateRange.start, dateRange.end)
      .then(setDependency).catch(console.error).finally(() => setDepLoading(false));
  }, [dateRange.start, dateRange.end]);

  // Derived stats — always computed for selected range
  const ext = isMultiDay ? (rangeSummary?.total_external || 0) : (daily?.external_count || 0);
  const int_ = isMultiDay ? (rangeSummary?.total_internal || 0) : (daily?.internal_count || 0);
  const pts = isMultiDay ? (rangeSummary?.total_points || 0) : (daily?.total_points || 0);
  const coopCount = isMultiDay ? (rangeSummary?.total_coop || 0) : (daily?.coop_count || 0);
  const filteredExt = visibilityFilter.external ? ext : 0;
  const filteredInt = visibilityFilter.internal ? int_ : 0;
  const dateLabel = isMultiDay ? `${dateRange.start} to ${dateRange.end}` : selectedDate;

  // Date range handler — no blocking, just pass through
  const handleDateRangeChange = useCallback((val) => {
    setDateRange(val);
    if (val.end) setSelectedDate(val.end);
    else if (val.start) setSelectedDate(val.start);
  }, []);

  const shiftDate = (days) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    const nd = d.toISOString().slice(0, 10);
    setSelectedDate(nd);
    setDateRange({ start: nd, end: nd });
  };

  // Drill-down handlers
  const openDrillDown = useCallback((hour) => {
    if (!selectedUser) return;
    setDrillDownHour(hour);
    fetchDrillDown(selectedUser, selectedDate, hour)
      .then((entries) => {
        setDrillDownEntries(entries.filter((e) => {
          if (e.visibility === "internal" && !visibilityFilter.internal) return false;
          if (e.visibility !== "internal" && !visibilityFilter.external) return false;
          return true;
        }));
      }).catch(console.error);
  }, [selectedUser, selectedDate, visibilityFilter]);

  const openAllDrillDown = useCallback(() => {
    if (!selectedUser) return;
    setDrillDownHour("all");
    const fetcher = isMultiDay
      ? fetchRangeDrillDown(selectedUser, dateRange.start, dateRange.end)
      : fetchDrillDown(selectedUser, selectedDate);
    fetcher.then((entries) => {
      setDrillDownEntries(entries.filter((e) => {
        if (e.visibility === "internal" && !visibilityFilter.internal) return false;
        if (e.visibility !== "internal" && !visibilityFilter.external) return false;
        return true;
      }));
    }).catch(console.error);
  }, [selectedUser, selectedDate, isMultiDay, dateRange, visibilityFilter]);

  const openCoopDrillDown = useCallback(() => {
    if (!selectedUser) return;
    setDrillDownHour("coop");
    const fetcher = isMultiDay
      ? fetchRangeDrillDown(selectedUser, dateRange.start, dateRange.end)
      : fetchDrillDown(selectedUser, selectedDate);
    fetcher.then((entries) => setDrillDownEntries(entries.filter((e) => e.is_coop && e.visibility !== "internal")))
      .catch(console.error);
  }, [selectedUser, selectedDate, isMultiDay, dateRange]);

  const closeDrillDown = () => { setDrillDownEntries(null); setDrillDownHour(null); };

  const handleSync = async () => {
    setSyncing(true);
    try { await triggerActivitySync(false); } catch (e) { console.error(e); } finally { setSyncing(false); }
  };

  const filteredMembers = memberSearch
    ? members.filter((m) => m.toLowerCase().includes(memberSearch.toLowerCase()))
    : members;

  // Sorting helpers
  const toggleSort = (setter) => (key) => {
    setter((prev) => prev.key === key ? { key, asc: !prev.asc } : { key, asc: key === "user_name" || key === "engineer" });
  };
  const sortList = (list, { key, asc }) => {
    const sorted = [...list];
    sorted.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
    return sorted;
  };

  const sortedLb = useMemo(() => sortList(leaderboard, lbSort), [leaderboard, lbSort]);
  const sortedDep = useMemo(() => sortList(dependency, depSort), [dependency, depSort]);

  const ColHeader = ({ cols, sort, onSort, className = "" }) => (
    <tr className={`text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800 ${className}`}>
      <th className="pb-2 font-medium w-7 text-left">#</th>
      {cols.map((col) => (
        <th
          key={col.key}
          onClick={() => onSort(col.key)}
          className={`pb-2 font-medium cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300 ${col.center ? "text-center" : "text-left"}`}
        >
          {col.label}
          {sort.key === col.key ? (sort.asc ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />) : null}
        </th>
      ))}
    </tr>
  );

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* SIDEBAR */}
      <div className="w-48 shrink-0 flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-2 border-b border-slate-200 dark:border-slate-700">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {filteredMembers.map((name) => (
            <button
              key={name}
              onClick={() => setSelectedUser(name)}
              className={`w-full text-left px-3 py-2 text-[13px] font-medium transition-colors
                ${selectedUser === name
                  ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-l-2 border-indigo-500"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 border-l-2 border-transparent"
                }`}
            >
              {name}
              {name === myName && <span className="ml-1 text-[10px] text-indigo-400 font-medium">(you)</span>}
            </button>
          ))}
        </div>
      </div>

      {/* MAIN */}
      <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-y-auto no-scrollbar">

        {/* STATS ROW */}
        <div className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <div className="flex items-center gap-4">
            <div className="pr-4 border-r border-slate-200 dark:border-slate-700">
              <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Selected</div>
              <div className="text-base font-semibold text-slate-800 dark:text-slate-100">{selectedUser || ""}</div>
            </div>

            <Pill icon={Eye} label="External" value={filteredExt} cls="text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30" />
            <Pill icon={EyeOff} label="Internal" value={filteredInt} cls="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" />
            <Pill icon={Zap} label="Points" value={pts} cls="text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30" />

            <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200 dark:border-slate-700">
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input type="checkbox" checked={visibilityFilter.external}
                  onChange={(e) => setVisibilityFilter((p) => ({ ...p, external: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-500 focus:ring-blue-400" />
                <span className="text-xs text-slate-500 dark:text-slate-400">Ext</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input type="checkbox" checked={visibilityFilter.internal}
                  onChange={(e) => setVisibilityFilter((p) => ({ ...p, internal: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400" />
                <span className="text-xs text-slate-500 dark:text-slate-400">Int</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={openCoopDrillDown}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors cursor-pointer">
              <Users className="w-4 h-4 text-purple-500" />
              <div className="text-left leading-tight">
                <span className="text-[10px] text-purple-500 dark:text-purple-400 block">Co-op</span>
                <span className="text-sm font-bold text-purple-700 dark:text-purple-300">{coopCount} ticket{coopCount !== 1 ? "s" : ""}</span>
              </div>
            </button>

            {isAdmin && (
              <div className="relative"
                onMouseEnter={() => setShowSyncTip(true)} onMouseLeave={() => setShowSyncTip(false)}>
                <button onClick={handleSync} disabled={syncing}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors">
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing..." : "Sync"}
                </button>
                {showSyncTip && (
                  <div className="absolute bottom-full right-0 mb-2 w-52 p-2 rounded-lg bg-slate-800 text-[11px] text-slate-200 shadow-lg z-30 leading-relaxed">
                    Incremental sync: fetches last 24h of timeline comments from DevRev and recalculates points.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* DATE NAV */}
        <div className="flex items-center gap-2">
          <button onClick={() => shiftDate(-1)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <SmartDateRangePicker value={dateRange} onChange={handleDateRangeChange} />
          <button onClick={() => shiftDate(1)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={() => { setSelectedDate(TODAY); setDateRange({ start: TODAY, end: TODAY }); }}
            className="text-xs text-indigo-500 hover:text-indigo-600 font-medium ml-1">Today</button>
        </div>

        {/* CHART */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {isMultiDay ? `Activity - ${dateLabel}` : `24-Hour Activity - ${dateLabel}`}
            </h3>
            <button onClick={openAllDrillDown}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors">
              View All Entries &rarr;
            </button>
          </div>

          {chartBlocked ? (
            <div className="h-56 flex flex-col items-center justify-center gap-2 text-slate-400">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Chart limited to 7 days</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Select a 7-day range to see the chart. Stats below are for the full selected range.</p>
            </div>
          ) : (isMultiDay ? calendarLoading : loading) ? (
            <div className="h-56 flex items-center justify-center text-slate-400 text-sm">Loading...</div>
          ) : isMultiDay ? (
            <DailyChart
              days={calendarDays}
              onDayClick={(date) => { setSelectedDate(date); setDateRange({ start: date, end: date }); }}
              isDark={isDark}
              visibilityFilter={visibilityFilter}
            />
          ) : (
            <HourlyChart
              hourly={daily?.hourly || {}}
              onBarClick={openDrillDown}
              isDark={isDark}
              visibilityFilter={visibilityFilter}
            />
          )}
        </div>

        {/* SUMMARY */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
            Summary - {dateLabel}
          </h3>
          <div className="grid grid-cols-5 gap-4 text-center">
            <Stat label="External" value={filteredExt} color="text-blue-600 dark:text-blue-400" />
            <Stat label="Internal" value={filteredInt} color="text-emerald-600 dark:text-emerald-400" />
            <Stat label="Total" value={filteredExt + filteredInt} color="text-slate-700 dark:text-slate-200" />
            <Stat label="Points" value={pts} color="text-amber-600 dark:text-amber-400" />
            <Stat label="Co-op Tickets" value={coopCount} color="text-purple-600 dark:text-purple-400" />
          </div>
        </div>

        {/* LEADERBOARD */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">
            Team Overview - {dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} to ${dateRange.end}`}
          </h3>
          {leaderboardLoading ? (
            <div className="text-sm text-slate-400 py-4 text-center">Loading...</div>
          ) : leaderboard.length === 0 ? (
            <div className="text-sm text-slate-400 py-4 text-center">No data for this range</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <ColHeader cols={LEADERBOARD_COLS} sort={lbSort} onSort={toggleSort(setLbSort)} />
                </thead>
                <tbody>
                  {sortedLb.map((e, i) => (
                    <tr key={e.user_name} onClick={() => setSelectedUser(e.user_name)}
                      className={`border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors ${e.user_name === selectedUser ? "bg-indigo-50 dark:bg-indigo-950/30" : ""}`}>
                      <td className="py-2 text-xs text-slate-400 font-medium">{i + 1}</td>
                      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">
                        {e.user_name}
                        {e.user_name === myName && <span className="ml-1 text-[10px] text-indigo-400">(you)</span>}
                      </td>
                      <td className="py-2 text-center text-blue-600 dark:text-blue-400 font-semibold">{e.external_count}</td>
                      <td className="py-2 text-center text-emerald-600 dark:text-emerald-400 font-semibold">{e.internal_count}</td>
                      <td className="py-2 text-center text-purple-600 dark:text-purple-400 font-semibold">{e.coop_count}</td>
                      <td className="py-2 text-center text-amber-600 dark:text-amber-400 font-bold">{e.total_points}</td>
                      <td className="py-2 text-center text-slate-600 dark:text-slate-300 font-semibold">{e.ticket_count || 0}</td>
                      <td className="py-2 text-center text-slate-500">{e.days_active}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* DEPENDENCY */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="w-3.5 h-3.5 text-slate-400" />
            <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
              Co-op Dependency
            </h3>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">- who received help on their tickets</span>
          </div>
          {depLoading ? (
            <div className="text-sm text-slate-400 py-4 text-center">Loading...</div>
          ) : dependency.length === 0 ? (
            <div className="text-sm text-slate-400 py-4 text-center">No dependency data</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <ColHeader cols={DEP_COLS} sort={depSort} onSort={toggleSort(setDepSort)} />
                </thead>
                <tbody>
                  {sortedDep.map((e, i) => (
                    <tr key={e.engineer} onClick={() => setSelectedUser(e.engineer)}
                      className={`border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors ${e.engineer === selectedUser ? "bg-indigo-50 dark:bg-indigo-950/30" : ""}`}>
                      <td className="py-2 text-xs text-slate-400 font-medium">{i + 1}</td>
                      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{e.engineer}</td>
                      <td className="py-2 text-center font-bold text-orange-600 dark:text-orange-400">{e.coop_received}</td>
                      <td className="py-2 text-center text-slate-600 dark:text-slate-300 font-semibold">{e.ticket_count}</td>
                      <td className="py-2 text-center text-slate-500">{e.helper_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {drillDownEntries && (
        <DrillDownModal
          entries={drillDownEntries} hour={drillDownHour} date={selectedDate}
          dateRange={isMultiDay && (drillDownHour === "coop" || drillDownHour === "all") ? dateRange : null}
          user={selectedUser} coopCount={coopCount} onClose={closeDrillDown} isDark={isDark}
        />
      )}
    </div>
  );
}

function Pill({ icon: Icon, label, value, cls }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${cls}`}>
      <Icon className="w-3.5 h-3.5" />
      <span className="text-xs font-medium">{label}</span>
      <span className="text-sm font-bold ml-0.5">{value}</span>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}
