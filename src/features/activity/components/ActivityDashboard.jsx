import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Users, Eye, EyeOff,
  ChevronLeft, ChevronRight, Zap, Search,
} from "lucide-react";
import {
  fetchMembers, fetchDailySummary, fetchSummary,
  fetchDrillDown, fetchRangeDrillDown, triggerActivitySync,
  fetchActivityLeaderboard, searchActivityText, fetchCalendar,
} from "../../../api/activityApi";
import HourlyChart from "./HourlyChart";
import DailyChart from "./DailyChart";
import DrillDownModal from "./DrillDownModal";
import SmartDateRangePicker from "../../../components/common/SmartDateRangePicker";

const TODAY = new Date().toISOString().slice(0, 10);

export default function ActivityDashboard({ isDark, currentUser, isAdmin }) {
  // --- State ---
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

  // Visibility filter (default: external only)
  const [visibilityFilter, setVisibilityFilter] = useState({
    external: true,
    internal: false,
  });

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // Calendar days (per-day data for multi-day chart)
  const [calendarDays, setCalendarDays] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Text search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  // --- Load members ---
  useEffect(() => {
    fetchMembers()
      .then((m) => {
        setMembers(m);
        if (m.length > 0 && !selectedUser) setSelectedUser(m[0]);
      })
      .catch(console.error);
  }, []);

  // --- Load daily summary when user or date changes (skip in multi-day mode) ---
  useEffect(() => {
    if (!selectedUser) return;
    if (dateRange.start && dateRange.end && dateRange.start !== dateRange.end) return;
    setLoading(true);
    fetchDailySummary(selectedUser, selectedDate)
      .then(setDaily)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedUser, selectedDate, dateRange.start, dateRange.end]);

  // --- Load range summary when user or date range changes ---
  useEffect(() => {
    if (!selectedUser || !dateRange.start || !dateRange.end) return;
    fetchSummary(selectedUser, dateRange.start, dateRange.end)
      .then(setRangeSummary)
      .catch(console.error);
  }, [selectedUser, dateRange.start, dateRange.end]);

  // --- Load calendar days for multi-day chart ---
  useEffect(() => {
    if (!selectedUser || !dateRange.start || !dateRange.end) return;
    if (dateRange.start === dateRange.end) {
      setCalendarDays([]);
      return;
    }
    setCalendarLoading(true);
    fetchCalendar(selectedUser, dateRange.start, dateRange.end)
      .then(setCalendarDays)
      .catch(console.error)
      .finally(() => setCalendarLoading(false));
  }, [selectedUser, dateRange.start, dateRange.end]);

  // --- Load leaderboard when date range changes ---
  useEffect(() => {
    if (!dateRange.start || !dateRange.end) return;
    setLeaderboardLoading(true);
    fetchActivityLeaderboard(dateRange.start, dateRange.end)
      .then(setLeaderboard)
      .catch(console.error)
      .finally(() => setLeaderboardLoading(false));
  }, [dateRange.start, dateRange.end]);

  // --- Clear search results when user/range changes ---
  useEffect(() => {
    setSearchResults(null);
  }, [selectedUser, dateRange.start, dateRange.end]);

  const isRangeMultiDay = dateRange.start && dateRange.end && dateRange.start !== dateRange.end;

  // --- Drill down ---
  const openDrillDown = useCallback(
    (hour) => {
      if (!selectedUser) return;
      setDrillDownHour(hour);
      fetchDrillDown(selectedUser, selectedDate, hour)
        .then(setDrillDownEntries)
        .catch(console.error);
    },
    [selectedUser, selectedDate],
  );

  // Open drill-down for ALL entries in the date range
  const openAllDrillDown = useCallback(() => {
    if (!selectedUser) return;
    setDrillDownHour("all");
    const fetcher = isRangeMultiDay
      ? fetchRangeDrillDown(selectedUser, dateRange.start, dateRange.end)
      : fetchDrillDown(selectedUser, selectedDate);
    fetcher
      .then(setDrillDownEntries)
      .catch(console.error);
  }, [selectedUser, selectedDate, isRangeMultiDay, dateRange]);

  const openCoopDrillDown = useCallback(() => {
    if (!selectedUser) return;
    setDrillDownHour("coop");
    const fetcher = isRangeMultiDay
      ? fetchRangeDrillDown(selectedUser, dateRange.start, dateRange.end)
      : fetchDrillDown(selectedUser, selectedDate);
    fetcher
      .then((entries) => setDrillDownEntries(entries.filter((e) => e.is_coop)))
      .catch(console.error);
  }, [selectedUser, selectedDate, isRangeMultiDay, dateRange]);

  const closeDrillDown = () => {
    setDrillDownEntries(null);
    setDrillDownHour(null);
  };

  // --- Admin sync ---
  const handleSync = async (backfill = false) => {
    setSyncing(true);
    try {
      await triggerActivitySync(backfill);
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  // --- Date navigation ---
  const shiftDate = (days) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  // --- Text search ---
  const handleSearch = useCallback(async () => {
    if (!selectedUser || !searchQuery.trim() || !dateRange.start || !dateRange.end) return;
    setSearching(true);
    try {
      const result = await searchActivityText(
        selectedUser,
        searchQuery.trim(),
        dateRange.start,
        dateRange.end,
      );
      setSearchResults(result);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  }, [selectedUser, searchQuery, dateRange]);

  // --- Filtered members ---
  const filteredMembers = memberSearch
    ? members.filter((m) => m.toLowerCase().includes(memberSearch.toLowerCase()))
    : members;

  // Use range summary when multi-day, otherwise single-day data
  const ext = isRangeMultiDay
    ? (rangeSummary?.total_external || 0)
    : (daily?.external_count || 0);
  const int_ = isRangeMultiDay
    ? (rangeSummary?.total_internal || 0)
    : (daily?.internal_count || 0);
  const pts = isRangeMultiDay
    ? (rangeSummary?.total_points || 0)
    : (daily?.total_points || 0);
  const coopCount = isRangeMultiDay
    ? (rangeSummary?.total_coop || 0)
    : (daily?.coop_count || 0);

  // Filtered counts based on visibility checkboxes
  const filteredExt = visibilityFilter.external ? ext : 0;
  const filteredInt = visibilityFilter.internal ? int_ : 0;

  const dateLabel = isRangeMultiDay
    ? `${dateRange.start} to ${dateRange.end}`
    : selectedDate;

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* ──────────── LEFT SIDEBAR: Assignee List ──────────── */}
      <div className="w-48 shrink-0 flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-2 border-b border-slate-200 dark:border-slate-700">
          <input
            type="text"
            placeholder="Search..."
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
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
            </button>
          ))}
        </div>
      </div>

      {/* ──────────── MAIN CONTENT ──────────── */}
      <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-y-auto no-scrollbar">
        {/* TOP ROW: Name + Counts + Filters + Co-op + Admin buttons */}
        <div className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <div className="flex items-center gap-5">
            {/* Selected user */}
            <div>
              <span className="text-xs text-slate-400 dark:text-slate-500">Selected</span>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                {selectedUser || "—"}
              </h2>
            </div>

            {/* External count */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30">
              <Eye className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                External
              </span>
              <span className="ml-1 text-lg font-bold text-blue-600 dark:text-blue-400">{filteredExt}</span>
            </div>

            {/* Internal count */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
              <EyeOff className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                Internal
              </span>
              <span className="ml-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">{filteredInt}</span>
            </div>

            {/* Points */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30">
              <Zap className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                Points
              </span>
              <span className="ml-1 text-lg font-bold text-amber-600 dark:text-amber-400">{pts}</span>
            </div>

            {/* Visibility Filters */}
            <div className="flex items-center gap-3 pl-3 border-l border-slate-200 dark:border-slate-700">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={visibilityFilter.external}
                  onChange={(e) => setVisibilityFilter((prev) => ({ ...prev, external: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-blue-300 text-blue-500 focus:ring-blue-400"
                />
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">External</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={visibilityFilter.internal}
                  onChange={(e) => setVisibilityFilter((prev) => ({ ...prev, internal: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-emerald-300 text-emerald-500 focus:ring-emerald-400"
                />
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Internal</span>
              </label>
            </div>
          </div>

          {/* Co-op + Admin */}
          <div className="flex items-center gap-4">
            {/* Co-op */}
            <button
              onClick={openCoopDrillDown}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors cursor-pointer"
            >
              <Users className="w-4 h-4 text-purple-500" />
              <div className="text-left">
                <span className="text-xs text-purple-500 dark:text-purple-400 block leading-none">Co-op</span>
                <span className="text-sm font-bold text-purple-700 dark:text-purple-300">
                  {coopCount} ticket{coopCount !== 1 ? "s" : ""}
                </span>
              </div>
              <span className="text-xs text-purple-400 ml-1">&rarr;</span>
            </button>

            {/* Admin sync (incremental — refreshes last 24h) */}
            {isAdmin && (
              <button
                onClick={() => handleSync(false)}
                disabled={syncing}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                Sync
              </button>
            )}
          </div>
        </div>

        {/* DATE NAVIGATION */}
        <div className="flex items-center gap-2">
          <button onClick={() => shiftDate(-1)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <SmartDateRangePicker
            value={dateRange}
            onChange={(val) => {
              setDateRange(val);
              // Set selectedDate to the END of the range (most recent day) so the chart shows latest data
              if (val.end) setSelectedDate(val.end);
              else if (val.start) setSelectedDate(val.start);
            }}
            allowAllTime={false}
          />
          <button onClick={() => shiftDate(1)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setSelectedDate(TODAY);
              setDateRange({ start: TODAY, end: TODAY });
            }}
            className="text-xs text-indigo-500 hover:text-indigo-600 font-medium ml-1"
          >
            Today
          </button>
        </div>

        {/* 24-HOUR BAR CHART */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {isRangeMultiDay ? `Activity — ${dateLabel}` : `24-Hour Activity — ${dateLabel}`}
            </h3>
            <button
              onClick={openAllDrillDown}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
            >
              View All Entries &rarr;
            </button>
          </div>
          {(isRangeMultiDay ? calendarLoading : loading) ? (
            <div className="h-72 flex items-center justify-center text-slate-400 text-sm">Loading...</div>
          ) : isRangeMultiDay ? (
            <DailyChart
              days={calendarDays}
              onDayClick={(date) => {
                setSelectedDate(date);
                setDateRange({ start: date, end: date });
              }}
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

        {/* SUMMARY ROW */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
            Summary — {dateLabel}
          </h3>
          <div className="grid grid-cols-5 gap-4 text-center">
            <Stat label="External" value={filteredExt} color="blue" />
            <Stat label="Internal" value={filteredInt} color="emerald" />
            <Stat label="Total" value={filteredExt + filteredInt} color="slate" />
            <Stat label="Points" value={pts} color="amber" />
            <Stat label="Co-op Tickets" value={coopCount} color="purple" />
          </div>
        </div>

        {/* OVERVIEW — Team Leaderboard */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">
            Overview — {dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} to ${dateRange.end}`}
          </h3>
          {leaderboardLoading ? (
            <div className="text-sm text-slate-400 py-4 text-center">Loading...</div>
          ) : leaderboard.length === 0 ? (
            <div className="text-sm text-slate-400 py-4 text-center">No data for this range</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                    <th className="pb-2 font-medium w-8">#</th>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium text-center">External</th>
                    <th className="pb-2 font-medium text-center">Internal</th>
                    <th className="pb-2 font-medium text-center">Points</th>
                    <th className="pb-2 font-medium text-center">Days Active</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, i) => (
                    <tr
                      key={entry.user_name}
                      onClick={() => setSelectedUser(entry.user_name)}
                      className={`border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors
                        ${entry.user_name === selectedUser ? "bg-indigo-50 dark:bg-indigo-950/30" : ""}`}
                    >
                      <td className="py-2 text-xs text-slate-400 font-medium">{i + 1}</td>
                      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{entry.user_name}</td>
                      <td className="py-2 text-center text-blue-600 dark:text-blue-400 font-semibold">{entry.external_count}</td>
                      <td className="py-2 text-center text-emerald-600 dark:text-emerald-400 font-semibold">{entry.internal_count}</td>
                      <td className="py-2 text-center text-amber-600 dark:text-amber-400 font-bold">{entry.total_points}</td>
                      <td className="py-2 text-center text-slate-500">{entry.days_active}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* COMMENT TEXT SEARCH */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
              Comment Search — {selectedUser || "Select a user"}
            </h3>
            <span className="text-[10px] text-slate-400 dark:text-slate-600">T-1 data (up to yesterday)</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder='Search comment text (e.g. "please allow me some time")'
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>

          {/* Search Results */}
          {searchResults && (
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Found <span className="font-bold text-indigo-600 dark:text-indigo-400">{searchResults.match_count}</span> match{searchResults.match_count !== 1 ? "es" : ""} for &ldquo;{searchResults.query}&rdquo;
                <span className="ml-2 text-slate-400 dark:text-slate-600">
                  (showing comments by <span className="font-medium text-slate-500 dark:text-slate-400">{selectedUser}</span> only)
                </span>
              </div>
              {searchResults.entries.length > 0 && (
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {searchResults.entries.map((e) => (
                    <div
                      key={e.entry_id}
                      className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <a
                          href={`https://app.devrev.ai/clevertapsupport/works/${e.ticket_display_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          {e.ticket_display_id}
                        </a>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          e.visibility === "external"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        }`}>
                          {e.visibility}
                        </span>
                        {e.is_coop && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                            co-op
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400">
                          {new Date(e.created_date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-3">
                        {e.text_body}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* DRILL-DOWN MODAL */}
      {drillDownEntries && (
        <DrillDownModal
          entries={drillDownEntries}
          hour={drillDownHour}
          date={selectedDate}
          dateRange={isRangeMultiDay && (drillDownHour === "coop" || drillDownHour === "all") ? dateRange : null}
          user={selectedUser}
          coopCount={coopCount}
          onClose={closeDrillDown}
          isDark={isDark}
        />
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  const colors = {
    blue: "text-blue-600 dark:text-blue-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    purple: "text-purple-600 dark:text-purple-400",
    slate: "text-slate-700 dark:text-slate-200",
  };
  return (
    <div>
      <div className={`text-xl font-bold ${colors[color] || colors.slate}`}>{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}
