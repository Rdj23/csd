import { google } from "googleapis";
import { format } from "date-fns";
import {
  SHIFT_HOURS,
  OFF_STATUS_MAP,
  OFF_STATUSES,
  DESIGNATION_MAP,
  NAME_TO_ROSTER_MAP,
  GAMIFICATION_TEAM_MAP,
  TEAM_GROUPS,
  TEAM_MAPPING,
  getISTTime,
  getCurrentISTHour,
  getQuarterDateRange,
} from "../config/constants.js";
import { redisGet, redisSet } from "../config/database.js";
import logger from "../config/logger.js";

// --- MUTABLE ROSTER STATE ---
let ROSTER_ROWS = [];
let DATE_COL_MAP = {};
let LEVEL_COL_IDX = -1;

export const getRosterRows = () => ROSTER_ROWS;
export const getDateColMap = () => DATE_COL_MAP;
export const getLevelColIdx = () => LEVEL_COL_IDX;

// Build FLAT_TEAM_MAP from TEAM_GROUPS
const buildFlatTeamMap = () => {
  const FLAT_TEAM_MAP = {};
  Object.entries(TEAM_GROUPS).forEach(([lead, members]) => {
    Object.entries(members).forEach(([id, name]) => {
      FLAT_TEAM_MAP[id] = name;
    });
  });
  return FLAT_TEAM_MAP;
};

export const FLAT_TEAM_MAP = buildFlatTeamMap();

// Helper to get shift status details for a roster row
export const getShiftStatus = (row, colIdx) => {
  const currentHour = getCurrentISTHour();
  const rawShift = colIdx ? (row[colIdx] || "").trim() : "";
  const shift = rawShift.toUpperCase();

  // Check if off
  if (OFF_STATUSES.includes(shift)) {
    return {
      isOnShift: false,
      shift: shift,
      reason: OFF_STATUS_MAP[shift] || "Away"
    };
  }

  // Normalize shift name - extract shift number
  const shiftMatch = shift.match(/(?:SHIFT\s*)?(\d)/i);
  const shiftNum = shiftMatch ? shiftMatch[1] : null;
  const shiftKey = shiftNum ? `SHIFT ${shiftNum}` : shift.replace(/\s+/g, " ").trim();

  const hours = SHIFT_HOURS[shiftKey];

  if (hours) {
    let isActive;
    if (hours.overnight) {
      isActive = currentHour >= hours.start || currentHour < hours.end;
    } else {
      isActive = currentHour >= hours.start && currentHour < hours.end;
    }
    logger.info({ name: row[0], shiftKey, start: hours.start, end: hours.end, currentHour: currentHour.toFixed(2), isActive }, "Shift status check");
    return {
      isOnShift: isActive,
      shift: shiftKey,
      reason: isActive ? null : `Not in ${shiftKey} hours`
    };
  }

  logger.warn({ rawShift, name: row[0] }, "Unknown shift format");
  return { isOnShift: false, shift: rawShift, reason: `Unknown shift: ${rawShift}` };
};

// Calculate days worked from roster - ONLY count actual shift days up to today
export const getDaysWorked = (name, start) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const rosterName = NAME_TO_ROSTER_MAP[name] || name;
  const row = ROSTER_ROWS.find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) {
    logger.warn({ name, rosterName }, "getDaysWorked: No roster row found");
    return 0;
  }

  let days = 0;
  const VALID_SHIFTS = ["SHIFT 1", "SHIFT 2", "SHIFT 3", "SHIFT 4"];
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  for (const [dateKey, colIdx] of Object.entries(DATE_COL_MAP)) {
    // Parse "D-Mon" format (e.g. "1-Jan", "18-Feb") manually for reliability
    const parts = dateKey.split("-");
    if (parts.length !== 2 || !MONTHS.hasOwnProperty(parts[1])) continue;
    const colDate = new Date(today.getFullYear(), MONTHS[parts[1]], parseInt(parts[0]));
    if (isNaN(colDate.getTime())) continue;

    if (colDate >= start && colDate <= today) {
      const val = (row[colIdx] || "").toUpperCase().trim();
      // Normalize shift format (handles "SHIFT1", "SHIFT 1", "1", etc.)
      const shiftMatch = val.match(/(?:SHIFT\s*)?(\d)/);
      const normalized = shiftMatch ? `SHIFT ${shiftMatch[1]}` : val;
      if (VALID_SHIFTS.includes(normalized)) {
        days++;
      }
    }
  }
  return days;
};

export const syncRoster = async () => {
  logger.info("Roster Sync started");

  if (!process.env.GOOGLE_SHEETS_KEY_BASE64) {
    logger.error("FATAL: GOOGLE_SHEETS_KEY_BASE64 is missing");
    return;
  }

  try {
    const decodedKey = Buffer.from(
      process.env.GOOGLE_SHEETS_KEY_BASE64,
      "base64",
    ).toString();
    const creds = JSON.parse(decodedKey);

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    // Fetch Data
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: process.env.ROSTER_SHEET_ID,
    });
    const sheetName = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.ROSTER_SHEET_ID,
      range: `'${sheetName}'!A1:AZ100`,
    });
    const rows = resp.data.values || [];

    // Find ALL header rows (supports multiple month sections like Jan + Feb)
    const headerIndices = [];
    const datePattern = /^\d{1,2}-[A-Za-z]{3}$/;

    rows.forEach((r, idx) => {
      const hasDesignation = r.some((c) =>
        String(c).toLowerCase().includes("designation") ||
        String(c).toLowerCase().includes("level")
      );
      const hasDateColumns = r.some((c) => datePattern.test(String(c).trim()));

      if (hasDesignation && hasDateColumns) {
        headerIndices.push(idx);
      }
    });

    if (headerIndices.length === 0) {
      logger.warn("Could not find header row in Roster (need rows with Designation + date columns)");
      return;
    }

    logger.info({ sections: headerIndices.length }, "Found month sections in roster");

    // Reset and build DATE_COL_MAP from ALL header rows
    DATE_COL_MAP = {};
    LEVEL_COL_IDX = -1;

    const engineerDataMap = {};

    headerIndices.forEach((headerIdx, sectionIndex) => {
      const headerRow = rows[headerIdx];

      const sectionDateMap = {};
      headerRow.forEach((col, i) => {
        const colName = String(col).trim();

        if (/^\d{1,2}-[A-Za-z]{3}$/.test(colName)) {
          sectionDateMap[colName] = i;
          DATE_COL_MAP[colName] = { section: sectionIndex, colIdx: i };
        }

        if (LEVEL_COL_IDX === -1 && (
          colName.toLowerCase().includes("designation") ||
          colName.toLowerCase().includes("level")
        )) {
          LEVEL_COL_IDX = i;
          logger.info({ column: i }, "Level/Designation found");
        }
      });

      const nextHeaderIdx = headerIndices[sectionIndex + 1];
      const sectionEndIdx = nextHeaderIdx ? nextHeaderIdx : rows.length;

      const sectionDataRows = rows.slice(headerIdx + 1, sectionEndIdx)
        .filter((r) => r[0]?.length > 2);

      logger.info({ section: sectionIndex + 1, dates: Object.keys(sectionDateMap).length, engineers: sectionDataRows.length }, "Roster section parsed");

      sectionDataRows.forEach((row) => {
        const name = row[0]?.trim();
        if (!name) return;

        if (!engineerDataMap[name]) {
          engineerDataMap[name] = {
            level: row[LEVEL_COL_IDX] || "L1",
            shifts: {}
          };
        }

        Object.entries(sectionDateMap).forEach(([dateKey, colIdx]) => {
          const shiftValue = row[colIdx] || "";
          if (shiftValue.trim()) {
            engineerDataMap[name].shifts[dateKey] = shiftValue.trim();
          }
        });
      });
    });

    // Convert engineerDataMap to ROSTER_ROWS format
    const allDates = Object.keys(DATE_COL_MAP).sort((a, b) => {
      const parseDate = (d) => {
        const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        const [day, mon] = d.split("-");
        return new Date(2025, months[mon] || 0, parseInt(day));
      };
      return parseDate(a) - parseDate(b);
    });

    // Rebuild DATE_COL_MAP with sequential column indices
    DATE_COL_MAP = {};
    allDates.forEach((dateKey, i) => {
      DATE_COL_MAP[dateKey] = i + 2; // +2 because col0=name, col1=level
    });
    LEVEL_COL_IDX = 1;

    // Build ROSTER_ROWS
    ROSTER_ROWS = Object.entries(engineerDataMap).map(([name, data]) => {
      const row = [name, data.level];
      allDates.forEach((dateKey) => {
        row.push(data.shifts[dateKey] || "");
      });
      return row;
    });

    logger.info({ engineers: ROSTER_ROWS.length, totalDays: allDates.length, months: headerIndices.length }, "Engineers loaded from roster");

    // Serialize roster data to Redis so API server can load it without Google Sheets access
    await saveRosterToRedis();
  } catch (e) {
    logger.error({ err: e }, "Roster error");
  }
};

// Serialize roster data to Redis (called by Worker after sync)
const saveRosterToRedis = async () => {
  try {
    await redisSet("roster:data", {
      rows: ROSTER_ROWS,
      dateColMap: DATE_COL_MAP,
      levelColIdx: LEVEL_COL_IDX,
    }, 86400); // 24 hour TTL
    logger.info("Roster data saved to Redis");
  } catch (e) {
    logger.error({ err: e }, "Failed to save roster to Redis");
  }
};

// Load roster data from Redis (called by API server on startup and roster-updated events)
export const loadRosterFromRedis = async () => {
  try {
    const data = await redisGet("roster:data");
    if (data && data.rows && data.rows.length > 0) {
      ROSTER_ROWS = data.rows;
      DATE_COL_MAP = data.dateColMap || {};
      LEVEL_COL_IDX = data.levelColIdx ?? -1;
      logger.info({ engineers: ROSTER_ROWS.length }, "Roster loaded from Redis");
      return true;
    }
    return false;
  } catch (e) {
    logger.error({ err: e }, "Failed to load roster from Redis");
    return false;
  }
};

// Get profile status for a user
export const getProfileStatus = (userName) => {
  const dateKey = format(new Date(), "d-MMM");
  const colIdx = DATE_COL_MAP[dateKey];
  const row = ROSTER_ROWS.find((r) =>
    r[0]?.toLowerCase().includes(userName?.toLowerCase()),
  );
  const shift = row?.[colIdx]?.toUpperCase() || "?";
  const isActive = !["WO", "L", "PL", ""].includes(shift);
  return { isActive, shift, status: isActive ? "On Shift" : "Off" };
};

// Find backup for a user
export const findBackupForUser = async (userName, teamOnly = "true") => {
  const istNow = getISTTime();
  const dateKey = format(istNow, "d-MMM");
  const colIdx = DATE_COL_MAP[dateKey];
  const currentHour = getCurrentISTHour();
  const dayOfWeek = istNow.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  logger.info({ istTime: istNow.toISOString(), hour: currentHour.toFixed(2), dateKey }, "Backup API called");

  if (!ROSTER_ROWS || ROSTER_ROWS.length === 0) {
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
    logger.warn({ dateKey, availableDates: Object.keys(DATE_COL_MAP).slice(0, 5) }, "Date column not found");
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
    const userRow = ROSTER_ROWS.find((r) =>
      r[0]?.toLowerCase() === rosterName?.toLowerCase()
    );
    if (userRow) {
      userShiftStatus = getShiftStatus(userRow, colIdx);
      logger.info({ userName, rosterName, shift: userShiftStatus.shift, isOnShift: userShiftStatus.isOnShift }, "User shift status");
    } else {
      logger.warn({ userName, rosterName }, "User not found in roster");
    }
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

  // User is NOT available - find backup
  const activeEngineers = ROSTER_ROWS.filter((row) => {
    if (!row[0] || !row[1]) return false;

    const rosterName = NAME_TO_ROSTER_MAP[userName] || userName;
    if (row[0].toLowerCase() === rosterName.toLowerCase()) return false;

    const memberName = row[0];
    const memberRole = DESIGNATION_MAP[memberName] || DESIGNATION_MAP[row[0]] || "L1";
    if (memberRole !== userRole) return false;

    const status = getShiftStatus(row, colIdx);
    if (!status.isOnShift) return false;

    if (isWeekend) {
      const shift = colIdx ? (row[colIdx] || "").toUpperCase().trim() : "";
      if (OFF_STATUSES.includes(shift) || !shift) return false;
    }

    if (userRole === "L1" && teamOnly === "true" && teamMembers.length > 0) {
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
      },
      needsBackup: true,
      userStatus: {
        isAvailable: false,
        reason: userShiftStatus?.reason || "Away",
        shift: userShiftStatus?.shift,
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
export const getFullRoster = async (quarterStart) => {
  const istNow = getISTTime();
  const dateKey = format(istNow, "d-MMM");
  const colIdx = DATE_COL_MAP[dateKey];
  const currentHour = getCurrentISTHour();

  if (!ROSTER_ROWS || ROSTER_ROWS.length === 0) {
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

  const start = quarterStart || new Date("2026-01-01");
  const engineers = ROSTER_ROWS.map((row) => {
    const name = row[0];
    if (!name) return null;

    const designation = DESIGNATION_MAP[name] || row[LEVEL_COL_IDX] || "L1";
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

// Get workload for all active engineers
export const getWorkload = async () => {
  const istNow = getISTTime();
  const dateKey = format(istNow, "d-MMM");
  const colIdx = DATE_COL_MAP[dateKey];
  const currentHour = getCurrentISTHour();

  logger.info({ dateKey, istHour: currentHour.toFixed(2) }, "Workload check");

  const activeEngineers = ROSTER_ROWS.filter((row) => {
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
    role: row[LEVEL_COL_IDX] || "L1",
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
