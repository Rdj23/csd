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
 * is to actually action the tickets. "Tracked" (remarked) items are a
 * one-day snooze: the remark only counts on the queue's own IST day, so a
 * still-blocked ticket lands back in its bucket at the next build (we
 * don't want people to track-and-forget). Uncleared queues get exactly ONE
 * "no action" follow-up at a fixed time after the member's next shift
 * starts — no hourly repeats (Rohan 2026-08-08: repeats read as spam).
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
 */

import axios from "axios";
import { redisGet, redisSet } from "../config/database.js";
import {
  resolveOwnerName,
  EMAIL_TO_NAME_MAP,
  GST_MEMBERS,
  SHIFT_HOURS,
  isSolvedStatus,
} from "../config/constants.js";
import { bucketForStage } from "./reconcileService.js";
import { streamActiveFromDevRev, trimTicket } from "./syncService.js";
import { findGSTMember } from "./slackService.js";
import { fetchWorkItem, fetchTimelineEntries } from "./devrevApi.js";
import { AttentionQueue, Remark } from "../models/index.js";
import { publishSocketEvent } from "../lib/pubsub.js";
import logger from "../config/logger.js";

// ── Tunables ─────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

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
const ATTENTION_TIMING = {
  "SHIFT 1": { queueAt: 15.75, slackAt: 16.25, escalateAt: 8.75,  escalateNextDay: true },  // 3:45 PM / 4:15 PM → 8:45 AM
  "SHIFT 2": { queueAt: 18.75, slackAt: 19.25, escalateAt: 11.25, escalateNextDay: true },  // 6:45 PM / 7:15 PM → 11:15 AM
  "SHIFT 3": { queueAt: 21.25, slackAt: 21.75, escalateAt: 14.5,  escalateNextDay: true },  // 9:15 PM / 9:45 PM → 2:30 PM
  "SHIFT 4": { queueAt: 6.0,   slackAt: 6.75,  escalateAt: 23.25, escalateNextDay: false }, // 6:00 AM / 6:45 AM → 11:15 PM same day
};

const BUILD_WINDOW_MS = 30 * 60 * 1000;      // late-tick tolerance after queueAt

// Tags the DevRev auto-reminder workflow sets (compared lowercased). The
// final tag's exact DevRev name is unconfirmed — match plausible variants.
// OPEN bucket: any reminder tag exempts the ticket (automation owns it,
// original spec). PENDING bucket: tags NEVER gate — they only choose the
// overdue threshold + reason wording, because tags are sticky (they survive
// the conversation resuming; team decision 2026-08-02). Worst case a stale
// tag flags one business day early — it can never hide a silent ticket.
const FIRST_REMINDER_TAGS = new Set(["first-reminder-sent", "first reminder sent"]);
const SECOND_REMINDER_TAGS = new Set(["second-reminder-sent", "second reminder sent"]);
const FINAL_REMINDER_TAGS = new Set([
  "third-reminder-sent", "third reminder sent", "3rd reminder sent",
  "final-reminder-sent", "final reminder sent",
]);
const REMINDER_TAGS = new Set([
  ...FIRST_REMINDER_TAGS, ...SECOND_REMINDER_TAGS, ...FINAL_REMINDER_TAGS,
]);
const TICKET_URL = (id) => `https://app.devrev.ai/clevertapsupport/works/${id}`;

// ── IST time helpers ─────────────────────────────────────────────────────
// All shift math is done on epoch ms anchored to IST calendar days, so the
// server's own timezone never matters.

/** "YYYY-MM-DD" for a Date, in IST. */
const istYmd = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/** Instant for `decimalHours` (7.5 = 07:30 IST) on an IST calendar day. */
const istInstant = (ymd, decimalHours) =>
  new Date(new Date(`${ymd}T00:00:00+05:30`).getTime() + decimalHours * 3600 * 1000);

const istTodayStartMs = () => new Date(`${istYmd()}T00:00:00+05:30`).getTime();

const ms = (v) => (v ? new Date(v).getTime() : null);
const daysAgo = (tsMs, nowMs) => Math.floor((nowMs - tsMs) / DAY_MS);

const istWeekday = (tsMs) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(new Date(tsMs));

/**
 * Whole business days (Mon–Fri, IST calendar) elapsed from `fromMs` to
 * `nowMs`. Fri→Mon = 1: the weekend doesn't count, which is what keeps a
 * follow-up that legitimately slips over a weekend from flagging.
 */
const businessDaysSince = (fromMs, nowMs) => {
  let count = 0;
  // Noon-IST anchor so the day-stepping loop can't straddle a midnight edge.
  let d = new Date(`${istYmd(new Date(fromMs))}T12:00:00+05:30`).getTime();
  const endYmd = istYmd(new Date(nowMs));
  while (istYmd(new Date(d)) < endYmd) {
    d += DAY_MS;
    const wd = istWeekday(d);
    if (wd !== "Sat" && wd !== "Sun") count++;
    if (count > 30) break; // ancient ticket — precision past a month is pointless
  }
  return count;
};

// ── Ticket field accessors ───────────────────────────────────────────────
const lastAgentExternalMs = (t) => ms(t.custom_fields?.tnt__last_devu_message_ts);
const lastCustomerMs = (t) => ms(t.custom_fields?.tnt__last_revu_message_ts);
const hasTagIn = (t, tagSet) =>
  (t.tags || []).some((tag) =>
    tagSet.has((tag.tag?.name || "").toLowerCase().trim()),
  );
const hasReminderTag = (t) => hasTagIn(t, REMINDER_TAGS);

/**
 * True last outbound EXTERNAL touch from the ticket timeline: agent replies
 * (dev_user) AND the follow-up automation (service_account / sys_user).
 * Needed because tnt__last_devu_message_ts only tracks dev_user comments —
 * the reminder bot posts as service_account and moves NOTHING (proven on
 * TKT-319891 / TKT-320229 / TKT-319953, 2026-08-04). Costs 1+ API calls per
 * ticket, so it runs only for reminder-tagged tickets that would otherwise
 * flag (the ambiguous cases). Returns epoch ms or null.
 */
const ORG_AUTHOR_TYPES = new Set(["dev_user", "service_account", "sys_user"]);
const lastOutboundExternalMs = async (ticketDon) => {
  let cursor = null,
    latest = null,
    pages = 0;
  do {
    const { entries, nextCursor } = await fetchTimelineEntries(ticketDon, { cursor, limit: 100 });
    for (const e of entries) {
      if (e.type !== "timeline_comment") continue;
      if ((e.visibility || "internal") === "internal") continue;
      if (!ORG_AUTHOR_TYPES.has(e.created_by?.type)) continue;
      const t = ms(e.created_date);
      if (t && (!latest || t > latest)) latest = t;
    }
    cursor = nextCursor;
  } while (cursor && ++pages < 10);
  return latest;
};

/**
 * Automated follow-up fingerprint, straight off the work object (per Rohan
 * 2026-08-04, TKT-320148): when the Email Integration Bot was the LAST
 * modifier, modified_date IS the last follow-up time. Free — no API call.
 * Works on raw and enriched-trimmed shapes.
 */
const EMAIL_BOT_RE = /email integration bot/i;
const botFollowUpMs = (t) => {
  const type = t.modified_by?.type || t.modified_by_type;
  const name = t.modified_by?.display_name || t.modified_by_name;
  if (type === "service_account" && EMAIL_BOT_RE.test(name || "")) return ms(t.modified_date);
  return null;
};

/** A service account touched the ticket recently — bot activity may be
 *  hiding under it (e.g. a workflow overwrote the email bot's fingerprint,
 *  TKT-319953), so the timeline must decide. */
const recentServiceAccountTouch = (t, nowMs) => {
  const type = t.modified_by?.type || t.modified_by_type;
  if (type !== "service_account" || !t.modified_date) return false;
  return businessDaysSince(ms(t.modified_date), nowMs) <= ATTENTION_RULES.PENDING_REMINDER_QUIET_BD;
};

/**
 * SYNC pre-verdict for the pending bucket, shared by build and verify.
 * Returns null (fine) or { reason, timelineCheck }. The cheap exclusion is
 * Rohan's rule verbatim: last automated follow-up (Email Integration Bot
 * via modified_by) within 3 business days → not in the alert. timelineCheck
 * marks the ambiguous flagged cases resolvePendingBlock() must confirm.
 */
const pendingPreVerdict = (t, nowMs) => {
  const base = Math.max(lastAgentExternalMs(t) || 0, botFollowUpMs(t) || 0);
  const la = base || ms(t.created_date);
  const lc = lastCustomerMs(t);
  const tagged = hasReminderTag(t);

  // Customer spoke last (even counting the bot's follow-ups) and the ticket
  // still sits in pending — we owe them a reply.
  if (lc && la && lc > la) {
    if (nowMs - lc < ATTENTION_RULES.PENDING_CUSTOMER_REPLY_GRACE_MS) return null;
    return {
      reason: `Customer replied ${daysAgo(lc, nowMs)}d ago and is still waiting on us`,
      timelineCheck: tagged || recentServiceAccountTouch(t, nowMs),
    };
  }
  if (!la) return null;

  const bd = businessDaysSince(la, nowMs);
  const { PENDING_FIRST_FOLLOWUP_BD, PENDING_REMINDER_QUIET_BD, PENDING_GRACE_BD } = ATTENTION_RULES;

  if (tagged) {
    // Reminder cycle running. Within the quiet window = automation on track.
    if (bd <= PENDING_REMINDER_QUIET_BD) return null;
    const tier = hasTagIn(t, FINAL_REMINDER_TAGS)
      ? "Final reminder cycle"
      : hasTagIn(t, SECOND_REMINDER_TAGS)
        ? "Second reminder sent"
        : "First reminder sent";
    return { reason: `${tier} — no outbound touch in ${daysAgo(la, nowMs)}d, automation may be stuck`, timelineCheck: true };
  }

  if (bd < PENDING_FIRST_FOLLOWUP_BD + PENDING_GRACE_BD) return null;
  return {
    reason: `Pending ${daysAgo(la, nowMs)}d with no follow-up sent — automation never fired, nudge manually`,
    timelineCheck: recentServiceAccountTouch(t, nowMs),
  };
};

/**
 * ASYNC final verdict: confirms a timelineCheck pre-verdict against the real
 * timeline. Quiet window: an outbound touch (agent OR bot) within the last
 * 3 business days = automation on track, no alert (Rohan 2026-08-04). On
 * timeline API failure we keep the alert (fail-open) — verify clears later.
 */
const resolvePendingBlock = async (t, pre, nowMs) => {
  if (!pre) return null;
  if (!pre.timelineCheck) return pre.reason;

  let touch = null;
  try {
    touch = await lastOutboundExternalMs(t.id);
  } catch (e) {
    logger.warn({ err: e.message, ticket: t.display_id }, "Attention: timeline check failed — keeping alert");
    return pre.reason;
  }

  const eff = Math.max(touch || 0, botFollowUpMs(t) || 0, lastAgentExternalMs(t) || 0, ms(t.created_date) || 0);
  if (!eff) return pre.reason;
  const lc = lastCustomerMs(t);
  if (lc && lc > eff) {
    if (nowMs - lc < ATTENTION_RULES.PENDING_CUSTOMER_REPLY_GRACE_MS) return null;
    return `Customer replied ${daysAgo(lc, nowMs)}d ago and is still waiting on us`;
  }
  const bd = businessDaysSince(eff, nowMs);
  if (bd <= ATTENTION_RULES.PENDING_REMINDER_QUIET_BD) return null; // bot touched recently — on track
  if (hasTagIn(t, FINAL_REMINDER_TAGS)) {
    return `Final reminder went out ${daysAgo(eff, nowMs)}d ago with no reply — close the ticket`;
  }
  return `Last follow-up went out ${daysAgo(eff, nowMs)}d ago — next reminder is overdue, automation may be stuck`;
};

// ── Rule engine ──────────────────────────────────────────────────────────
// Pure per-ticket evaluation. Used by BOTH the queue builder and the
// verify-and-clear path so the two can never disagree (the classic
// "KPI changes but expand shows all" bug class in this codebase).

/**
 * Evaluate one cached/live ticket against the attention rules.
 * @returns {Object|null} { bucket, rule, reason, needsIssCheck } or null.
 * onHold results have needsIssCheck: true — the linked-ISS age condition
 * requires a DevRev links walk that the caller performs (and may reuse a
 * stored ISS date for, on re-verification).
 */
export const evaluateTicket = (t, nowMs = Date.now()) => {
  const stageName = t.stage?.name;
  if (isSolvedStatus(stageName)) return null;
  const bucket = bucketForStage(stageName);
  const createdMs = ms(t.created_date);

  if (bucket === "open") {
    if (hasReminderTag(t)) return null; // DevRev reminder automation owns it
    if (!createdMs || nowMs - createdMs < ATTENTION_RULES.OPEN_MIN_AGE_DAYS * DAY_MS) return null;
    const la = lastAgentExternalMs(t);
    if (la && la >= istTodayStartMs()) return null; // already replied today
    return {
      bucket,
      rule: "open-aging",
      reason: `Open for ${daysAgo(createdMs, nowMs)}d and no reply to the customer today`,
      needsIssCheck: false,
    };
  }

  if (bucket === "pending") {
    // Awaiting customer — flags only when the follow-up automation is off
    // track (never started / stalled / exhausted) or a customer reply was
    // left hanging. needsTimelineCheck verdicts are TENTATIVE — the caller
    // must confirm via resolvePendingBlock(): the reminder bot posts as
    // service_account and is invisible to the cheap ts fields.
    const pre = pendingPreVerdict(t, nowMs);
    if (!pre) return null;
    return {
      bucket,
      rule: "pending-silent",
      reason: pre.reason,
      needsIssCheck: false,
      needsTimelineCheck: !!pre.timelineCheck,
    };
  }

  if (bucket === "onHold") {
    // Waiting on CleverTap — even if the linked ISS is being worked, the
    // customer must hear from us every 2 days. Pure silence rule; the linked
    // ISS's age does not matter.
    const la = lastAgentExternalMs(t) ?? createdMs;
    if (!la || nowMs - la < ATTENTION_RULES.ONHOLD_AGENT_SILENCE_DAYS * DAY_MS) return null;
    return {
      bucket,
      rule: "onhold-stale",
      reason: `Customer hasn't heard from us in ${daysAgo(la, nowMs)}d`,
    };
  }

  return null; // "other" stages (New, queued, Waiting on CSM…) are out of scope
};

/**
 * Build queue items for a member's active tickets. Runs entirely off the
 * cached ticket objects — no DevRev calls needed at build time.
 */
export const buildItems = async (tickets, nowMs = Date.now()) => {
  const items = [];
  for (const t of tickets) {
    const verdict = evaluateTicket(t, nowMs);
    if (!verdict) continue;

    // Tentative pending verdicts must survive the timeline confirmation —
    // a recent bot follow-up (invisible to the cheap fields) drops them here.
    if (verdict.needsTimelineCheck) {
      const confirmed = await resolvePendingBlock(t, { reason: verdict.reason, timelineCheck: true }, nowMs);
      if (!confirmed) continue;
      verdict.reason = confirmed;
    }

    const item = {
      display_id: t.display_id,
      ticket_id: t.id || null, // DON id — RemarkPopover needs it for DevRev comment sync
      title: t.title,
      account: t.account?.display_name || t.account || null,
      severity: t.severity?.name || t.severity || null,
      bucket: verdict.bucket,
      rule: verdict.rule,
      reason: verdict.reason,
      created_date: t.created_date ? new Date(t.created_date) : null,
      last_agent_external_ts: t.custom_fields?.tnt__last_devu_message_ts || null,
      last_customer_ts: t.custom_fields?.tnt__last_revu_message_ts || null,
      status: "pending",
    };

    items.push(item);
  }
  // Longest silence first: the ticket whose customer has waited longest for
  // ANY outbound word from us sits on top (per Rohan 2026-08-03).
  items.sort((a, b) => {
    const ka = new Date(a.last_agent_external_ts || a.created_date || 0).getTime();
    const kb = new Date(b.last_agent_external_ts || b.created_date || 0).getTime();
    return ka - kb;
  });
  return items;
};

// ── Roster API client ────────────────────────────────────────────────────
// Reads shift assignments from the GST Hub roster API. Only four fields are
// consumed: email, engineer_name, shift, slack_id. `shift` doubles as an
// off-status ("Week Off", "EL"…) — anything not in SHIFT_HOURS is treated as
// "not working" and skipped, which gives leave-awareness for free.

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

// ── Slack (via n8n) ──────────────────────────────────────────────────────
// ALL attention alerts route through one n8n webhook (Rohan 2026-08-05):
// n8n posts with a real Slack bot, which is what gives us THREADS — the
// next-day "no action" alert must reply under the shift-end summary, and
// incoming webhooks can't do that (no thread_ts, no ts back). n8n also owns
// the channel choice, so switching test → production channel is an n8n edit,
// zero backend changes. Contract (see docs/ATTENTION_N8N_SETUP.md):
//   POST ATTENTION_N8N_WEBHOOK_URL
//     { kind, text, thread_ts }   kind: shift_end_summary | no_action_followup | queue_cleared
//   ← { ts: "<slack message ts>" }   (the summary's ts anchors the thread)
// Fallback: plain incoming webhook (ATTENTION_SLACK_WEBHOOK_URL) — posts
// fine but can't thread and returns no ts.

const attentionWebhook = () => process.env.ATTENTION_SLACK_WEBHOOK_URL;

// Mentions are ON by default (official workspace, Rohan 2026-08-08). Set
// ATTENTION_SLACK_MENTIONS=false only in a test workspace, where the
// roster's slack_ids don't resolve and would render as blank.
const useMentions = () => process.env.ATTENTION_SLACK_MENTIONS !== "false";

// Who a message addresses: the roster slack_id stored on the queue doc at
// build time, else the GST_SLACK_MEMBER_IDS constants map (covers queues
// built before the roster carried a slack_id), else the plain bold name —
// an alert must never go out addressed to nobody.
const memberMention = (queue) =>
  (useMentions() && (queue.slack_id || findGSTMember(queue.member))) || `*${queue.member}*`;

export const postSlack = async (text) => {
  const url = attentionWebhook();
  if (!url) {
    logger.warn("ATTENTION_SLACK_WEBHOOK_URL not set — skipping Slack post");
    return false;
  }
  try {
    await axios.post(url, { text }, { timeout: 15000 });
    return true;
  } catch (e) {
    logger.error({ err: e.message }, "Attention Slack post failed");
    return false;
  }
};

/**
 * The single exit point for every attention alert. Sends through n8n when
 * ATTENTION_N8N_WEBHOOK_URL is set; otherwise the plain incoming webhook.
 * @returns {{ok: boolean, ts: string|null}} ts = Slack message ts from n8n
 *   (null on the webhook fallback — thread replies then post to the channel).
 */
export const postAlert = async ({ kind, text, threadTs = null }) => {
  const n8n = process.env.ATTENTION_N8N_WEBHOOK_URL;
  if (n8n) {
    try {
      const res = await axios.post(
        n8n,
        { kind, text, thread_ts: threadTs || null },
        { timeout: 20000 },
      );
      return { ok: true, ts: res.data?.ts || res.data?.message_ts || null };
    } catch (e) {
      logger.error({ err: e.message, kind }, "Attention n8n post failed — falling back to incoming webhook");
    }
  }
  return { ok: await postSlack(text), ts: null };
};

const BUCKET_LABELS = { open: "Open", pending: "Pending", onHold: "On Hold" };
const BUCKET_WORDS = { open: "open", pending: "pending", onHold: "on hold" };

/**
 * One bullet of the shift-end summary. Counts only, NO ticket metadata —
 * the full list lives on the dashboard (Rohan 2026-08-05). Variants:
 *   nothing at all        → congratulations
 *   only tracked items    → "N being tracked — action them tomorrow"
 *   actionable items left → "you have X open, Y pending, Z on hold — update those"
 */
export const memberSummaryLine = (queue, mention = null) => {
  const who = mention || memberMention(queue);
  const items = queue.items || [];
  const actionable = items.filter((i) => i.status === "pending");
  const tracked = items.filter((i) => i.status === "partial").length;

  if (!actionable.length && !tracked) {
    return `• 🎉 ${who} — congratulations, no tickets to be worked on!`;
  }
  if (!actionable.length) {
    return `• 👏 ${who} — nothing to action, but *${tracked} ticket${tracked === 1 ? " is" : "s are"} being tracked* — make sure to action them tomorrow when you start your shift.`;
  }
  const counts = ["open", "pending", "onHold"]
    .map((b) => ({ b, n: actionable.filter((i) => i.bucket === b).length }))
    .filter((c) => c.n)
    .map((c) => `*${c.n} ${BUCKET_WORDS[c.b]}*`);
  return (
    `• ⏰ Hey ${who} — you have ${counts.join(", ")} case${actionable.length === 1 ? "" : "s"} to work on. Please update those.` +
    (tracked ? ` _(+${tracked} tracked)_` : "")
  );
};

/**
 * The batched shift-end message: one Slack post per shift trigger, one line
 * per member ("if 4 users, a 4-point list"). Its Slack ts anchors the thread
 * the next-day "no action" alerts reply into.
 */
export const shiftEndSummaryMessage = (queues) => {
  const [q] = queues;
  return [
    `📋 *Shift-end check — ${q.shift}${q.shift_date ? ` · ${q.shift_date}` : ""}*`,
    ...queues.map((queue) => memberSummaryLine(queue)),
  ].join("\n");
};

/**
 * Next-day "no action" thread reply: bare clickable ticket IDs, stage-wise,
 * nothing else. Includes TRACKED items — a remark snoozes same-day alerts,
 * but a ticket still violating its rule the next morning gets listed anyway
 * (Rohan 2026-08-03/05).
 */
export const noActionMessage = (queue) => {
  const who = memberMention(queue);
  const rows = queue.items.filter((i) => i.status === "pending" || i.status === "partial");
  const lines = [`${who} — *no action* on the tickets below, please update them:`];
  for (const bucket of ["open", "pending", "onHold"]) {
    const ids = rows
      .filter((i) => i.bucket === bucket)
      .map((i) => `<${TICKET_URL(i.display_id)}|${i.display_id}>`);
    if (ids.length) lines.push(`•  *${BUCKET_LABELS[bucket]} (${ids.length}):*  ${ids.join(", ")}`);
  }
  return lines.join("\n");
};

// ── Queue building ───────────────────────────────────────────────────────

/**
 * Members' active tickets — live from DevRev (streamed, due-members only),
 * Redis cache only as an outage fallback.
 *
 * GUARD (bug 2026-08-02, twice): a sweep with no ticket source would build
 * EMPTY queues ("Superstar!" for someone with 20+ aging tickets) and wedge
 * the member's day. So when BOTH DevRev and the cache are unavailable:
 *   - cron run  → throw (BullMQ retries, and the 30-min build window means
 *     a later 15-min sweep still covers it)
 *   - force run → fall back to the partial sync keys so demos still work
 *   - everything empty → always throw, never build
 */
const activeTicketsByMember = async ({ allowPartial = false, onlyMembers = null } = {}) => {
  // PRIMARY PATH: live page-by-page stream from DevRev, keeping ONLY the due
  // members' tickets (trimmed to the cache shape). The sweep no longer
  // touches the 20-60MB tickets:active blob at all — we already know who is
  // due from the roster, so we never need every ticket at once. This also
  // decouples queue builds from the hourly sync: queue times (16:00, 19:00)
  // sit exactly on the hour, and a full-blob parse stacked on a running sync
  // in the same 512MB process is what OOM-killed shift 1/2 builds.
  try {
    const byMember = new Map();
    await streamActiveFromDevRev(async (works) => {
      for (const t of works) {
        if (isSolvedStatus(t.stage?.name)) continue;
        const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
        if (!owner) continue;
        if (onlyMembers && !onlyMembers.has(owner)) continue;
        if (!byMember.has(owner)) byMember.set(owner, []);
        // Enriched trim: modified_by identifies the Email Integration Bot's
        // follow-up fingerprint (botFollowUpMs) — the plain cache trim
        // doesn't carry it, and cache-fallback tickets simply skip that
        // cheap exclusion and rely on the timeline check instead.
        byMember.get(owner).push({
          ...trimTicket(t),
          modified_by_type: t.modified_by?.type || null,
          modified_by_name: t.modified_by?.display_name || null,
        });
      }
    });
    return byMember;
  } catch (e) {
    logger.warn({ err: e.message }, "Attention sweep: live DevRev stream failed — falling back to Redis cache");
  }

  // FALLBACK (DevRev unreachable): the old cache path. Parses the full blob,
  // so it only runs on DevRev outages — rare by construction.
  let cached = (await redisGet("tickets:active")) || [];
  if (!cached.length) {
    if (!allowPartial) {
      throw new Error("Attention sweep: DevRev unreachable and tickets:active cache empty — retry later");
    }
    cached = (await redisGet("tickets:syncing")) || (await redisGet("tickets:active:initial")) || [];
    if (!cached.length) {
      throw new Error("Attention sweep: no ticket source available at all — retry later");
    }
    logger.warn({ count: cached.length }, "Attention sweep: using PARTIAL ticket cache (forced run during sync)");
  }
  const byMember = new Map();
  for (const t of cached) {
    if (isSolvedStatus(t.stage?.name)) continue;
    const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
    if (!owner) continue;
    if (onlyMembers && !onlyMembers.has(owner)) continue;
    if (!byMember.has(owner)) byMember.set(owner, []);
    byMember.get(owner).push(t);
  }
  return byMember;
};

/**
 * First-escalation instant for a queue built today, from ATTENTION_TIMING —
 * derived locally, NOT from the roster API (which serves today only).
 * Same IST day for the overnight SHIFT 4 (queue posts 05:30 and the
 * member's next shift starts the same evening — this fixes the old
 * "tomorrow at shift start" bug that made SHIFT 4 escalations a day late);
 * next day for the day shifts.
 */
const escalationInstant = (shift, fromMs) => {
  const t = ATTENTION_TIMING[shift];
  if (!t) return null; // "MANUAL" test queues get no escalation clock
  const day = t.escalateNextDay ? new Date(fromMs + DAY_MS) : new Date(fromMs);
  return istInstant(istYmd(day), t.escalateAt);
};

/**
 * Tickets the member marked "tracked" for a given queue day: display_ids with
 * a dashboard remark added ON the queue's IST calendar day (>= day start).
 * The day anchor — not the queue's created_at — is the whole trick:
 *   - remarks added any time during TODAY's shift count, even though the
 *     queue itself only builds ~45 min before shift end;
 *   - yesterday's remarks DON'T count for today's queue, so a still-blocked
 *     ticket lands back in open/pending/onHold at the next build. Tracking
 *     is a one-day snooze, never a permanent hiding place (Rohan 2026-08-05).
 * Known boundary: SHIFT 4 remarks made before midnight (first ~1.5h of the
 * overnight shift) don't count for the morning queue — accepted for v1.
 */
const trackedRemarkIds = async (displayIds, shiftDate) => {
  if (!displayIds.length) return new Set();
  try {
    const dayStart = new Date(`${shiftDate}T00:00:00+05:30`);
    const remarks = await Remark.find(
      { ticketId: { $in: displayIds }, timestamp: { $gte: dayStart } },
      { ticketId: 1 },
    ).lean();
    return new Set(remarks.map((r) => r.ticketId));
  } catch (e) {
    logger.warn({ err: e.message }, "Attention: remark lookup failed — treating none as tracked");
    return new Set();
  }
};

/**
 * Did a GST engineer leave an INTERNAL comment on this ticket in DevRev during
 * the queue's IST day?
 *
 * WHY THIS EXISTS ALONGSIDE trackedRemarkIds():
 * trackedRemarkIds only sees the `Remark` collection — notes typed into OUR
 * dashboard. But an engineer who opens the ticket in DevRev and adds an
 * internal note there has done exactly the same thing: recorded that they are
 * on it. Before this, that work was invisible to the queue and the member kept
 * getting alerted for a ticket they had demonstrably picked up. Same day-anchor
 * as trackedRemarkIds, so the two sources behave identically: today's notes
 * count, yesterday's never carry over.
 *
 * VISIBILITY IS THE POINT: only `internal` comments mark TRACKING. An external
 * reply is a real customer action and clears the item outright via
 * itemStillBlocked — routing it here would downgrade a full clear to "tracked".
 *
 * Bounded to TIMELINE_PAGE_CAP pages and short-circuits on the first match, so
 * a long-running ticket can't turn one verify into an unbounded crawl. Failures
 * return false: the item stays pending, which is the safe direction (an extra
 * nudge beats silently dropping a real one).
 */
const TIMELINE_PAGE_CAP = 5;

const hasDevRevInternalNote = async (ticketDonId, shiftDate) => {
  if (!ticketDonId) return false;
  const dayStartMs = new Date(`${shiftDate}T00:00:00+05:30`).getTime();
  let cursor = null;
  let pages = 0;
  try {
    do {
      const { entries, nextCursor } = await fetchTimelineEntries(ticketDonId, { cursor, limit: 100 });
      for (const e of entries) {
        if (e.type !== "timeline_comment") continue;
        if (e.visibility !== "internal") continue;
        if (e.created_by?.type !== "dev_user") continue;
        if (new Date(e.created_date).getTime() >= dayStartMs) return true;
      }
      cursor = nextCursor;
      pages++;
    } while (cursor && pages < TIMELINE_PAGE_CAP);
  } catch (e) {
    logger.warn({ err: e.message, ticket: ticketDonId }, "Attention: DevRev internal-note check failed");
    return false;
  }
  return false;
};

const buildQueueForMember = async (candidate, ticketsByMember, nowMs) => {
  const tickets = ticketsByMember.get(candidate.name) || [];
  const items = await buildItems(tickets, nowMs);

  // Seed tracked state from remarks made earlier today — the member already
  // looked at these on the (always-visible) previous queue; don't re-alert.
  const remarked = await trackedRemarkIds(items.map((i) => i.display_id), candidate.shiftDate);
  for (const item of items) {
    if (remarked.has(item.display_id)) {
      item.status = "partial";
      item.partial_at = new Date(nowMs);
    }
  }
  const actionable = items.filter((i) => i.status === "pending").length;
  const status = items.length ? "pending" : "empty";

  const queue = await AttentionQueue.create({
    member: candidate.name,
    member_email: candidate.email,
    slack_id: candidate.slackMention,
    shift: candidate.shift,
    shift_date: candidate.shiftDate,
    shift_end_at: candidate.endAt,
    // Only truly-actionable items set the TL escalation clock — an
    // all-tracked queue never pages (tracked items re-flag tomorrow anyway).
    next_shift_start_at: actionable ? escalationInstant(candidate.shift, nowMs) : null,
    status,
    items,
    shift_alert_at: candidate.slackAt || null,
  });

  // Build = dashboard update ONLY. The Slack summary posts separately at
  // shift_alert_at (~15 min before shift end), from live item statuses.
  await publishSocketEvent("ATTENTION_QUEUE", {
    email: candidate.email,
    member: candidate.name,
    status,
    count: actionable,
    shiftDate: candidate.shiftDate,
  });

  logger.info(
    { member: candidate.name, items: items.length, tracked: items.length - actionable, status },
    "Attention queue built",
  );
  return queue;
};

// ── Verification ─────────────────────────────────────────────────────────
// An item clears only when live DevRev data shows the required action
// happened. Per rule:
//   open    — org-side external reply landed today, or the ticket left the
//             open bucket (incl. solved).
//   pending — pendingPreVerdict + resolvePendingBlock re-run on fresh data:
//             any outbound external touch (agent reply OR bot follow-up,
//             confirmed via the timeline) resets the clock, or the ticket
//             left the bucket.
//   onHold  — org-side external message within the 2-day window, or ticket
//             left the bucket.

const itemStillBlocked = async (item, fresh, queueCreatedMs, nowMs, queueMember = null) => {
  const stageName = fresh.stage?.name;
  if (isSolvedStatus(stageName)) return null;

  // REASSIGNED — the ticket is no longer this member's responsibility, so it
  // must leave their queue even though its stage never changed. Without this,
  // handing a ticket over left the original owner being nudged (and escalated
  // to their TL) for work that is now someone else's. Compared on the resolved
  // canonical name so a DevRev display_name variant isn't read as a handover.
  //
  // Only acts on a CONFIDENT read: an unresolvable owner (alias gap, unowned)
  // yields null from resolveOwnerName, and treating that as "reassigned" would
  // silently empty queues whenever the roster aliases drift.
  if (queueMember) {
    const freshOwner = resolveOwnerName(fresh.owned_by?.[0]?.display_name);
    if (freshOwner && freshOwner !== queueMember) return null;
  }

  const bucket = bucketForStage(stageName);
  if (bucket !== item.bucket) return null; // moved on — whatever they did worked
  const la = lastAgentExternalMs(fresh);

  if (item.bucket === "open") {
    if (hasReminderTag(fresh)) return null;
    if (la && la >= istTodayStartMs()) return null;
    return "Still no external reply to the customer today";
  }
  if (item.bucket === "pending") {
    return await resolvePendingBlock(fresh, pendingPreVerdict(fresh, nowMs), nowMs);
  }
  if (item.bucket === "onHold") {
    if (la && nowMs - la < ATTENTION_RULES.ONHOLD_AGENT_SILENCE_DAYS * DAY_MS) return null;
    return "Customer still hasn't heard from us in the last 2 days";
  }
  return null;
};

/**
 * Re-check every pending item of a queue against live DevRev and clear the
 * ones that were genuinely actioned. Marks the queue cleared (+ Slack) when
 * nothing is left. Returns the updated queue doc, or null if none pending.
 * @param {string} trigger "user" | "escalation"
 */
export const verifyAndClearQueue = async (memberName, trigger = "user") => {
  const queue = await AttentionQueue.findOne({ member: memberName, status: "pending" }).sort({ created_at: -1 });
  if (!queue) return null;

  const nowMs = Date.now();
  const queueCreatedMs = queue.created_at.getTime();

  // Partial-verify: a dashboard remark added on the queue's IST day means the
  // member is actively tracking the ticket. Such items stop alerting (Slack /
  // TL escalation) but stay visible for managers — only a real DevRev action
  // fully clears them. Day-anchored (not created_at-anchored) so remarks made
  // earlier in the shift count, and yesterday's remarks never carry over —
  // tracked tickets re-flag at the next build (Rohan 2026-08-05).
  const openIds = queue.items.filter((i) => i.status !== "cleared").map((i) => i.display_id);
  const remarkedIds = await trackedRemarkIds(openIds, queue.shift_date);

  for (const item of queue.items) {
    if (item.status === "cleared") continue;
    let fresh = null;
    try {
      fresh = await fetchWorkItem(item.display_id);
    } catch (e) {
      logger.warn({ err: e.message, ticket: item.display_id }, "Attention verify: live fetch failed");
    }
    if (!fresh) {
      // Can't verify → keep it pending rather than silently passing it.
      item.block_reason = "Could not verify against DevRev — try again";
      continue;
    }
    const blocked = await itemStillBlocked(item, fresh, queueCreatedMs, nowMs, queue.member);
    if (blocked) {
      item.block_reason = blocked;
      // Two independent signals that the member is tracking this ticket:
      // a note in OUR dashboard, or an internal comment they left in DevRev.
      // The DevRev lookup is a per-ticket API call, so it runs ONLY when the
      // cheap Mongo-backed remark check came up empty and the item would
      // otherwise alert — on a healthy queue that is zero extra calls.
      let tracked = remarkedIds.has(item.display_id);
      if (!tracked) {
        tracked = await hasDevRevInternalNote(item.ticket_id || fresh.id, queue.shift_date);
      }
      if (tracked) {
        if (item.status !== "partial") item.partial_at = new Date();
        item.status = "partial";
      } else {
        item.status = "pending"; // remark gone/expired → back to alerting
      }
    } else {
      item.status = "cleared";
      item.cleared_at = new Date();
      item.block_reason = null;
    }
  }

  // Clear rule (Rohan 2026-08-04): the queue is CLEAR when nothing actionable
  // is left in open/pending/onHold. "Tracked" (remark-tracked) items don't
  // block the clear — they stay visible on the dashboard's Tracked tab.
  const remaining = queue.items.filter((i) => i.status === "pending").length;
  if (remaining === 0 && queue.status === "pending") {
    queue.status = "cleared";
    queue.cleared_at = new Date();
    const trackedCount = queue.items.filter((i) => i.status === "partial").length;
    const clearedCount = queue.items.filter((i) => i.status === "cleared").length;
    // "Queue clear — superb!" goes to the CHANNEL whenever a queue clears,
    // any time of day (Rohan 2026-08-05). Two suppressions against noise:
    // while the shift-end summary is still ahead (it tells the same story
    // minutes later), and an all-tracked auto-clear (0 actioned — nothing
    // to congratulate; the tracked items were already announced).
    const alertStillAhead =
      queue.shift_alert_at && !queue.shift_alert_sent_at && queue.shift_alert_at.getTime() > nowMs;
    if (!alertStillAhead && clearedCount > 0) {
      const who = memberMention(queue);
      // Copy per Rohan 2026-08-08: tracked items get the "+n being tracked"
      // note; a fully-actioned queue (nothing tracked) gets the plain
      // "awesome job today" congratulations instead.
      const tickets = `*${clearedCount} ticket${clearedCount === 1 ? "" : "s"}* actioned`;
      const text = trackedCount
        ? `✅ Superb ${who} — attention queue cleared! ${tickets} (+${trackedCount} being tracked via remarks). 👏`
        : `✅ Superb ${who} — attention queue cleared! ${tickets} — you did an awesome job today. 👏`;
      await postAlert({ kind: "queue_cleared", text });
    }
  }
  await queue.save();

  await publishSocketEvent("ATTENTION_QUEUE_UPDATED", {
    email: queue.member_email,
    member: queue.member,
    status: queue.status,
    remaining,
    trigger,
  });
  return queue;
};

// ── Shift-end Slack summary ──────────────────────────────────────────────

// Post at most this long after the scheduled slackAt. Past it (service was
// down through the whole window) the shift is over — a "before your shift
// ends" ping would land mid-night; the queue still escalates tomorrow.
const ALERT_LATE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/**
 * Post the shift-end Slack summary for every queue whose slackAt has passed
 * and hasn't been messaged yet — ONE batched message per shift, one line per
 * member. Runs every sweep tick; `shift_alert_sent_at` makes it once-per-
 * queue. The returned Slack ts is stored on every queue in the batch as
 * `slack_thread_ts`, so each member's next-day "no action" alert can reply
 * in this exact thread. Counts reflect live item statuses, so anything
 * actioned or remark-tracked between build (T-45) and now has dropped out.
 */
const runShiftEndAlerts = async (nowMs) => {
  const due = await AttentionQueue.find({
    shift_alert_at: { $ne: null, $lte: new Date(nowMs) },
    shift_alert_sent_at: null,
  });
  if (!due.length) return;

  // Group by shift (+date, defensive) — everyone on the same trigger shares
  // one message. A late-recovered old window is skipped, not posted stale.
  const groups = new Map();
  for (const q of due) {
    if (nowMs - q.shift_alert_at.getTime() > ALERT_LATE_TOLERANCE_MS) {
      q.shift_alert_sent_at = new Date(nowMs);
      await q.save();
      logger.warn({ member: q.member, shiftDate: q.shift_date }, "Attention shift-end alert skipped — window long past");
      continue;
    }
    const key = `${q.shift}|${q.shift_date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  for (const queues of groups.values()) {
    try {
      const { ok, ts } = await postAlert({
        kind: "shift_end_summary",
        text: shiftEndSummaryMessage(queues),
      });
      if (!ok) continue; // post failed — next sweep tick retries the whole group
      for (const q of queues) {
        q.shift_alert_sent_at = new Date(nowMs);
        q.slack_thread_ts = ts;
        await q.save();
      }
      logger.info(
        { shift: queues[0].shift, members: queues.length, threaded: !!ts },
        "Attention shift-end summary sent",
      );
    } catch (e) {
      logger.error({ err: e, shift: queues[0]?.shift }, "Attention shift-end alert failed");
    }
  }
};

// ── Escalation (next-day "no action" thread reply) ──────────────────────
// Reworked 2026-08-05 (Rohan): at the per-shift escalation instant (e.g.
// 8:45 AM for shift 1 — ~45 min into the member's next shift) re-verify the
// queue against live DevRev; whatever still violates its rule gets posted as
// a minimal "no action" list — bare clickable ticket IDs, stage-wise,
// TRACKED included — as a REPLY IN THE SAME SLACK THREAD as that queue's
// shift-end summary. No TL cc, no reasons (the old verbose TL page).
// ONE-SHOT (Rohan 2026-08-08): fires exactly once per queue — hourly repeats
// read as spam. A successful post nulls next_shift_start_at, permanently
// removing the queue from the due-query; a FAILED post keeps the clock so
// the next 15-min sweep retries until one post lands.

const runEscalations = async (nowMs) => {
  // next_shift_start_at stores the exact escalation instant (per-shift
  // ATTENTION_TIMING) — due the moment it passes, nulled after the one post.
  const due = await AttentionQueue.find({
    status: "pending",
    next_shift_start_at: { $ne: null, $lte: new Date(nowMs) },
  });

  // One escalation per MEMBER, driven by their newest pending queue.
  // Older still-pending docs for the same member get their clock nulled —
  // their tickets re-flag into the newest build anyway, and without the
  // null they'd match the due-query on every sweep forever.
  const newestByMember = new Map();
  for (const q of due) {
    const prev = newestByMember.get(q.member);
    if (!prev || q.created_at > prev.created_at) newestByMember.set(q.member, q);
  }
  const superseded = due.filter((q) => newestByMember.get(q.member) !== q);
  if (superseded.length) {
    await AttentionQueue.updateMany(
      { _id: { $in: superseded.map((q) => q._id) } },
      { $set: { next_shift_start_at: null } },
    );
  }

  for (const q of newestByMember.values()) {
    // ONE-SHOT: a queue that already got its follow-up (e.g. under the old
    // hourly behaviour, before its clock was nulled) never fires again.
    if (q.escalation?.alert_count > 0) {
      q.next_shift_start_at = null;
      await q.save();
      continue;
    }

    // Deliberately NO leave-skip here (team decision 2026-08-02): the channel
    // is private and pings are personal, so an open queue still gets its one
    // follow-up on the member's day off — teammates can action the tickets,
    // and the auto-verify below silences it once they do.

    // Auto-verify first — never alert over work that was actually done but
    // not clicked through. This also refreshes which items still violate
    // their rule ("tickets that still satisfy the condition").
    const updated = await verifyAndClearQueue(q.member, "escalation");
    if (!updated || updated.status !== "pending") continue;

    // Actionable items decide WHETHER the alert fires (an all-tracked queue
    // auto-clears in verify and never reaches here) — but the list itself
    // includes tracked items too: still-violating is still-violating.
    const remaining = updated.items.filter((i) => i.status === "pending").length;
    if (remaining === 0) continue;

    const { ok } = await postAlert({
      kind: "no_action_followup",
      text: noActionMessage(updated),
      threadTs: updated.slack_thread_ts || null, // no ts (webhook fallback) → plain channel post
    });
    if (!ok) continue; // failed post keeps the clock — next 15-min sweep retries
    updated.escalation = {
      alert_count: (updated.escalation?.alert_count || 0) + 1,
      last_alert_at: new Date(nowMs),
    };
    // The one follow-up has been sent — retire this queue's escalation clock.
    updated.next_shift_start_at = null;
    await updated.save();
    logger.info(
      { member: q.member, remaining, threaded: !!updated.slack_thread_ts },
      "Attention no-action alert sent (one-shot)",
    );
  }
};

// ── The sweep (repeatable job entry point) ───────────────────────────────

/**
 * Runs every 15 minutes. Builds queues for members whose per-shift queue
 * time (ATTENTION_TIMING) has arrived — with a 30-min late-tick tolerance,
 * and once per member per shift-date (the unique index makes duplicate
 * builds impossible) — then posts due shift-end Slack summaries, then
 * processes escalations.
 *
 * @param {Object} opts
 * @param {boolean} opts.force  Build regardless of the queue window (testing).
 * @param {string}  opts.member Restrict to one canonical member name (testing).
 */
export const runAttentionSweep = async ({ force = false, member = null } = {}) => {
  const nowMs = Date.now();
  const todayYmd = istYmd();
  const roster = await fetchRosterShifts();

  // Candidate shifts for today, with per-shift queue times from
  // ATTENTION_TIMING. The roster API serves TODAY only, so the overnight
  // SHIFT 4 is handled from today's row: a member rostered SHIFT 4 today
  // gets their queue at 06:00 IST (near the morning end of the overnight
  // shift). Known boundary quirk, accepted for v1: on the FIRST day of a
  // shift-4 block the morning queue fires before their first night; the
  // morning after the LAST day is missed.
  const candidates = [];
  for (const r of roster) {
    const timing = ATTENTION_TIMING[r.shift];
    const hours = SHIFT_HOURS[r.shift];
    if (!timing || !hours) continue; // ON CALL / off statuses / unknown shifts
    candidates.push({
      ...r,
      shiftDate: todayYmd,
      queueAt: istInstant(todayYmd, timing.queueAt),
      slackAt: istInstant(todayYmd, timing.slackAt),
      endAt: istInstant(todayYmd, hours.end),
    });
  }

  // Force-testing for a member who isn't on a working shift today (demo on a
  // week-off day): synthesize a candidate. shift "MANUAL" has no SHIFT_HOURS
  // entry, so no escalation clock gets set for these test queues.
  if (force && member && !candidates.some((c) => c.name === member)) {
    const row = roster.find((r) => r.name === member);
    const email =
      row?.email ||
      Object.keys(EMAIL_TO_NAME_MAP).find((e) => EMAIL_TO_NAME_MAP[e] === member) ||
      null;
    candidates.push({
      name: member,
      email,
      shift: row?.shift && SHIFT_HOURS[row.shift] ? row.shift : "MANUAL",
      slackMention: row?.slackMention || findGSTMember(member),
      shiftDate: todayYmd,
      queueAt: new Date(nowMs),
      slackAt: new Date(nowMs), // test builds: Slack summary posts in the same sweep
      endAt: new Date(nowMs + BUILD_WINDOW_MS),
    });
  }

  // Decide who is actually due BEFORE touching the ticket cache. Parsing the
  // full tickets:active blob is by far the most expensive thing this job does
  // — this process is the API + every worker in 512MB, and recurring parses
  // OOM-killed the Render instance on 2026-08-03. 90+% of sweeps have nobody
  // in a build window and must not load the cache at all (escalations never
  // need it — they verify per-ticket against live DevRev).
  const due = [];
  for (const c of candidates) {
    if (member && c.name !== member) continue;
    const inWindow = nowMs >= c.queueAt.getTime() && nowMs <= c.queueAt.getTime() + BUILD_WINDOW_MS;
    if (!force && !inWindow) continue;

    // force + member = REPLACE any existing queue for today, so repeated
    // test runs actually rebuild (and a queue built against a cold/empty
    // ticket cache doesn't wedge the whole day). Cron runs still build at
    // most once per member per shift-date.
    if (force && member) {
      await AttentionQueue.deleteOne({ member: c.name, shift_date: c.shiftDate });
    } else {
      const exists = await AttentionQueue.findOne({ member: c.name, shift_date: c.shiftDate }, { _id: 1 }).lean();
      if (exists) continue;
    }
    due.push(c);
  }

  const built = [];
  if (due.length) {
    const ticketsByMember = await activeTicketsByMember({
      allowPartial: force,
      onlyMembers: new Set(due.map((c) => c.name)),
    });
    for (const c of due) {
      try {
        built.push(await buildQueueForMember(c, ticketsByMember, nowMs));
      } catch (e) {
        // Unique-index race between two sweeps is harmless; log everything else.
        if (e.code !== 11000) logger.error({ err: e, member: c.name }, "Attention queue build failed");
      }
    }
  }

  await runShiftEndAlerts(nowMs);
  await runEscalations(nowMs);

  // Auto-clear: once an hour (the :30-UTC tick — offset from the :00-UTC
  // hourly sync) re-verify every recent pending queue so a ticket the member
  // actioned in DevRev disappears within the hour, no Verify click needed.
  // Per-ticket live lookups only — small queues, no cache, no blob.
  const utcMinute = new Date(nowMs).getUTCMinutes();
  if (utcMinute >= 30 && utcMinute < 45) {
    const openQueues = await AttentionQueue.find(
      { status: "pending", created_at: { $gte: new Date(nowMs - 2 * DAY_MS) } },
      { member: 1 },
    ).lean();
    for (const q of openQueues) {
      try {
        await verifyAndClearQueue(q.member, "auto");
      } catch (e) {
        logger.warn({ err: e.message, member: q.member }, "Attention auto-verify failed");
      }
    }
    if (openQueues.length) logger.info({ queues: openQueues.length }, "Attention auto-verify pass done");
  }

  logger.info({ candidates: candidates.length, built: built.length }, "Attention sweep done");
  return { built: built.map((q) => ({ member: q.member, status: q.status, items: q.items.length })) };
};

/** Latest queue for a member (any status) — powers the dashboard panel. */
export const getQueueForEmail = async (email) => {
  const member = EMAIL_TO_NAME_MAP[(email || "").toLowerCase()];
  if (!member) return { member: null, queue: null };
  const queue = await AttentionQueue.findOne({ member }).sort({ created_at: -1 }).lean();
  return { member, queue };
};

/**
 * LATEST queue per member, in one round-trip — powers the team panel.
 * Deliberately NOT today-scoped (changed 2026-08-05, was istYmd()-only):
 * queues build ~45 min before shift END, so for most of the day a member's
 * newest queue is yesterday's — and Rohan wants a list on screen ALL the
 * time to work from, replaced in place when the new build lands. The old
 * today-scoping made every shift-1/2/3 member read "No queue yet" until
 * late in their shift (only the 06:00-built SHIFT 4 queues showed).
 * The 7-day lookback keeps long-leave members from surfacing an ancient
 * queue as if it were current (the Nikita-bug concern) — the card shows
 * the queue's shift_date either way.
 */
const RAIL_LOOKBACK_DAYS = 7;
export const getQueuesForMembers = async (members) => {
  if (!members?.length) return [];
  const cutoffYmd = istYmd(new Date(Date.now() - RAIL_LOOKBACK_DAYS * DAY_MS));
  const docs = await AttentionQueue.aggregate([
    // shift_date is "YYYY-MM-DD" — lexicographic $gte is date order.
    { $match: { member: { $in: members }, shift_date: { $gte: cutoffYmd } } },
    { $sort: { shift_date: -1, created_at: -1 } },
    { $group: { _id: "$member", doc: { $first: "$$ROOT" } } },
  ]);
  const byMember = new Map(docs.map((d) => [d._id, d.doc]));
  return members.map((m) => ({ member: m, queue: byMember.get(m) || null }));
};
