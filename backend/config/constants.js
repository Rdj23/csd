// Tickets solved before this date are historical backfill — no Slack alerts during sync.
// After this date, all "Understanding Gap - CS" tickets from GST reporters trigger alerts.
export const BACKFILL_CUTOFF = new Date("2026-02-20");

// Canonical list of ticket stages that count as "resolved" (lowercase only).
// All comparisons should .toLowerCase() first rather than listing every case variant.
// Used by drilldown queries, sync filters, and gamification scoring.
export const SOLVED_STATUSES = ["solved", "closed", "resolved"];

// Case-insensitive check: use this instead of SOLVED_STATUSES.includes(raw)
export const isSolvedStatus = (stage) =>
  SOLVED_STATUSES.includes((stage || "").toLowerCase());

// ═══════════════════════════════════════════════════════════════════════
// SINGLE SOURCE OF TRUTH — TEAM CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════
// To add/remove a team member: edit ONLY this array. All downstream maps
// (TEAM_GROUPS, GST_MEMBERS, DESIGNATION_MAP, EMAIL_TO_NAME_MAP,
//  GAMIFICATION_TEAM_MAP, TEAM_MAPPING) are auto-derived below.
//
// `aliases` = alternative display names DevRev might use for this person.
// These feed into GST_NAME_MAP so resolveOwnerName() can normalize them.
// `rosterName` = name as it appears in the Google Sheets roster (if different).
// ═══════════════════════════════════════════════════════════════════════
const TEAMS = [
  { lead: "Rohan", members: [
    { name: "Rohan",      devuId: "DEVU-1111", email: "rohan.jadhav@clevertap.com",    designation: "L2", aliases: ["Rohan Jadhav"] },
    { name: "Anurag",     devuId: "DEVU-550",  email: "anurag.ghatge@clevertap.com",   designation: "L1", aliases: ["Anurag Ghatge"] },
    { name: "Shreya",     devuId: "DEVU-1115", email: "shreya.khale@clevertap.com",    designation: "L1", aliases: ["Shreya Khale"] },
    { name: "Shubhankar", devuId: "DEVU-1087", email: "shubhankar@clevertap.com",      designation: "L1", aliases: [] },
  ]},
  { lead: "Shweta", members: [
    { name: "Shweta",    devuId: "DEVU-1113", email: "shweta.more@clevertap.com",     designation: "L2", aliases: ["Shweta.M"] },
    { name: "Archie",    devuId: "DEVU-1114", email: "archie@clevertap.com",          designation: "L1", aliases: ["Archie Bajaj"] },
    { name: "Musaveer",  devuId: "DEVU-736",  email: "musaveer@clevertap.com",        designation: "L1", aliases: ["Musaveer Manekia"] },
  ]},
  { lead: "Harsh", members: [
    { name: "Harsh",    devuId: "DEVU-1098", email: "harsh.singh@clevertap.com",     designation: "L2", aliases: ["Harsh Singh"] },
    { name: "Neha",     devuId: "DEVU-1072", email: "neha.yadav@clevertap.com",      designation: "L1", aliases: ["Neha Yadav"] },
    { name: "Vaibhav",  devuId: "DEVU-1122", email: "vaibhav.agarwal@clevertap.com", designation: "L1", aliases: ["Vaibhav Agarwal"] },
  ]},
  { lead: "Aditya", members: [
    { name: "Aditya",  devuId: "DEVU-5",    email: "aditya.mishra@clevertap.com",   designation: "L2", aliases: ["Aditya Mishra"] },
    { name: "Rishabh", devuId: "DEVU-2611", email: "rishabh.j@clevertap.com",       designation: "L1", aliases: ["Rishabh J", "rishabh.j"] },
    { name: "Nikita",  devuId: "DEVU-4",    email: "nikita.narwani@clevertap.com",  designation: "L1", aliases: ["nikita-narwani"] },
    { name: "Shreyas", devuId: "DEVU-1110", email: "shreyas.naikwadi@clevertap.com", designation: "L1", aliases: ["Shreyas Naikwadi"] },
  ]},
  { lead: "Debashish", members: [
    { name: "Debashish", devuId: "DEVU-1102", email: "debashish@clevertap.com",       designation: "L2", aliases: ["Debashish Muni"] },
    { name: "Adarsh",    devuId: "DEVU-1076", email: "adarsh.dubey@clevertap.com",    designation: "L2", aliases: [] },
    { name: "Tamanna",   devuId: "DEVU-689",  email: "tamanna@clevertap.com",         designation: "L2", aliases: ["Tamanna Khan"] },
  ]},
  { lead: "Adish", members: [
    { name: "Adish", devuId: "DEVU-1121", email: "adish@clevertap.com", designation: "L2", aliases: [] },
  ]},
];

// ── TEAMLESS MEMBERS — GST members not (yet) under a team lead ────────────
// These people ARE part of GST for individual/member purposes — ticket
// attribution, individual stats, and the gamification leaderboard (by
// designation) — but they intentionally do NOT belong to any team group, so
// no team is created for them and they never surface in team-level views.
// When a lead is assigned, move the entry into that lead's TEAMS block above.
//
// aliases = the exact DevRev owner display_name(s), so tickets owned by them
// resolve to the canonical name (their DevRev names are lowercase).
const TEAMLESS_MEMBERS = [
  { name: "Zeel",  devuId: "DEVU-3225", email: "zeel@clevertap.com",  designation: "L1", aliases: ["zeel"] },
  { name: "Soham", devuId: "DEVU-3226", email: "soham@clevertap.com", designation: "L1", aliases: ["soham"] },
];

// ── AUTO-DERIVED MAPS (computed once at module load) ─────────────────
// All downstream consumers import these derived maps — never edit them directly.

/** TEAM_GROUPS: { leadName: { devuId: memberName, ... }, ... } — legacy format for FLAT_TEAM_MAP */
export const TEAM_GROUPS = {};
/** GST_NAME_MAP: { aliasOrDisplayName: canonicalName } — normalizes DevRev display names */
export const GST_NAME_MAP = {};
/** GST_MEMBERS: Set of canonical member names */
export const GST_MEMBERS = new Set();

for (const team of TEAMS) {
  // Build TEAM_GROUPS (legacy format)
  TEAM_GROUPS[team.lead] = {};
  for (const m of team.members) {
    TEAM_GROUPS[team.lead][m.devuId] = m.name;
    // GST_MEMBERS
    GST_MEMBERS.add(m.name);
    // GST_NAME_MAP: map canonical name + all aliases → canonical name
    GST_NAME_MAP[m.name] = m.name;
    for (const alias of (m.aliases || [])) {
      GST_NAME_MAP[alias] = m.name;
    }
  }
}

// Teamless members join the member-level maps ONLY (GST_MEMBERS + name
// resolution) — deliberately NOT TEAM_GROUPS, so no team group is created.
for (const m of TEAMLESS_MEMBERS) {
  GST_MEMBERS.add(m.name);
  GST_NAME_MAP[m.name] = m.name;
  for (const alias of (m.aliases || [])) {
    GST_NAME_MAP[alias] = m.name;
  }
}

// Shift timings in IST (decimal hours: 7.5 = 7:30 AM)
export const SHIFT_HOURS = {
  "SHIFT 1": { start: 7.5, end: 16.5 },   // 7:30 AM - 4:30 PM
  "SHIFT 2": { start: 10.5, end: 19.5 },  // 10:30 AM - 7:30 PM
  "SHIFT 3": { start: 13.5, end: 22.5 },  // 1:30 PM - 10:30 PM
  "SHIFT 4": { start: 22.5, end: 7.5, overnight: true }, // 10:30 PM - 7:30 AM
  "ON CALL": { start: 0, end: 24 },
};

// Off status reasons with friendly display names
export const OFF_STATUS_MAP = {
  "WEEK OFF": "Week Off",
  "WO": "Week Off",
  "EL": "On Leave (EL)",
  "NH": "National Holiday",
  "PL": "Planned Leave",
  "PH": "Public Holiday",
  "L": "On Leave",
  "COMP OFF": "Comp Off",
  "OH": "Optional Holiday",
  "": "Away",
};
export const OFF_STATUSES = Object.keys(OFF_STATUS_MAP);

// ── AUTO-DERIVED from TEAMS (continued) ────────────────────────────

/** DESIGNATION_MAP: { memberName: "L1"|"L2" } — also maps rosterName variants */
export const DESIGNATION_MAP = {};
/** NAME_TO_ROSTER_MAP: { canonicalName: rosterName } — only for names that differ */
export const NAME_TO_ROSTER_MAP = {};
/** TEAM_MAPPING: { memberName: { team, members[] } } — for backup lookups */
export const TEAM_MAPPING = {};

for (const team of TEAMS) {
  const memberNames = team.members.map((m) => m.name);
  const teamInfo = { team: team.lead, members: memberNames };

  for (const m of team.members) {
    DESIGNATION_MAP[m.name] = m.designation;
    // Also map rosterName to designation if it differs
    if (m.rosterName) {
      DESIGNATION_MAP[m.rosterName] = m.designation;
      NAME_TO_ROSTER_MAP[m.name] = m.rosterName;
    }
    // TEAM_MAPPING: every member (and rosterName variant) → team info
    TEAM_MAPPING[m.name] = teamInfo;
    if (m.rosterName) TEAM_MAPPING[m.rosterName] = teamInfo;
  }
}

// Teamless members get a designation (drives their L1/L2 gamification bucket)
// but no team info — GAMIFICATION_TEAM_MAP intentionally omits them, so the
// leaderboard reports their team as the default "Unknown".
for (const m of TEAMLESS_MEMBERS) {
  DESIGNATION_MAP[m.name] = m.designation;
}

// --- SLACK ALERT CONFIGURATION ---
export const SLACK_ADMIN_ID = "<@U06G06YQR6E>"; // Tuaha Khan - Admin to notify

export const GST_SLACK_MEMBER_IDS = {
  "Tuaha Khan": "<@U06G06YQR6E>",
  "Mashnu Kanurkar": "<@U02QSTABJ1Y>",
  "Adish Gaikwad": "<@U03F46V6DLP>",
  "Debashish Muni": "<@U05HCEX0M3N>",
  "Shweta More": "<@U03GEG1D6HK>",
  "Unnati Rawal": "<@U05PCDP5J3S>",
  "Harsh Singh": "<@U087F8FEY04>",
  "Tamanna Khan": "<@U06BKN9AP0A>",
  "Adarsh Dubey": "<@U078D2NRPTM>",
  "Aditya Mishra": "<@U07AYMGV4G7>",
  "Anurag Ghatge": "<@U078FL0R57E>",
  "Archie Bajaj": "<@U06FX94R7NH>",
  "Musaveer Manekia": "<@U0864UQL50V>",
  "Neha Yadav": "<@U06GP0FB06L>",
  "Nikita Narwani": "<@U078D2P1FV1>",
  "Rohan Jadhav": "<@U080N75F9GR>",
  "Shreya Khale": "<@U0786GU2SDU>",
  "Shubhankar Bhattacharya": "<@U078RRJRA9F>",
  "Abhinav Srivastav": "<@U095564QECA>",
  "Shreyas Naikwadi": "<@U095JJM3X97>",
  "Vaibhav Agarwal": "<@U095434R8NR>",
};

/** GAMIFICATION_TEAM_MAP: { memberName: teamLead } — maps every member to their team lead */
export const GAMIFICATION_TEAM_MAP = {};
/** EMAIL_TO_NAME_MAP: { email: canonicalName } — for my-stats endpoint */
export const EMAIL_TO_NAME_MAP = {};

for (const team of TEAMS) {
  for (const m of team.members) {
    GAMIFICATION_TEAM_MAP[m.name] = team.lead;
    EMAIL_TO_NAME_MAP[m.email] = m.name;
  }
}
// Teamless members: email resolution only, no GAMIFICATION_TEAM_MAP entry.
for (const m of TEAMLESS_MEMBERS) {
  EMAIL_TO_NAME_MAP[m.email] = m.name;
}

// Flat DEVU-ID → GST name mapping (built from TEAM_GROUPS + teamless members)
export const GST_DEVU_MAP = {};
for (const members of Object.values(TEAM_GROUPS)) {
  for (const [devuId, name] of Object.entries(members)) {
    GST_DEVU_MAP[devuId] = name;
  }
}
// Teamless members still need DEVU-ID → name resolution for ticket ownership.
for (const m of TEAMLESS_MEMBERS) {
  GST_DEVU_MAP[m.devuId] = m.name;
}

// Helper functions
export const resolveOwnerName = (displayName) => {
  if (!displayName) return null;
  const resolved = GST_NAME_MAP[displayName];
  if (resolved && GST_MEMBERS.has(resolved)) return resolved;
  return null;
};

export const isGSTMember = (ownerName) => {
  if (!ownerName) return false;
  return GST_MEMBERS.has(ownerName);
};

// ═══════════════════════════════════════════════════════════════════════
// LEAVERS / INACTIVE-MEMBER HANDLING
// ═══════════════════════════════════════════════════════════════════════
// People who have left the org keep their historical data (for integrity)
// but should disappear from the live views.

/** Canonical names hard-excluded from the gamification leaderboard & percentile
 *  baselines. Their historical tickets stay in the DB. */
export const GAMIFICATION_EXCLUDED = new Set(["Debashish"]);
export const isGamificationExcluded = (name) => GAMIFICATION_EXCLUDED.has(name);

/** Activity view hides any member whose most recent comment is older than this
 *  many days (treated as "left the org"). Applied dynamically in
 *  activityController so a member who returns is automatically restored, and
 *  future leavers drop off without a config edit. */
export const INACTIVITY_HIDE_DAYS = 20;

// Helper to get current IST time (handles server running in UTC)
export const getISTTime = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  return new Date(utcTime + istOffset);
};

// Helper to get current hour in IST as decimal
export const getCurrentISTHour = () => {
  const ist = getISTTime();
  return ist.getHours() + ist.getMinutes() / 60;
};

// ---------------------------------------------------------------------------
// Dynamic quarter helpers — auto-compute date ranges from quarter key + year
// Quarter key format: "Q1_26", "Q2_26", "Q3_26", "Q4_26"  (QN_YY)
// Also supports weekly/monthly sub-ranges: "Q1_26_W3", "Q1_26_M2"
// ---------------------------------------------------------------------------

/** Map quarter number (1-4) → { startMonth, endMonth } (0-indexed) */
const QUARTER_MONTHS = {
  1: { startMonth: 0, endMonth: 2 },   // Jan–Mar
  2: { startMonth: 3, endMonth: 5 },   // Apr–Jun
  3: { startMonth: 6, endMonth: 8 },   // Jul–Sep
  4: { startMonth: 9, endMonth: 11 },  // Oct–Dec
};

/**
 * Get the current quarter key based on today's IST date.
 * Returns e.g. "Q2_26" for April 2026.
 */
export const getCurrentQuarterKey = () => {
  const ist = getISTTime();
  const q = Math.ceil((ist.getMonth() + 1) / 3);
  const yy = String(ist.getFullYear()).slice(-2);
  return `Q${q}_${yy}`;
};

/**
 * Parse a quarter key like "Q2_26" → { q: 2, year: 2026 }
 * Also handles sub-keys like "Q1_26_W5" or "Q1_26_M2".
 */
const parseQuarterKey = (key) => {
  const match = key.match(/^Q([1-4])_(\d{2})(?:_(W|M)(\d+))?$/);
  if (!match) return null;
  return {
    q: parseInt(match[1]),
    year: 2000 + parseInt(match[2]),
    subType: match[3] || null,   // "W" or "M" or null
    subNum: match[4] ? parseInt(match[4]) : null,
  };
};

/**
 * Get the last day of a month (handles leap years).
 */
const lastDayOfMonth = (year, month) => new Date(year, month + 1, 0).getDate();

/**
 * Dynamically compute date range for any quarter key.
 * Supports: "Q2_26", "Q1_26_W5", "Q1_26_M2", etc.
 */
export const getQuarterDateRange = (quarter) => {
  const parsed = parseQuarterKey(quarter);

  if (!parsed) {
    // Fallback: last 60 days
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 60);
    return { start, end: now };
  }

  const { q, year, subType, subNum } = parsed;
  const { startMonth, endMonth } = QUARTER_MONTHS[q];

  // Full quarter range
  const qStart = new Date(Date.UTC(year, startMonth, 1));
  const qEndDay = lastDayOfMonth(year, endMonth);
  const qEnd = new Date(Date.UTC(year, endMonth, qEndDay, 23, 59, 59));

  if (!subType) {
    return { start: qStart, end: qEnd };
  }

  // Monthly sub-range: M1 = first month of quarter, M2 = second, M3 = third
  if (subType === "M" && subNum >= 1 && subNum <= 3) {
    const m = startMonth + (subNum - 1);
    const mEnd = lastDayOfMonth(year, m);
    return {
      start: new Date(Date.UTC(year, m, 1)),
      end: new Date(Date.UTC(year, m, mEnd, 23, 59, 59)),
    };
  }

  // Weekly sub-range: W1–W13 (each quarter has ~13 weeks)
  if (subType === "W" && subNum >= 1 && subNum <= 14) {
    const wStart = new Date(qStart);
    wStart.setDate(wStart.getDate() + (subNum - 1) * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 6);
    wEnd.setHours(23, 59, 59, 999);
    // Clamp to quarter end
    if (wEnd > qEnd) return { start: wStart, end: qEnd };
    return { start: wStart, end: wEnd };
  }

  return { start: qStart, end: qEnd };
};

/**
 * Resolve date range from query params.
 * Priority: startDate/endDate > quarter preset.
 * Returns { start: Date, end: Date, label: string }.
 */
export const resolveDateRange = ({ quarter, startDate, endDate }) => {
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(`${endDate}T23:59:59Z`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { error: "Invalid startDate or endDate. Use YYYY-MM-DD format." };
    }
    if (start > end) {
      return { error: "startDate must be before endDate." };
    }
    const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;
    if (end - start > MAX_RANGE_MS) {
      return { error: "Date range cannot exceed 365 days." };
    }
    return { start, end, label: `${startDate} to ${endDate}` };
  }
  const effectiveQuarter = quarter || getCurrentQuarterKey();
  const { start, end } = getQuarterDateRange(effectiveQuarter);
  return { start, end, label: effectiveQuarter };
};
