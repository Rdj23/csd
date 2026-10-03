/**
 * activity/resolve — Turning a raw timeline entry into WHO, WHICH ACCOUNT and HOW MANY POINTS.
 *
 * Extracted from the 653-line activityService.js; logic unchanged.
 * See activity/index.js for how a comment becomes points.
 */

import logger from "../../config/logger.js";
import { GST_DEVU_MAP, GST_MEMBERS, GST_NAME_MAP, resolveOwnerName } from "../../config/constants.js";
import { redisHGet } from "../../lib/cache.js";
import { AnalyticsTicket } from "../../models/index.js";
import { fetchWorkItem } from "../devrevApi.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert UTC date → IST date bucket ("YYYY-MM-DD") and hour (0-23). */
export const toISTBucket = (date) => {
  const d = new Date(date);
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const dateBucket = ist.toISOString().slice(0, 10);
  const hourBucket = ist.getUTCHours();
  return { dateBucket, hourBucket };
};

/** Resolve a DevRev created_by object → GST member name (or null). */
export const resolveUserName = (createdBy) => {
  if (!createdBy || createdBy.type !== "dev_user") return null;

  // Try display_name through existing GST_NAME_MAP
  if (createdBy.display_name) {
    const resolved = GST_NAME_MAP[createdBy.display_name];
    if (resolved && GST_MEMBERS.has(resolved)) return resolved;
    // Direct check in case display_name is already the short name
    if (GST_MEMBERS.has(createdBy.display_name)) return createdBy.display_name;
  }

  // Try extracting DEVU-XXXX from the full DON id
  const m = createdBy.id?.match(/DEVU-\d+/i);
  if (m && GST_DEVU_MAP[m[0]]) return GST_DEVU_MAP[m[0]];

  return null;
};

/**
 * Look up the resolved owner name for a ticket.
 * Fallback chain: MongoDB (solved tickets) → Redis Hash (O(1) per-ticket) → DevRev API.
 *
 * WHY REDIS HASH INSTEAD OF FULL BLOB:
 * The old approach called redisGet("tickets:active") which parsed the entire ~20MB JSON
 * array into memory, then did a linear .find() scan. For batch syncs processing 500+
 * tickets, that's 500 × 20MB = 10GB of transient allocations. The Redis Hash stores each
 * ticket individually, so HGET retrieves and parses only the ~1KB ticket we need — O(1).
 */
export const getTicketOwner = async (ticketId, ticketDisplayId) => {
  // 1. AnalyticsTicket (solved tickets — already in MongoDB)
  if (ticketDisplayId) {
    const doc = await AnalyticsTicket.findOne(
      { ticket_id: ticketDisplayId },
      { owner: 1 },
    ).lean();
    if (doc?.owner) return doc.owner;
  }

  // 2. Redis Hash — O(1) per-ticket lookup (populated by fetchAndCacheTickets)
  if (ticketDisplayId) {
    const cached = await redisHGet("tickets:active:hash", ticketDisplayId);
    if (cached?.owned_by?.[0]?.display_name) {
      return resolveOwnerName(cached.owned_by[0].display_name);
    }
  }

  // 3. DevRev API via devrevApi.js abstraction (DI principle — testable, single retry config)
  try {
    const work = await fetchWorkItem(ticketId);
    const ownerName = work?.owned_by?.[0]?.display_name;
    return ownerName ? resolveOwnerName(ownerName) : null;
  } catch (e) {
    logger.warn({ ticketId, err: e.message }, "Failed to fetch ticket owner");
    return null;
  }
};

/**
 * Get account cohort for a ticket.
 * Same fallback chain as getTicketOwner: MongoDB → Redis Hash → DevRev API.
 */
export const getAccountCohort = async (ticketId, ticketDisplayId) => {
  // 1. AnalyticsTicket
  if (ticketDisplayId) {
    const doc = await AnalyticsTicket.findOne(
      { ticket_id: ticketDisplayId },
      { account_cohort: 1 },
    ).lean();
    if (doc?.account_cohort) return doc.account_cohort;
  }

  // 2. Redis Hash — O(1) per-ticket lookup
  if (ticketDisplayId) {
    const cached = await redisHGet("tickets:active:hash", ticketDisplayId);
    if (cached?.custom_fields?.tnt__account_cohort_fy_25) {
      return cached.custom_fields.tnt__account_cohort_fy_25;
    }
  }

  // 3. DevRev API via devrevApi.js abstraction
  try {
    const work = await fetchWorkItem(ticketId);
    return work?.custom_fields?.tnt__account_cohort_fy_25 || null;
  } catch {
    return null;
  }
};

/** Calculate points for a single comment.
 *  Points only for co-op (helping others) AND only when ticket is solved/closed.
 *  Interim comments on active tickets earn 0 — ownership can still change. */
export const calculatePoints = (visibility, accountCohort, isCoop, stage) => {
  if (!isCoop) return 0;            // Own tickets = no points
  if (visibility === "internal") return 0;
  // Only award points when the ticket is solved/closed/resolved
  const s = (stage || "").toLowerCase();
  if (!s.includes("solved") && !s.includes("closed") && !s.includes("resolved")) return 0;
  // External / public co-op on a solved ticket
  const cohort = (accountCohort || "").toLowerCase();
  const isKey = cohort.includes("key") || cohort.includes("strategic");
  return isKey ? 2 : 4;
};
