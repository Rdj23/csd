/**
 * Roster — who is working, when, and who covers when they are not.
 *
 * SOURCE OF TRUTH: a Google Sheet, one row per engineer, one column per date.
 * syncRoster() pulls it, parses it into a rectangular snapshot, and caches
 * that snapshot in Redis so a restart does not need a Sheets round trip.
 * Everything else in this feature is a READ over that snapshot.
 *
 * ── WHERE THE CODE LIVES ────────────────────────────────────────────────
 * In dependency order; each module may only import from those above it.
 *
 *   snapshot.js     The in-memory snapshot (ROSTER_ROWS / DATE_COL_MAP /
 *                   LEVEL_COL_IDX) and its ONLY writer — the Sheets sync and
 *                   the Redis save/load. Nothing else may assign to it;
 *                   readers go through getRosterRows() / getDateColMap() /
 *                   getLevelColIdx() so there is one owner of that state.
 *   shifts.js       Reading a single roster cell: working or off, which
 *                   shift, and when that shift starts/ends.
 *   backup.js       The backup-resolution ladder — who covers for someone
 *                   who is off (same team first, then widening).
 *   workingDays.js  Calendar queries: which days a person works, next N.
 *   queries.js      The read-only views the API serves: full roster, month
 *                   grid, today's status, workload.
 *
 * Changing how the SHEET is parsed means snapshot.js. Changing who gets
 * picked as a backup means backup.js. Neither touches the other.
 */

// ── Public surface ───────────────────────────────────────────────────────
// Exactly the 17 symbols services/rosterService.js used to export.

export {
  getRosterRows,
  getDateColMap,
  getLevelColIdx,
  isInRoster,
  FLAT_TEAM_MAP,
  syncRoster,
  loadRosterFromRedis,
} from "./snapshot.js";

export { getShiftStatus, getDaysWorked } from "./shifts.js";
export { getProfileStatus, findBackupForUser } from "./backup.js";
export { getWorkingDayDetails, getNextWorkingDays } from "./workingDays.js";
export { getFullRoster, getRosterByMonth, getTodayStatus, getWorkload } from "./queries.js";
