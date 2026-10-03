/**
 * attentionService.js — Attention Queue: shift-aware backlog nudges.
 *
 * WHAT THIS DOES:
 * ~45 min before each GST member's shift ends (ATTENTION_TIMING.queueAt),
 * build them a queue of tickets that need action (aging open / silent
 * pending / stuck on-hold) and push it to the dashboard — replacing the
 * previous day's queue, which stays visible until then so there is ALWAYS
 * a list to work from. ~15 min before shift end (slackAt) a Slack summary
 * posts from whatever the queue looks like at that moment. Clearing the
 * queue is VERIFIED against live DevRev data — the only way to silence it
 * is to actually action the tickets. "Tracked" items are a one-day snooze,
 * earned by EITHER a dashboard remark OR an internal DevRev note left on
 * the queue's own IST day (both mean "I picked this up") — so a
 * still-blocked ticket lands back in its bucket at the next build (we
 * don't want people to track-and-forget). Uncleared queues get exactly ONE
 * "no action" follow-up at a fixed time after the member's next shift
 * starts — no hourly repeats (Rohan 2026-08-08: repeats read as spam).
 *
 * SLACK IS MON–FRI ONLY (Rohan 2026-08-09, after Musaveer got a Sunday
 * follow-up for his Saturday queue): weekend shifts are assigned ad hoc and
 * rarely match the weekday roster, so any Slack timed off shift data is
 * wrong on Sat/Sun. Queues still BUILD every day (the dashboard always has
 * a list to work from) — but summaries, follow-ups and congrats only post
 * on business days. A follow-up that lands on a weekend slides to Monday at
 * the same shift time, and posts to the member whether or not they are
 * working that day (no leave-skip — teammates can action the tickets).
 *
 * RULES ("response" = EXTERNAL comment; internal notes never count —
 * verified 2026-08-02 against DevRev timeline data, see
 * scripts/verifyResponseTimestamps.js):
 *   open    — created ≥4 days ago AND no org-side external reply today (IST).
 *             Skipped when a reminder tag is present (the DevRev reminder
 *             automation owns those tickets end-to-end).
 *   pending — flags only when the DevRev follow-up automation is OFF TRACK.
 *             The automation nudges pending tickets on business days only
 *             (Mon–Fri IST). Its posts are EXTERNAL messages, so they
 *             refresh tnt__last_devu_message_ts. Rules (Rohan 2026-08-04):
 *               · first/second reminder tag + last touch within 3 BUSINESS
 *                 days → on track, never shown; flag from the 4th.
 *               · no reminder tag → flag after 4 business days of silence
 *                 (first follow-up was due at 3, +1 grace).
 *               · final reminder tag → flag after 2 business days ("close
 *                 the ticket" — nothing more is coming).
 *               · customer replied >1 day ago, still pending → flag.
 *             Reminder tags only pick the threshold and wording — they
 *             never hide a ticket (tags are sticky; timestamps stay the
 *             truth, team decision 2026-08-02).
 *   onHold  — no org-side external message on the main ticket in the last
 *             2 days. Same "our side went quiet" principle: even with
 *             engineering actively working the linked ISS, the customer
 *             must hear from us every 2 days.
 *
 * TIMESTAMP SOURCES (streamed per-page from DevRev at build time, filtered
 * to the due members only — the full active cache is never parsed here):
 *   tnt__last_devu_message_ts — last org-side EXTERNAL message (agent reply
 *     or workflow bot post; internal notes do NOT move it).
 *   tnt__last_revu_message_ts — last customer message.
 *
 * ── WHERE THE CODE LIVES ────────────────────────────────────────────────
 * Modules are listed in dependency order; each one may only import from
 * those above it, which is what keeps this feature acyclic.
 *
 *   config.js        thresholds, reminder tags, per-shift timing table
 *   time.js          IST calendar math (every decision here is IST-relative)
 *   roster.js        who is on shift, and when it ends
 *   ticketFields.js  reading DevRev fields; is a pending ticket off-track?
 *   rules.js         THE RULE ENGINE — evaluateTicket / buildItems
 *   tracking.js      has the member acknowledged this today? (remark OR note)
 *   slack.js         delivery via n8n + the exact message wording
 *   queueBuilder.js  assembling one member's queue from live tickets
 *   verification.js  re-checking against DevRev before a queue may clear
 *   alerts.js        shift-end summary + next-day "no action" escalation
 *   sweep.js         the repeatable job entry point + dashboard queries
 *
 * Changing a RULE means editing rules.js or config.js — never the sweep.
 * Changing WORDING means slack.js only.
 */

// ── Public surface ───────────────────────────────────────────────────────
// Exactly the 14 symbols services/attentionService.js used to export, so
// every existing import keeps working. Prefer importing from the specific
// module above when adding new code.

export { ATTENTION_RULES } from "./config.js";
export { evaluateTicket, buildItems } from "./rules.js";
export { fetchRosterShifts } from "./roster.js";
export { hasDevRevInternalNote } from "./tracking.js";
export {
  postSlack,
  postAlert,
  memberSummaryLine,
  shiftEndSummaryMessage,
  noActionMessage,
} from "./slack.js";
export { verifyAndClearQueue } from "./verification.js";
export { runAttentionSweep, getQueueForEmail, getQueuesForMembers } from "./sweep.js";
