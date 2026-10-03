/**
 * roster/queries — Read-only views the API serves: full roster, month grid, today, workload.
 *
 * Extracted from the 1157-line rosterService.js; logic unchanged.
 * See roster/index.js for how the pieces fit together.
 */

import logger from "../../config/logger.js";
import { DESIGNATION_MAP, GAMIFICATION_TEAM_MAP, NAME_TO_ROSTER_MAP, OFF_STATUSES, OFF_STATUS_MAP, SHIFT_HOURS, getCurrentISTHour, getISTTime } from "../../config/constants.js";
import { redisGet } from "../../lib/cache.js";
import { format } from "date-fns";
import { getDaysWorked } from "./shifts.js";
import { DATE_COL_MAP, FLAT_TEAM_MAP, LEVEL_COL_IDX, ROSTER_ROWS, getDateColMap, getLevelColIdx, getRosterRows } from "./snapshot.js";
import { MONTHS_MAP, WORKING_SHIFTS, buildDayEntry, normalizeShift, parseRosterDate } from "./workingDays.js";

export const getFullRoster = async (quarterStart) => {
  const istNow = getISTTime();
  const dateKey = format(istNow, "d-MMM");
  const colIdx = getDateColMap()[dateKey];
  const currentHour = getCurrentISTHour();

  if (!getRosterRows() || getRosterRows().length === 0) {
    return { engineers: [], date: dateKey, error: "Roster data not loaded" };
  }

  const tickets = (await redisGet("tickets:active")) || [];
  const workloadMap = {};
  tickets.forEach((t) => {
    const stageName = (t.stage?.name || "").toLowerCase();
    if (stageName.includes("solved") || stageName.includes("closed") || stageName.includes("resolved")) return;
    const ownerName = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || t.owned_by?.[0]?.display_name || "";
    if (ownerName) {
      const key = ownerName.toLowerCase();
      workloadMap[key] = (workloadMap[key] || 0) + 1;
    }
  });

  // If no quarterStart passed, compute from current quarter dynamically
  const start = quarterStart || new Date();

  // Names to exclude from roster display (header artifacts, non-GST admins)
  const ROSTER_EXCLUDE = new Set([
    "engineer", "name", "manager", "pod name", "designation",
    "anmol", "mashnu", "anmol sawhney",
  ]);

  const engineers = getRosterRows().map((row) => {
    const name = row[0];
    if (!name || ROSTER_EXCLUDE.has(name.toLowerCase())) return null;

    const designation = DESIGNATION_MAP[name] || row[getLevelColIdx()] || "L1";
    const team = GAMIFICATION_TEAM_MAP[name] || "Unknown";
    const shift = colIdx != null ? (row[colIdx] || "").trim() : "";
    const shiftUpper = shift.toUpperCase();

    let isOnShift = false;
    let status = "Off";
    let reason = "";

    if (OFF_STATUSES.includes(shiftUpper)) {
      reason = OFF_STATUS_MAP[shiftUpper] || "Away";
      status = reason;
    } else if (shift) {
      const shiftMatch = shiftUpper.match(/(?:SHIFT\s*)?(\d)/i);
      const shiftNum = shiftMatch ? shiftMatch[1] : null;
      const shiftKey = shiftNum ? `SHIFT ${shiftNum}` : shiftUpper.replace(/\s+/g, " ").trim();
      const hours = SHIFT_HOURS[shiftKey];
      if (hours) {
        if (hours.overnight) {
          isOnShift = currentHour >= hours.start || currentHour < hours.end;
        } else {
          isOnShift = currentHour >= hours.start && currentHour < hours.end;
        }
      }
      status = isOnShift ? "On Shift" : `${shift} (upcoming)`;
    }

    const daysWorked = getDaysWorked(name, start);

    return {
      name,
      designation,
      team,
      shift: shift || "—",
      isOnShift,
      status,
      reason,
      daysWorked,
      workload: workloadMap[name.toLowerCase()] || 0,
    };
  }).filter(Boolean);

  return { engineers, date: dateKey };
};

// ---------------------------------------------------------------------------
// Get full roster for a specific month (e.g. "Apr", "2026")
// Returns every engineer's schedule for every day in that month.
// ---------------------------------------------------------------------------
export const getRosterByMonth = (monthName, year) => {
  if (!getRosterRows() || getRosterRows().length === 0) {
    return { error: "Roster data not loaded. Please sync first." };
  }

  const y = parseInt(year) || new Date().getFullYear();
  const mon = monthName?.charAt(0).toUpperCase() + monthName?.slice(1, 3).toLowerCase();
  if (!MONTHS_MAP.hasOwnProperty(mon)) {
    return { error: `Invalid month "${monthName}". Use Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec.` };
  }

  // Collect all date columns for this month
  const monthDates = [];
  for (const [dateKey, colIdx] of Object.entries(getDateColMap())) {
    if (dateKey.endsWith(`-${mon}`)) {
      const colDate = parseRosterDate(dateKey, y);
      if (colDate) monthDates.push({ dateKey, colIdx, colDate });
    }
  }
  monthDates.sort((a, b) => a.colDate - b.colDate);

  if (monthDates.length === 0) {
    return { error: `No roster data found for ${mon} ${y}. The roster may not have been synced for this month yet.` };
  }

  const engineers = getRosterRows().map((row) => {
    const name = row[0];
    if (!name) return null;
    const designation = DESIGNATION_MAP[name] || row[getLevelColIdx()] || "L1";
    const team = GAMIFICATION_TEAM_MAP[name] || "Unknown";

    const schedule = {};
    let workingDays = 0;
    let offDays = 0;

    monthDates.forEach(({ dateKey, colIdx, colDate }) => {
      const raw = (row[colIdx] || "").trim();
      const entry = buildDayEntry(dateKey, colDate, raw);
      schedule[dateKey] = entry;
      if (entry.status === "working") workingDays++;
      else offDays++;
    });

    return { name, designation, team, workingDays, offDays, schedule };
  }).filter(Boolean);

  return {
    month: mon,
    year: y,
    totalDays: monthDates.length,
    dates: monthDates.map(d => d.dateKey),
    engineers,
  };
};

// ---------------------------------------------------------------------------
// Get today's complete status for a user: current shift, next working day,
// next week-off, and summary for the week.
// ---------------------------------------------------------------------------
export const getTodayStatus = (name) => {
  if (!getRosterRows() || getRosterRows().length === 0) {
    return { error: "Roster data not loaded. Please sync first." };
  }

  const rosterName = NAME_TO_ROSTER_MAP[name] || name;
  const row = getRosterRows().find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) {
    return { error: `Engineer "${name}" not found in roster.`, availableEngineers: getRosterRows().map(r => r[0]) };
  }

  const istNow = getISTTime();
  const year = istNow.getFullYear();
  const todayKey = format(istNow, "d-MMM");
  const currentHour = getCurrentISTHour();

  // Today's shift
  const todayColIdx = getDateColMap()[todayKey];
  const todayRaw = todayColIdx != null ? (row[todayColIdx] || "").trim() : "";
  const todayShift = normalizeShift(todayRaw || "—");
  const isOnShift = (() => {
    const hours = SHIFT_HOURS[todayShift];
    if (!hours) return false;
    if (hours.overnight) return currentHour >= hours.start || currentHour < hours.end;
    return currentHour >= hours.start && currentHour < hours.end;
  })();

  // Build upcoming days to find next working day and next off day
  const upcoming = [];
  for (const [dateKey, colIdx] of Object.entries(getDateColMap())) {
    const colDate = parseRosterDate(dateKey, year);
    if (!colDate || colDate < istNow) continue; // future only (excluding today)
    // Skip today
    if (dateKey === todayKey) continue;
    const raw = (row[colIdx] || "").trim();
    upcoming.push(buildDayEntry(dateKey, colDate, raw));
  }
  upcoming.sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));

  const nextWorkingDay = upcoming.find(d => d.status === "working") || null;
  const nextOffDay = upcoming.find(d => d.status !== "working") || null;

  // This week's schedule (Mon-Sun)
  const dayOfWeek = istNow.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(istNow);
  weekStart.setDate(istNow.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const thisWeek = [];
  for (const [dateKey, colIdx] of Object.entries(getDateColMap())) {
    const colDate = parseRosterDate(dateKey, year);
    if (!colDate || colDate < weekStart || colDate > weekEnd) continue;
    const raw = (row[colIdx] || "").trim();
    thisWeek.push(buildDayEntry(dateKey, colDate, raw));
  }
  thisWeek.sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));

  return {
    name,
    today: {
      date: todayKey,
      shift: todayRaw || "—",
      shiftNormalized: todayShift,
      isOnShift,
      status: WORKING_SHIFTS.has(todayShift)
        ? (isOnShift ? "On Shift" : `${todayRaw} (upcoming)`)
        : (OFF_STATUS_MAP[todayRaw?.toUpperCase()] || todayRaw || "No Data"),
    },
    nextWorkingDay,
    nextOffDay,
    thisWeek,
  };
};

// Get workload for all active engineers
export const getWorkload = async () => {
  const istNow = getISTTime();
  const dateKey = format(istNow, "d-MMM");
  const colIdx = getDateColMap()[dateKey];
  const currentHour = getCurrentISTHour();

  logger.info({ dateKey, istHour: currentHour.toFixed(2) }, "Workload check");

  const activeEngineers = getRosterRows().filter((row) => {
    if (!row[0] || !row[1]) return false;

    const shift = (row[colIdx] || "").toUpperCase().trim();

    if (OFF_STATUSES.includes(shift)) return false;

    const shiftMatch = shift.match(/(?:SHIFT\s*)?(\d)/i);
    const shiftNum = shiftMatch ? shiftMatch[1] : null;
    const shiftKey = shiftNum ? `SHIFT ${shiftNum}` : shift.replace(/\s+/g, " ").trim();

    const hours = SHIFT_HOURS[shiftKey];

    if (hours) {
      if (hours.overnight) {
        return currentHour >= hours.start || currentHour < hours.end;
      }
      return currentHour >= hours.start && currentHour < hours.end;
    }

    return false;
  }).map((row) => ({
    name: row[0],
    email: row[1],
    role: row[getLevelColIdx()] || "L1",
    shift: colIdx ? row[colIdx] : "Unknown",
  }));

  logger.info({ count: activeEngineers.length }, "Engineers currently on shift");

  const tickets = await redisGet("tickets:active") || [];
  const workloadMap = {};

  activeEngineers.forEach((eng) => {
    workloadMap[eng.name.toLowerCase()] = 0;
  });

  tickets.forEach((t) => {
    const stageName = (t.stage?.name || "").toLowerCase();
    if (stageName.includes("solved") || stageName.includes("closed") || stageName.includes("resolved")) {
      return;
    }

    const ownerName = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
                      t.owned_by?.[0]?.display_name || "";

    if (ownerName) {
      const nameKey = ownerName.toLowerCase();
      if (workloadMap.hasOwnProperty(nameKey)) {
        const priority = (t.priority || "").toLowerCase();
        const points = (priority === "high" || priority === "urgent") ? 2 : 1;
        workloadMap[nameKey] += points;
      }
    }
  });

  const results = activeEngineers
    .map((eng) => ({
      name: eng.name,
      email: eng.email,
      role: eng.role,
      shift: eng.shift,
      load: workloadMap[eng.name.toLowerCase()] || 0,
      isOnShift: true,
    }))
    .sort((a, b) => a.load - b.load);

  return results;
};
