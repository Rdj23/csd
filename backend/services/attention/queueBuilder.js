/**
 * attention/queueBuilder — Assembling a member's queue from live DevRev tickets.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import logger from "../../config/logger.js";
import { isSolvedStatus, resolveOwnerName } from "../../config/constants.js";
import { redisGet } from "../../lib/cache.js";
import { publishSocketEvent } from "../../lib/pubsub.js";
import { AttentionQueue } from "../../models/index.js";
import { streamActiveFromDevRev } from "../sync/index.js";
import { ATTENTION_TIMING, DAY_MS } from "./config.js";
import { buildItems } from "./rules.js";
import { isWeekendIst, istInstant, istYmd } from "./time.js";
import { hasDevRevInternalNote, trackedRemarkIds } from "./tracking.js";

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
export const activeTicketsByMember = async ({ allowPartial = false, onlyMembers = null } = {}) => {
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
  let day = t.escalateNextDay ? new Date(fromMs + DAY_MS) : new Date(fromMs);
  // Slack is Mon–Fri only (Rohan 2026-08-09): a follow-up landing on Sat/Sun
  // slides to Monday at the same shift time — weekend shifts are ad hoc, so
  // "next shift start" derived from the weekday roster is wrong there anyway.
  while (isWeekendIst(day.getTime())) day = new Date(day.getTime() + DAY_MS);
  return istInstant(istYmd(day), t.escalateAt);
};

export const buildQueueForMember = async (candidate, ticketsByMember, nowMs) => {
  const tickets = ticketsByMember.get(candidate.name) || [];
  const items = await buildItems(tickets, nowMs);

  // Seed tracked state from remarks made earlier today — the member already
  // looked at these on the (always-visible) previous queue; don't re-alert.
  // Same courtesy for internal notes left in DevRev today (checked only when
  // the cheap remark lookup misses — backwards timeline walk, ~1 API call):
  // the note proves the member picked the ticket up, and waiting on a Verify
  // click or the hourly auto-verify would let the shift-end Slack summary
  // alert over work already acknowledged.
  const remarked = await trackedRemarkIds(items.map((i) => i.display_id), candidate.shiftDate);
  for (const item of items) {
    const tracked =
      remarked.has(item.display_id) ||
      (await hasDevRevInternalNote(item.ticket_id, candidate.shiftDate));
    if (tracked) {
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
