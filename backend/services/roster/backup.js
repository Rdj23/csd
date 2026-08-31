/**
 * roster/backup — Who covers for someone who is off — the backup-resolution ladder.
 *
 * Extracted from the 1157-line rosterService.js; logic unchanged.
 * See roster/index.js for how the pieces fit together.
 */

import logger from "../../config/logger.js";
import { DESIGNATION_MAP, NAME_TO_ROSTER_MAP, OFF_STATUSES, SHIFT_HOURS, TEAM_MAPPING, getCurrentISTHour, getISTTime } from "../../config/constants.js";
import { redisGet } from "../../lib/cache.js";
import { format } from "date-fns";
import { formatDecimalHour, getShiftStatus } from "./shifts.js";
import { DATE_COL_MAP, FLAT_TEAM_MAP, ROSTER_ROWS, getDateColMap, getRosterRows } from "./snapshot.js";

export const getProfileStatus = (userName) => {
  const dateKey = format(new Date(), "d-MMM");
  const colIdx = getDateColMap()[dateKey];
  const row = getRosterRows().find((r) =>
    r[0]?.toLowerCase().includes(userName?.toLowerCase()),
  );
  const shift = row?.[colIdx]?.toUpperCase() || "?";
  const isActive = !["WO", "L", "PL", ""].includes(shift);
  return { isActive, shift, status: isActive ? "On Shift" : "Off" };
};

// Find user's next working day from roster (looks ahead up to 14 days)
// Includes today if the shift hasn't started yet
const getNextAvailable = (userName) => {
  const rosterName = NAME_TO_ROSTER_MAP[userName] || userName;
  const row = getRosterRows().find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) return null;

  const istNow = getISTTime();
  const currentHour = getCurrentISTHour();
  const todayDate = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const VALID_SHIFTS = ["SHIFT 1", "SHIFT 2", "SHIFT 3", "SHIFT 4", "ON CALL"];

  const futureDates = [];
  for (const [dateKey, colIdx] of Object.entries(getDateColMap())) {
    const parts = dateKey.split("-");
    if (parts.length !== 2 || !MONTHS.hasOwnProperty(parts[1])) continue;
    const colDate = new Date(istNow.getFullYear(), MONTHS[parts[1]], parseInt(parts[0]));

    // Skip past days entirely
    if (colDate < todayDate) continue;

    const val = (row[colIdx] || "").toUpperCase().trim();
    const shiftMatch = val.match(/(?:SHIFT\s*)?(\d)/i);
    const normalized = shiftMatch ? `SHIFT ${shiftMatch[1]}` : val;

    if (VALID_SHIFTS.includes(normalized) && SHIFT_HOURS[normalized]) {
      const shiftInfo = SHIFT_HOURS[normalized];

      // For today: only include if the shift hasn't started yet (upcoming)
      const isToday = colDate.getTime() === todayDate.getTime();
      if (isToday && currentHour >= shiftInfo.start) continue;

      futureDates.push({
        date: colDate,
        dateKey,
        shift: normalized,
        shiftStart: formatDecimalHour(shiftInfo.start),
        isToday,
      });
    }
  }

  futureDates.sort((a, b) => a.date - b.date);
  return futureDates[0] || null;
};

// Find backup for a user
export const findBackupForUser = async (userName, teamOnly = "true") => {
  const istNow = getISTTime();
  const dateKey = format(istNow, "d-MMM");
  const colIdx = getDateColMap()[dateKey];
  const currentHour = getCurrentISTHour();
  const dayOfWeek = istNow.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  logger.info({ istTime: istNow.toISOString(), hour: currentHour.toFixed(2), dateKey }, "Backup API called");

  if (!getRosterRows() || getRosterRows().length === 0) {
    return {
      status: 503,
      data: {
        backup: null,
        error: "Roster data not loaded. Please try again later.",
        message: "Roster data is still loading.",
      }
    };
  }

  if (!colIdx && colIdx !== 0) {
    logger.warn({ dateKey, availableDates: Object.keys(getDateColMap()).slice(0, 5) }, "Date column not found");
    return {
      status: 503,
      data: {
        backup: null,
        error: `Roster column for ${dateKey} not found.`,
        message: "Today's roster data not available.",
      }
    };
  }

  let userTeam = null;
  let teamMembers = [];
  let userRole = "L1";
  let userShiftStatus = null;

  if (userName) {
    const mapping = TEAM_MAPPING[userName];
    if (mapping) {
      userTeam = mapping.team;
      teamMembers = mapping.members.filter(m => m !== userName);
    }
    userRole = DESIGNATION_MAP[userName] || "L1";

    const rosterName = NAME_TO_ROSTER_MAP[userName] || userName;
    const userRow = getRosterRows().find((r) =>
      r[0]?.toLowerCase() === rosterName?.toLowerCase()
    );
    if (userRow) {
      userShiftStatus = getShiftStatus(userRow, colIdx);
      logger.info({ userName, rosterName, shift: userShiftStatus.shift, isOnShift: userShiftStatus.isOnShift }, "User shift status");
    } else {
      logger.warn({ userName, rosterName }, "User not found in roster");
    }
  }

  // L2 on ON CALL is treated as not working — they need a backup from actual shift workers
  const isL2OnCall = userRole === "L2" && userShiftStatus?.shift === "ON CALL";
  if (isL2OnCall) {
    userShiftStatus.isOnShift = false;
    userShiftStatus.reason = "On Call (not on shift)";
    logger.info({ userName }, "L2 on ON CALL — treating as not available, finding shift backup");
  }

  // If user is available (on shift), they don't need a backup
  if (userShiftStatus?.isOnShift) {
    const tickets = await redisGet("tickets:active") || [];
    let userUrgentCount = 0;

    tickets.forEach((t) => {
      const stageName = (t.stage?.name || "").toLowerCase();
      if (!stageName.includes("waiting on assignee") && !stageName.includes("open")) return;

      const priority = (t.priority || "").toLowerCase();
      if (priority !== "blocker" && priority !== "high") return;

      const ownerName = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
                        t.owned_by?.[0]?.display_name || "";
      if (ownerName.toLowerCase() === userName.toLowerCase()) {
        userUrgentCount++;
      }
    });

    return {
      status: 200,
      data: {
        backup: null,
        needsBackup: false,
        userStatus: {
          isAvailable: true,
          shift: userShiftStatus.shift,
          urgentTickets: userUrgentCount,
        },
        message: `${userName} is available and working.`,
        team: userTeam,
      }
    };
  }

  // Compute next availability for the user (used in response when off)
  const nextAvailable = getNextAvailable(userName);

  // Helper: filter roster rows for backup candidates
  // skipRoleCheck: on weekends, any level can be backup regardless of L1/L2
  const filterCandidates = (rows, { requireTeam = false, skipRoleCheck = false } = {}) => {
    return rows.filter((row) => {
      if (!row[0] || !row[1]) return false;

      const rosterName = NAME_TO_ROSTER_MAP[userName] || userName;
      if (row[0].toLowerCase() === rosterName.toLowerCase()) return false;

      // Match L1/L2 level — unless weekend (anyone on shift can be backup)
      if (!skipRoleCheck) {
        const memberName = row[0];
        const memberRole = DESIGNATION_MAP[memberName] || DESIGNATION_MAP[row[0]] || "L1";
        if (memberRole !== userRole) return false;
      }

      const status = getShiftStatus(row, colIdx);
      if (!status.isOnShift) return false;

      // Exclude ON CALL engineers — they have separate on-call duties
      const rawShift = colIdx ? (row[colIdx] || "").toUpperCase().trim() : "";
      if (rawShift === "ON CALL") return false;

      if (isWeekend) {
        if (OFF_STATUSES.includes(rawShift) || !rawShift) return false;
      }

      if (requireTeam && teamMembers.length > 0) {
        const isTeamMember = teamMembers.some(m =>
          m.toLowerCase() === row[0].toLowerCase()
        );
        if (!isTeamMember) return false;
      }

      return true;
    }).map((row) => ({
      name: row[0],
      email: row[1],
      role: DESIGNATION_MAP[row[0]] || "L1",
      shift: colIdx ? row[colIdx] : "Unknown",
    }));
  };

  // User is NOT available - find backup
  let activeEngineers = [];
  let isWeekendFallback = false;

  if (isWeekend) {
    // Weekend: search ALL engineers on actual shifts, regardless of L1/L2
    activeEngineers = filterCandidates(getRosterRows(), { requireTeam: false, skipRoleCheck: true });
    if (activeEngineers.length > 0) isWeekendFallback = true;
    logger.info({ count: activeEngineers.length, userRole }, "Weekend: searching all engineers on shift (any level)");
  } else {
    // Weekday Step 1: Try team members first (for L1 with teamOnly)
    activeEngineers = filterCandidates(getRosterRows(), {
      requireTeam: userRole === "L1" && teamOnly === "true",
    });

    // Weekday Step 2: Cross-team fallback for L1 (if team filter yielded nothing)
    if (activeEngineers.length === 0 && userRole === "L1" && teamOnly === "true") {
      activeEngineers = filterCandidates(getRosterRows(), { requireTeam: false });
    }
  }

  if (activeEngineers.length === 0) {
    return {
      status: 200,
      data: {
        backup: null,
        needsBackup: true,
        userStatus: {
          isAvailable: false,
          reason: userShiftStatus?.reason || "Away",
          shift: userShiftStatus?.shift,
          nextAvailable: nextAvailable ? {
            date: nextAvailable.dateKey,
            shift: nextAvailable.shift,
            shiftStart: nextAvailable.shiftStart,
          } : null,
        },
        message: `No ${userRole} teammates currently on shift.`,
        team: userTeam,
      }
    };
  }

  // Calculate workload - count OPEN tickets only
  const tickets = await redisGet("tickets:active") || [];
  const workloadMap = {};
  const urgentWorkloadMap = {};
  activeEngineers.forEach((eng) => {
    workloadMap[eng.name.toLowerCase()] = 0;
    urgentWorkloadMap[eng.name.toLowerCase()] = 0;
  });

  tickets.forEach((t) => {
    const stageName = (t.stage?.name || "").toLowerCase();
    const isOpen = stageName.includes("waiting on assignee") ||
                   (stageName.includes("open") && !stageName.includes("closed"));

    if (!isOpen) return;

    const ownerName = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
                      t.owned_by?.[0]?.display_name || "";
    if (ownerName) {
      const nameKey = ownerName.toLowerCase();
      if (workloadMap.hasOwnProperty(nameKey)) {
        workloadMap[nameKey]++;

        const priority = (t.priority || "").toLowerCase();
        if (priority === "blocker" || priority === "high") {
          urgentWorkloadMap[nameKey]++;
        }
      }
    }
  });

  // Sort by least open tickets first (smart backup selection)
  activeEngineers.sort((a, b) => {
    return workloadMap[a.name.toLowerCase()] - workloadMap[b.name.toLowerCase()];
  });

  const backup = activeEngineers[0];

  return {
    status: 200,
    data: {
      backup: {
        name: backup.name,
        email: backup.email,
        role: backup.role,
        shift: backup.shift,
        currentLoad: workloadMap[backup.name.toLowerCase()],
        urgentTickets: urgentWorkloadMap[backup.name.toLowerCase()],
        isWeekendFallback,
      },
      needsBackup: true,
      userStatus: {
        isAvailable: false,
        reason: userShiftStatus?.reason || "Away",
        shift: userShiftStatus?.shift,
        nextAvailable: nextAvailable ? {
          date: nextAvailable.dateKey,
          shift: nextAvailable.shift,
          shiftStart: nextAvailable.shiftStart,
        } : null,
      },
      team: userTeam,
      allCandidates: activeEngineers.map((e) => ({
        name: e.name,
        role: e.role,
        shift: e.shift,
        load: workloadMap[e.name.toLowerCase()],
        urgentTickets: urgentWorkloadMap[e.name.toLowerCase()],
      })),
    }
  };
};

// Get full roster data for today (all engineers, shift status, days worked)
