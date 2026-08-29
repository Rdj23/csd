/**
 * attention/config — Tunables, rule thresholds, reminder tags, timing table.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

// ── Tunables ─────────────────────────────────────────────────────────────
export const DAY_MS = 24 * 60 * 60 * 1000;

export const ATTENTION_RULES = {
  OPEN_MIN_AGE_DAYS: 4,
  ONHOLD_AGENT_SILENCE_DAYS: 2,
  // Pending follow-up cadence in BUSINESS days (the DevRev automation only
  // fires Mon–Fri IST — a follow-up "due" on a weekend legitimately slips
  // to Monday, and business-day counting keeps that from flagging).
  // Rohan 2026-08-04: a first/second reminder within the LAST 3 BUSINESS
  // DAYS = automation on track, never alert; flag from the 4th.
  PENDING_FIRST_FOLLOWUP_BD: 3, // pending start → first follow-up due
  PENDING_REMINDER_QUIET_BD: 3, // reminder tag + last touch ≤3bd = on track
  PENDING_GRACE_BD: 1,          // flag once overdue by a full business day
  PENDING_FINAL_CLOSE_BD: 2,    // after FINAL reminder → needs a manual close
  PENDING_CUSTOMER_REPLY_GRACE_MS: DAY_MS, // customer spoke last, still pending
};

// Per-shift schedule (IST decimal hours, agreed with Rohan 2026-08-05):
// queueAt   — when the day's queue BUILDS and replaces the previous one on
//             the dashboard (~45 min before shift end). Dashboard-only: no
//             Slack at build time.
// slackAt   — when the shift-end Slack summary posts (~15 min before shift
//             end), from whatever the queue looks like at that moment.
// escalateAt — first TL escalation. SAME-day for the overnight SHIFT 4
//             (queue posts in the morning, the member's next shift starts
//             the same evening) and next-day for the rest.
// Deliberately explicit per shift — the offsets are not uniform, don't try
// to derive them from SHIFT_HOURS. All instants land on */15 cron ticks.
export const ATTENTION_TIMING = {
  "SHIFT 1": { queueAt: 15.75, slackAt: 16.25, escalateAt: 8.75,  escalateNextDay: true },  // 3:45 PM / 4:15 PM → 8:45 AM
  "SHIFT 2": { queueAt: 18.75, slackAt: 19.25, escalateAt: 11.25, escalateNextDay: true },  // 6:45 PM / 7:15 PM → 11:15 AM
  "SHIFT 3": { queueAt: 21.25, slackAt: 21.75, escalateAt: 14.5,  escalateNextDay: true },  // 9:15 PM / 9:45 PM → 2:30 PM
  "SHIFT 4": { queueAt: 6.0,   slackAt: 6.75,  escalateAt: 23.25, escalateNextDay: false }, // 6:00 AM / 6:45 AM → 11:15 PM same day
};

export const BUILD_WINDOW_MS = 30 * 60 * 1000;      // late-tick tolerance after queueAt

// Tags the DevRev auto-reminder workflow sets (compared lowercased). The
// final tag's exact DevRev name is unconfirmed — match plausible variants.
// OPEN bucket: any reminder tag exempts the ticket (automation owns it,
// original spec). PENDING bucket: tags NEVER gate — they only choose the
// overdue threshold + reason wording, because tags are sticky (they survive
// the conversation resuming; team decision 2026-08-02). Worst case a stale
// tag flags one business day early — it can never hide a silent ticket.
const FIRST_REMINDER_TAGS = new Set(["first-reminder-sent", "first reminder sent"]);
export const SECOND_REMINDER_TAGS = new Set(["second-reminder-sent", "second reminder sent"]);
export const FINAL_REMINDER_TAGS = new Set([
  "third-reminder-sent", "third reminder sent", "3rd reminder sent",
  "final-reminder-sent", "final reminder sent",
]);
export const REMINDER_TAGS = new Set([
  ...FIRST_REMINDER_TAGS, ...SECOND_REMINDER_TAGS, ...FINAL_REMINDER_TAGS,
]);
export const TICKET_URL = (id) => `https://app.devrev.ai/clevertapsupport/works/${id}`;
