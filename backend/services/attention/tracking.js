/**
 * attention/tracking — Has the member acknowledged a ticket today? (remark OR DevRev internal note)
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import logger from "../../config/logger.js";
import { Remark } from "../../models/index.js";
import { fetchTimelineEntries } from "../devrevApi.js";
import { TIMELINE_PAGE_CAP } from "./ticketFields.js";

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
export const trackedRemarkIds = async (displayIds, shiftDate) => {
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
 * WALKS BACKWARDS (mode:"before", newest page first) and stops as soon as a
 * page's newest comment predates the queue day — the note it hunts for was
 * made TODAY, i.e. at the very END of the timeline. The original forward
 * walk from the ticket's creation with a 5-page cap missed exactly that end
 * on any ticket with a busy timeline (pagination covers ALL event types;
 * TKT-319993 needed 15 forward pages for 53 comments — why "I commented and
 * clicked Verify but it stayed pending" only hit SOME tickets, Rohan
 * 2026-08-11). Typically 1 page now. Failures return false: the item stays
 * pending, which is the safe direction (an extra nudge beats silently
 * dropping a real one).
 */
export const hasDevRevInternalNote = async (ticketDonId, shiftDate) => {
  if (!ticketDonId) return false;
  const dayStartMs = new Date(`${shiftDate}T00:00:00+05:30`).getTime();
  let cursor = null;
  let pages = 0;
  try {
    do {
      const { entries, nextCursor } = await fetchTimelineEntries(ticketDonId, { cursor, limit: 100, mode: "before" });
      let newestMs = null;
      for (const e of entries) {
        if (e.type !== "timeline_comment") continue;
        const t = new Date(e.created_date).getTime();
        if (!newestMs || t > newestMs) newestMs = t;
        if (t < dayStartMs) continue;
        // Missing visibility = internal — DevRev omits the default (same
        // convention as lastOutboundExternalMs / verifyResponseTimestamps).
        if ((e.visibility || "internal") !== "internal") continue;
        if (e.created_by?.type !== "dev_user") continue;
        return true;
      }
      // Everything on this page predates the queue day; earlier pages are
      // older still. (Empty pages can't prove that — keep walking.)
      if (newestMs && newestMs < dayStartMs) return false;
      cursor = nextCursor;
      pages++;
    } while (cursor && pages < TIMELINE_PAGE_CAP);
  } catch (e) {
    logger.warn({ err: e.message, ticket: ticketDonId }, "Attention: DevRev internal-note check failed");
    return false;
  }
  return false;
};
