/**
 * roster/shifts — Reading one roster cell: is this person working, which shift, and when.
 *
 * Extracted from the 1157-line rosterService.js; logic unchanged.
 * See roster/index.js for how the pieces fit together.
 */

import logger from "../../config/logger.js";
import { NAME_TO_ROSTER_MAP, OFF_STATUSES, OFF_STATUS_MAP, SHIFT_HOURS, getCurrentISTHour } from "../../config/constants.js";
import { DATE_COL_MAP, ROSTER_ROWS, getDateColMap, getRosterRows } from "./snapshot.js";

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
  const row = getRosterRows().find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
  if (!row) {
    logger.warn({ name, rosterName }, "getDaysWorked: No roster row found");
    return 0;
  }

  let days = 0;
  const VALID_SHIFTS = ["SHIFT 1", "SHIFT 2", "SHIFT 3", "SHIFT 4"];
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  for (const [dateKey, colIdx] of Object.entries(getDateColMap())) {
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

// Convert a 1-based column count to A1-notation column letters (1 -> "A",
// 26 -> "Z", 27 -> "AA", 52 -> "AZ"). Used to build a fetch range that spans
// the sheet's full width without hardcoding a column ceiling.

// Helper: format decimal hour to readable time (e.g. 10.5 → "10:30 AM")
export const formatDecimalHour = (h) => {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  const period = hours >= 12 ? "PM" : "AM";
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${h12}:${String(mins).padStart(2, "0")} ${period}`;
};
