/**
 * attention/verification — Re-checking a queue against live DevRev before clearing it.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import logger from "../../config/logger.js";
import { getTeamSlackChannel, isSolvedStatus, resolveOwnerName } from "../../config/constants.js";
import { publishSocketEvent } from "../../lib/pubsub.js";
import { AttentionQueue } from "../../models/index.js";
import { fetchWorkItem } from "../devrevApi.js";
import { bucketForStage } from "../reconcileService.js";
import { ATTENTION_RULES, DAY_MS } from "./config.js";
import { memberMention, postAlert } from "./slack.js";
import { hasReminderTag, lastAgentExternalMs, pendingPreVerdict, resolvePendingBlock } from "./ticketFields.js";
import { isWeekendIst, istTodayStartMs } from "./time.js";
import { hasDevRevInternalNote, trackedRemarkIds } from "./tracking.js";

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
    // Third suppression: Slack is Mon–Fri only (Rohan 2026-08-09) — a queue
    // cleared on a weekend still clears everywhere, just without the post.
    // Fourth: no team channel (teamless member / slackChannel unset) — the
    // queue still clears everywhere, just no Slack (Rohan 2026-08-10).
    const channel = getTeamSlackChannel(queue.member);
    if (!alertStillAhead && clearedCount > 0 && !isWeekendIst(nowMs) && channel) {
      const who = memberMention(queue);
      // Copy per Rohan 2026-08-08: tracked items get the "+n being tracked"
      // note; a fully-actioned queue (nothing tracked) gets the plain
      // "awesome job today" congratulations instead.
      const tickets = `*${clearedCount} ticket${clearedCount === 1 ? "" : "s"}* actioned`;
      const text = trackedCount
        ? `✅ Superb ${who} — attention queue cleared! ${tickets} (+${trackedCount} being tracked via remarks). 👏`
        : `✅ Superb ${who} — attention queue cleared! ${tickets} — you did an awesome job today. 👏`;
      await postAlert({ kind: "queue_cleared", text, channel });
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
