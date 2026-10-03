/**
 * attention/ticketFields — Reading DevRev ticket fields + deciding whether a pending ticket is off-track.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import logger from "../../config/logger.js";
import { fetchTimelineEntries } from "../devrevApi.js";
import { ATTENTION_RULES, FINAL_REMINDER_TAGS, REMINDER_TAGS, SECOND_REMINDER_TAGS } from "./config.js";
import { businessDaysSince, daysAgo, ms } from "./time.js";

// ── Ticket field accessors ───────────────────────────────────────────────
export const lastAgentExternalMs = (t) => ms(t.custom_fields?.tnt__last_devu_message_ts);
const lastCustomerMs = (t) => ms(t.custom_fields?.tnt__last_revu_message_ts);
const hasTagIn = (t, tagSet) =>
  (t.tags || []).some((tag) =>
    tagSet.has((tag.tag?.name || "").toLowerCase().trim()),
  );
export const hasReminderTag = (t) => hasTagIn(t, REMINDER_TAGS);

/**
 * True last outbound EXTERNAL touch from the ticket timeline: agent replies
 * (dev_user) AND the follow-up automation (service_account / sys_user).
 * Needed because tnt__last_devu_message_ts only tracks dev_user comments —
 * the reminder bot posts as service_account and moves NOTHING (proven on
 * TKT-319891 / TKT-320229 / TKT-319953, 2026-08-04). Costs 1+ API calls per
 * ticket, so it runs only for reminder-tagged tickets that would otherwise
 * flag (the ambiguous cases). Returns epoch ms or null.
 *
 * Walks BACKWARDS (mode:"before") so the newest comments come first — the
 * old forward walk paged from the ticket's creation and its 10-page cap cut
 * off exactly the recent end where the answer lives (timeline pagination is
 * over ALL event types, discussions arrive sparse; probed 2026-08-11).
 * Scanning a page newest→oldest, the first org external comment IS the
 * latest — return immediately.
 */
export const TIMELINE_PAGE_CAP = 10;
const ORG_AUTHOR_TYPES = new Set(["dev_user", "service_account", "sys_user"]);
const lastOutboundExternalMs = async (ticketDon) => {
  let cursor = null,
    pages = 0;
  do {
    const { entries, nextCursor } = await fetchTimelineEntries(ticketDon, { cursor, limit: 100, mode: "before" });
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type !== "timeline_comment") continue;
      if ((e.visibility || "internal") === "internal") continue;
      if (!ORG_AUTHOR_TYPES.has(e.created_by?.type)) continue;
      const t = ms(e.created_date);
      if (t) return t;
    }
    cursor = nextCursor;
  } while (cursor && ++pages < TIMELINE_PAGE_CAP);
  return null;
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
export const pendingPreVerdict = (t, nowMs) => {
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
export const resolvePendingBlock = async (t, pre, nowMs) => {
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
