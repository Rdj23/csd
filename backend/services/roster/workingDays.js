/**
 * roster/workingDays — Calendar queries over the snapshot: which days someone works.
 *
 * Extracted from the 1157-line rosterService.js; logic unchanged.
 * See roster/index.js for how the pieces fit together.
 */

import { NAME_TO_ROSTER_MAP, OFF_STATUSES, getISTTime } from "../../config/constants.js";
import { DATE_COL_MAP, ROSTER_ROWS, getDateColMap, getRosterRows } from "./snapshot.js";

// --- ROSTER VERIFICATION HELPERS ---

export const MONTHS_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WORKING_SHIFTS = new Set(["SHIFT 1", "SHIFT 2", "SHIFT 3", "SHIFT 4", "ON CALL"]);

export const parseRosterDate = (dateKey, year) => {
  const parts = dateKey.split("-");
  if (parts.length !== 2 || !MONTHS_MAP.hasOwnProperty(parts[1])) return null;
  const d = new Date(year, MONTHS_MAP[parts[1]], parseInt(parts[0]));
  return isNaN(d.getTime()) ? null : d;
};

export const normalizeShift = (raw) => {
  const val = raw.toUpperCase().trim();
  const match = val.match(/(?:SHIFT\s*)?(\d)/);
  return match ? `SHIFT ${match[1]}` : val;
};

export const buildDayEntry = (dateKey, colDate, raw) => {
  const normalized = normalizeShift(raw);
  const isWorking = WORKING_SHIFTS.has(normalized);
  const isOff = OFF_STATUSES.includes(normalized) || OFF_STATUSES.includes(raw.toUpperCase().trim());
  return {
    date: dateKey,
    fullDate: colDate.toISOString().split("T")[0],
    day: DAY_NAMES[colDate.getDay()],
    shift: raw || "—",
    shiftNormalized: normalized,
    status: isWorking ? "working" : (isOff ? "off" : "no_data"),
  };
};

// Get detailed working day breakdown for an engineer within a date range
export const getWorkingDayDetails = (name, startDate, endDate) => {
  if (!getRosterRows() || getRosterRows().length === 0) {
    return { error: "Roster data not loaded. Please sync first." };
  }

  const rosterName = NAME_TO_ROSTER_MAP[name] || name;
  const row = getRosterRows().find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) {
    return { error: `Engineer "${name}" not found in roster.`, availableEngineers: getRosterRows().map(r => r[0]) };
  }

  const year = new Date().getFullYear();
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { error: "Invalid date format. Use YYYY-MM-DD." };
  }

  const allEntries = [];

  for (const [dateKey, colIdx] of Object.entries(getDateColMap())) {
    const colDate = parseRosterDate(dateKey, year);
    if (!colDate || colDate < start || colDate > end) continue;

    const raw = (row[colIdx] || "").trim();
    allEntries.push(buildDayEntry(dateKey, colDate, raw));
  }

  allEntries.sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));

  const workingDates = allEntries.filter(e => e.status === "working");
  const offDates = allEntries.filter(e => e.status !== "working");

  return {
    name,
    dateRange: { start: startDate, end: endDate },
    summary: {
      totalRosterDays: allEntries.length,
      workingDays: workingDates.length,
      offDays: offDates.length,
    },
    workingDates,
    allDates: allEntries,
  };
};

// Get the next N working days for an engineer from a given date
export const getNextWorkingDays = (name, fromDate, count = 7) => {
  if (!getRosterRows() || getRosterRows().length === 0) {
    return { error: "Roster data not loaded. Please sync first." };
  }

  const rosterName = NAME_TO_ROSTER_MAP[name] || name;
  const row = getRosterRows().find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) {
    return { error: `Engineer "${name}" not found in roster.`, availableEngineers: getRosterRows().map(r => r[0]) };
  }

  const year = new Date().getFullYear();
  const from = fromDate ? new Date(fromDate) : getISTTime();
  from.setHours(0, 0, 0, 0);

  const upcoming = [];

  for (const [dateKey, colIdx] of Object.entries(getDateColMap())) {
    const colDate = parseRosterDate(dateKey, year);
    if (!colDate || colDate < from) continue;

    const raw = (row[colIdx] || "").trim();
    upcoming.push(buildDayEntry(dateKey, colDate, raw));
  }

  upcoming.sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));

  const maxPreview = Math.max(count * 3, 21); // show enough days to find N working days
  const preview = upcoming.slice(0, maxPreview);

  const nextWorkingDays = preview.filter(d => d.status === "working").slice(0, count);
  const nextOffDays = preview.filter(d => d.status !== "working").slice(0, count);

  return {
    name,
    from: from.toISOString().split("T")[0],
    requestedCount: count,
    nextWorkingDays,
    nextOffDays,
    upcomingSchedule: preview, // full view of next ~3 weeks
  };
};
