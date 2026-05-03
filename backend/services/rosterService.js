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

// Returns true if the engineer is present in the active roster (Google Sheet).
// Used to exclude removed engineers (e.g. team transfers) from gamification.
export const isInRoster = (name) => {
  if (!name || !ROSTER_ROWS.length) return false;
  const rosterName = NAME_TO_ROSTER_MAP[name] || name;
  return ROSTER_ROWS.some(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
};

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

    let reason = null;
    if (!isActive) {
      // Better copy: tell whether shift is upcoming or already ended
      if (hours.overnight) {
        reason = currentHour < hours.start && currentHour >= hours.end
          ? `${shiftKey} starts at ${formatDecimalHour(hours.start)}`
          : `${shiftKey} ended`;
      } else if (currentHour < hours.start) {
        reason = `${shiftKey} starts at ${formatDecimalHour(hours.start)}`;
      } else {
        reason = `${shiftKey} ended at ${formatDecimalHour(hours.end)}`;
      }
    }

    return {
      isOnShift: isActive,
      shift: shiftKey,
      reason,
    };
  }

  logger.warn({ rawShift, name: row[0] }, "Unknown shift format");
  return { isOnShift: false, shift: rawShift, reason: `Unknown shift: ${rawShift}` };
};

// Calculate days worked from roster - ONLY count actual shift days within [start, min(today, end)]
export const getDaysWorked = (name, start, end) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Upper bound: today, OR the requested range end if it's earlier (e.g. Q1 ended Mar 31).
  const upperBound = end && end < today ? new Date(end) : today;

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

    if (colDate >= start && colDate <= upperBound) {
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

    // Find ALL header rows (supports multiple month sections like Jan + Feb + Apr)
    // A header row has date columns (D-MMM format). May or may not have "Designation"/"Level".
    const headerIndices = [];
    const datePattern = /^\d{1,2}-[A-Za-z]{3}$/;

    rows.forEach((r, idx) => {
      const dateColCount = r.filter((c) => datePattern.test(String(c).trim())).length;
      const hasEngineerOrName = r.some((c) => {
        const lower = String(c).toLowerCase().trim();
        return lower === "engineer" || lower === "name" ||
               lower.includes("designation") || lower.includes("level");
      });

      // A header row must have at least 5 date columns and some identifying column
      if (dateColCount >= 5 && hasEngineerOrName) {
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

    // Names to exclude — these are header labels or admin users, not GST engineers
    const EXCLUDED_NAMES = new Set([
      "engineer", "name", "manager", "pod name", "designation", "level",
      "anmol", "mashnu", "anmol sawhney",
    ]);

    headerIndices.forEach((headerIdx, sectionIndex) => {
      const headerRow = rows[headerIdx];

      const sectionDateMap = {};
      let engineerColIdx = 0; // default: first column (old Q1 format)
      let designationColIdx = -1;
      let dataStartIdx = headerIdx + 1; // default: data starts right after header

      // --- Step 1: Parse the header row for date columns ---
      headerRow.forEach((col, i) => {
        const colName = String(col).trim();
        const colLower = colName.toLowerCase();

        if (/^\d{1,2}-[A-Za-z]{3}$/.test(colName)) {
          sectionDateMap[colName] = i;
          DATE_COL_MAP[colName] = { section: sectionIndex, colIdx: i };
        }

        if (colLower === "engineer" || colLower === "name") {
          engineerColIdx = i;
        }

        if (designationColIdx === -1 && (
          colLower.includes("designation") || colLower.includes("level")
        )) {
          designationColIdx = i;
        }
      });

      // --- Step 2: Check for a sub-header row (April format) ---
      // If the header row didn't have "Engineer"/"Name", check the next row.
      // The sub-header has column labels like "Manager", "POD Name", "Engineer", "Designation"
      // but day names (Wed, Thu) instead of D-MMM dates.
      if (engineerColIdx === 0 && headerIdx + 1 < rows.length) {
        const nextRow = rows[headerIdx + 1];
        const nextHasEngineer = nextRow?.some((c) => {
          const lower = String(c).toLowerCase().trim();
          return lower === "engineer" || lower === "name";
        });

        if (nextHasEngineer) {
          nextRow.forEach((col, i) => {
            const lower = String(col).toLowerCase().trim();
            if (lower === "engineer" || lower === "name") {
              engineerColIdx = i;
            }
            if (designationColIdx === -1 && (lower.includes("designation") || lower.includes("level"))) {
              designationColIdx = i;
            }
          });
          dataStartIdx = headerIdx + 2; // skip both header AND sub-header
          logger.info({ section: sectionIndex + 1, engineerColIdx, designationColIdx }, "Sub-header detected (April format)");
        }
      }

      if (designationColIdx !== -1 && LEVEL_COL_IDX === -1) {
        LEVEL_COL_IDX = designationColIdx;
        logger.info({ column: designationColIdx }, "Level/Designation found");
      }

      logger.info({ section: sectionIndex + 1, engineerColIdx, dataStartIdx }, "Engineer column detected");

      const nextHeaderIdx = headerIndices[sectionIndex + 1];
      const sectionEndIdx = nextHeaderIdx ? nextHeaderIdx : rows.length;

      // Filter data rows: must have a non-empty engineer name, exclude header labels
      const sectionDataRows = rows.slice(dataStartIdx, sectionEndIdx)
        .filter((r) => {
          const name = r[engineerColIdx]?.trim();
          return name && name.length > 2 && !EXCLUDED_NAMES.has(name.toLowerCase());
        });

      logger.info({ section: sectionIndex + 1, dates: Object.keys(sectionDateMap).length, engineers: sectionDataRows.length }, "Roster section parsed");

      sectionDataRows.forEach((row) => {
        const name = row[engineerColIdx]?.trim();
        if (!name) return;

        if (!engineerDataMap[name]) {
          engineerDataMap[name] = {
            level: row[designationColIdx !== -1 ? designationColIdx : LEVEL_COL_IDX] || "L1",
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
    const currentYear = new Date().getFullYear();
    const allDates = Object.keys(DATE_COL_MAP).sort((a, b) => {
      const parseDate = (d) => {
        const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        const [day, mon] = d.split("-");
        return new Date(currentYear, months[mon] || 0, parseInt(day));
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

// Helper: format decimal hour to readable time (e.g. 10.5 → "10:30 AM")
const formatDecimalHour = (h) => {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  const period = hours >= 12 ? "PM" : "AM";
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${h12}:${String(mins).padStart(2, "0")} ${period}`;
};

// Find user's next working day from roster (looks ahead up to 14 days)
// Includes today if the shift hasn't started yet
const getNextAvailable = (userName) => {
  const rosterName = NAME_TO_ROSTER_MAP[userName] || userName;
  const row = ROSTER_ROWS.find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) return null;

  const istNow = getISTTime();
  const currentHour = getCurrentISTHour();
  const todayDate = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const VALID_SHIFTS = ["SHIFT 1", "SHIFT 2", "SHIFT 3", "SHIFT 4", "ON CALL"];

  const futureDates = [];
  for (const [dateKey, colIdx] of Object.entries(DATE_COL_MAP)) {
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
    activeEngineers = filterCandidates(ROSTER_ROWS, { requireTeam: false, skipRoleCheck: true });
    if (activeEngineers.length > 0) isWeekendFallback = true;
    logger.info({ count: activeEngineers.length, userRole }, "Weekend: searching all engineers on shift (any level)");
  } else {
    // Weekday Step 1: Try team members first (for L1 with teamOnly)
    activeEngineers = filterCandidates(ROSTER_ROWS, {
      requireTeam: userRole === "L1" && teamOnly === "true",
    });

    // Weekday Step 2: Cross-team fallback for L1 (if team filter yielded nothing)
    if (activeEngineers.length === 0 && userRole === "L1" && teamOnly === "true") {
      activeEngineers = filterCandidates(ROSTER_ROWS, { requireTeam: false });
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

  // If no quarterStart passed, compute from current quarter dynamically
  const start = quarterStart || new Date();

  // Names to exclude from roster display (header artifacts, non-GST admins)
  const ROSTER_EXCLUDE = new Set([
    "engineer", "name", "manager", "pod name", "designation",
    "anmol", "mashnu", "anmol sawhney",
  ]);

  const engineers = ROSTER_ROWS.map((row) => {
    const name = row[0];
    if (!name || ROSTER_EXCLUDE.has(name.toLowerCase())) return null;

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

// --- ROSTER VERIFICATION HELPERS ---

const MONTHS_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WORKING_SHIFTS = new Set(["SHIFT 1", "SHIFT 2", "SHIFT 3", "SHIFT 4", "ON CALL"]);

const parseRosterDate = (dateKey, year) => {
  const parts = dateKey.split("-");
  if (parts.length !== 2 || !MONTHS_MAP.hasOwnProperty(parts[1])) return null;
  const d = new Date(year, MONTHS_MAP[parts[1]], parseInt(parts[0]));
  return isNaN(d.getTime()) ? null : d;
};

const normalizeShift = (raw) => {
  const val = raw.toUpperCase().trim();
  const match = val.match(/(?:SHIFT\s*)?(\d)/);
  return match ? `SHIFT ${match[1]}` : val;
};

const buildDayEntry = (dateKey, colDate, raw) => {
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
  if (!ROSTER_ROWS || ROSTER_ROWS.length === 0) {
    return { error: "Roster data not loaded. Please sync first." };
  }

  const rosterName = NAME_TO_ROSTER_MAP[name] || name;
  const row = ROSTER_ROWS.find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) {
    return { error: `Engineer "${name}" not found in roster.`, availableEngineers: ROSTER_ROWS.map(r => r[0]) };
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

  for (const [dateKey, colIdx] of Object.entries(DATE_COL_MAP)) {
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
  if (!ROSTER_ROWS || ROSTER_ROWS.length === 0) {
    return { error: "Roster data not loaded. Please sync first." };
  }

  const rosterName = NAME_TO_ROSTER_MAP[name] || name;
  const row = ROSTER_ROWS.find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) {
    return { error: `Engineer "${name}" not found in roster.`, availableEngineers: ROSTER_ROWS.map(r => r[0]) };
  }

  const year = new Date().getFullYear();
  const from = fromDate ? new Date(fromDate) : getISTTime();
  from.setHours(0, 0, 0, 0);

  const upcoming = [];

  for (const [dateKey, colIdx] of Object.entries(DATE_COL_MAP)) {
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

// ---------------------------------------------------------------------------
// Get full roster for a specific month (e.g. "Apr", "2026")
// Returns every engineer's schedule for every day in that month.
// ---------------------------------------------------------------------------
export const getRosterByMonth = (monthName, year) => {
  if (!ROSTER_ROWS || ROSTER_ROWS.length === 0) {
    return { error: "Roster data not loaded. Please sync first." };
  }

  const y = parseInt(year) || new Date().getFullYear();
  const mon = monthName?.charAt(0).toUpperCase() + monthName?.slice(1, 3).toLowerCase();
  if (!MONTHS_MAP.hasOwnProperty(mon)) {
    return { error: `Invalid month "${monthName}". Use Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec.` };
  }

  // Collect all date columns for this month
  const monthDates = [];
  for (const [dateKey, colIdx] of Object.entries(DATE_COL_MAP)) {
    if (dateKey.endsWith(`-${mon}`)) {
      const colDate = parseRosterDate(dateKey, y);
      if (colDate) monthDates.push({ dateKey, colIdx, colDate });
    }
  }
  monthDates.sort((a, b) => a.colDate - b.colDate);

  if (monthDates.length === 0) {
    return { error: `No roster data found for ${mon} ${y}. The roster may not have been synced for this month yet.` };
  }

  const engineers = ROSTER_ROWS.map((row) => {
    const name = row[0];
    if (!name) return null;
    const designation = DESIGNATION_MAP[name] || row[LEVEL_COL_IDX] || "L1";
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
  if (!ROSTER_ROWS || ROSTER_ROWS.length === 0) {
    return { error: "Roster data not loaded. Please sync first." };
  }

  const rosterName = NAME_TO_ROSTER_MAP[name] || name;
  const row = ROSTER_ROWS.find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) {
    return { error: `Engineer "${name}" not found in roster.`, availableEngineers: ROSTER_ROWS.map(r => r[0]) };
  }

  const istNow = getISTTime();
  const year = istNow.getFullYear();
  const todayKey = format(istNow, "d-MMM");
  const currentHour = getCurrentISTHour();

  // Today's shift
  const todayColIdx = DATE_COL_MAP[todayKey];
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
  for (const [dateKey, colIdx] of Object.entries(DATE_COL_MAP)) {
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
  for (const [dateKey, colIdx] of Object.entries(DATE_COL_MAP)) {
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
