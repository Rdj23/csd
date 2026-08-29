/**
 * attention/roster — Roster API client — who is on shift and when it ends.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import axios from "axios";
import logger from "../../config/logger.js";
import { EMAIL_TO_NAME_MAP, GST_MEMBERS, resolveOwnerName } from "../../config/constants.js";
import { redisGet, redisSet } from "../../lib/cache.js";

// ── Roster API client ────────────────────────────────────────────────────
// Reads shift assignments from the GST Hub roster API. Only four fields are
// consumed: email, engineer_name, shift, slack_id. `shift` doubles as an
// off-status ("Week Off", "EL"…) — but since 2026-08-12 an invalid/off shift
// no longer skips the member: the sweep falls back to their last known shift
// (queues build for EVERYONE, every day; the roster only picks the timing).

const extractSlackMention = (raw) => {
  const m = String(raw || "").match(/([UW][A-Z0-9]{6,})/);
  return m ? `<@${m[1]}>` : null;
};

const canonicalMemberName = (row) =>
  EMAIL_TO_NAME_MAP[(row.email || "").toLowerCase()] ||
  resolveOwnerName(row.engineer_name) ||
  (GST_MEMBERS.has(row.engineer_name) ? row.engineer_name : null);

/**
 * Fetch TODAY's roster rows. This is deliberately the only roster API call
 * we make — the endpoint (gst-hub /api/v1/roster/today) serves the current
 * day only, per team decision. Anything about other days (next shift start,
 * overnight boundaries) is derived locally from SHIFT_HOURS. Team-lead
 * resolution never uses this API either — it comes from the TEAMS mapping
 * in constants.js.
 * Returns [] when unavailable.
 */
// The sweep runs every 15 min (96×/day) but only ~12 of those ticks fall in a
// real shift instant; the rest establish "nobody is due" and exit. Each one
// still made a live HTTP call to the roster API. Shift assignments change at
// most daily, so a short cache turns 96 outbound calls into ~6 without
// touching any timing logic. Kept deliberately short so a same-day roster
// correction still lands within one sweep interval.
const ROSTER_CACHE_KEY = "attention:roster:shifts";
const ROSTER_CACHE_TTL_S = 600;

export const fetchRosterShifts = async () => {
  const base = process.env.ROSTER_API_URL;
  if (!base) {
    logger.warn("ROSTER_API_URL not set — attention sweep has no shift data");
    return [];
  }

  const cached = await redisGet(ROSTER_CACHE_KEY);
  if (cached) return cached;

  const headers = {};
  if (process.env.ROSTER_API_TOKEN) headers.Authorization = `Bearer ${process.env.ROSTER_API_TOKEN}`;
  if (process.env.ROSTER_API_KEY) headers["x-api-key"] = process.env.ROSTER_API_KEY;

  const res = await axios.get(base, { headers, timeout: 20000 });
  const rows = res.data?.data || res.data || [];
  const shifts = rows
    .map((r) => ({
      email: (r.email || "").toLowerCase(),
      name: canonicalMemberName(r),
      // Roster sometimes suffixes shifts with markers ("Shift 4*") — strip
      // anything after the shift number or the SHIFT_HOURS lookup misses.
      shift: (r.shift || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, "").trim(),
      slackMention: extractSlackMention(r.slack_id),
    }))
    .filter((r) => r.name); // silently ignore rows we can't map to a GST member

  // Cache only a non-empty result: an empty roster (API blip, auth failure)
  // would otherwise pin "nobody is on shift" for 10 minutes and silently skip
  // a real queue-build window.
  if (shifts.length) await redisSet(ROSTER_CACHE_KEY, shifts, ROSTER_CACHE_TTL_S);
  return shifts;
};
