/**
 * attention/rules — The rule engine: does a ticket need attention, and in which bucket.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import { isSolvedStatus } from "../../config/constants.js";
import { bucketForStage } from "../reconcileService.js";
import { ATTENTION_RULES, DAY_MS } from "./config.js";
import { hasReminderTag, lastAgentExternalMs, pendingPreVerdict, resolvePendingBlock } from "./ticketFields.js";
import { daysAgo, istTodayStartMs, ms } from "./time.js";

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
