/**
 * roster/snapshot — The in-memory roster snapshot and its ONLY writer (Google Sheets -> Redis).
 *
 * Extracted from the 1157-line rosterService.js; logic unchanged.
 * See roster/index.js for how the pieces fit together.
 */

import logger from "../../config/logger.js";
import { NAME_TO_ROSTER_MAP, TEAM_GROUPS } from "../../config/constants.js";
import { redisGet, redisSet } from "../../lib/cache.js";
import { google } from "googleapis";

// --- MUTABLE ROSTER STATE ---
export let ROSTER_ROWS = [];
export let DATE_COL_MAP = {};
export let LEVEL_COL_IDX = -1;

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

const columnIndexToLetter = (n) => {
  let letter = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter || "A";
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
    const firstSheet = meta.data.sheets?.[0]?.properties;
    const sheetName = firstSheet?.title || "Sheet1";

    // Derive the range from the sheet's actual dimensions instead of a fixed
    // ceiling. The roster grows DOWNWARD — each new month is appended as a new
    // section, so a hardcoded row limit (previously A1:AZ100) silently truncates
    // the newest month once cumulative rows cross it (e.g. the June section at
    // row 101+ was never fetched, so "2-Jun" was missing from DATE_COL_MAP).
    const rowCount = firstSheet?.gridProperties?.rowCount || 1000;
    const colCount = firstSheet?.gridProperties?.columnCount || 52;
    const lastCol = columnIndexToLetter(colCount);
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.ROSTER_SHEET_ID,
      range: `'${sheetName}'!A1:${lastCol}${rowCount}`,
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
