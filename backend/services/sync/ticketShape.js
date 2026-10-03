/**
 * sync/ticketShape — How a raw DevRev ticket becomes our ticket: classify, trim, filter, size-guard.
 *
 * Extracted from the 988-line syncService.js; logic unchanged.
 * See sync/index.js for the data-flow overview.
 */

import logger from "../../config/logger.js";
import { resolveOwnerName } from "../../config/constants.js";

// Max changed+removed tickets to ship as a socket delta. Above this the
// broadcast would rival a compressed full download, so clients full-fetch
// instead. Typical webhook sync touches 1-10 tickets.
export const DELTA_MAX_TICKETS = Number(process.env.DELTA_MAX_TICKETS) || 100;

// NOTE: an earlier version of this comment claimed "BullMQ handles concurrency
// (concurrency: 1) so no mutex is needed." That was wrong, and it is why the
// guard below had to be added after the 2026-08-08 OOM. concurrency: 1 is
// per-Worker — it serialises jobs WITHIN one queue and says nothing about the
// three other entry points into fetchAndCacheTickets (activity-sync's

// ── Shared ticket filtering & trimming ──────────────────────────────────
// Extracted to avoid duplication between quickFetchTickets and fetchAndCacheTickets.
// Single source of truth for what constitutes a "relevant" ticket and which
// fields the frontend needs — change once, applied everywhere.

// SOLVED_CUTOFF_DATE removed 2026-08-09 along with the phase-2 solved scan.
// The live cache no longer carries solved tickets at all, so there is nothing
// left to cut off — solved history lives in Mongo (analyticstickets), keyed on
// closed_date with no retention window.

// ── Agent (AI) rollout date ──
// Tickets closed on/after this date may be handled by the AI agent. Before this
// date, "unassigned" was always a data hygiene problem and we skipped them; now
// it can also legitimately mean "agent solved it without a human owner".
const AGENT_START_DATE = new Date("2026-03-01");

/**
 * Classify how a ticket was resolved.
 * Returns { resolvedBy: "agent"|"engineer", finalOwner: string|null, agentResolved: bool }.
 *  - Agent Handled  = tnt__agent_resolved === true AND tnt__support_engineer_handled !== true
 *                     (also: no GST owner AND solved post-agent-rollout)
 *  - Engineer Handled = anything else with a GST owner (engineer touched it,
 *                       even if the agent flag is also set)
 * The AND-with-NOT-engineer rule prevents tickets that an engineer co-handled
 * from being miscounted as pure agent resolutions.
 */
export const classifyResolution = (ticket, closedDate, gstOwner) => {
  const cf = ticket.custom_fields || {};
  const agentFlag = cf.tnt__agent_resolved === true;
  const engineerHandled = cf.tnt__support_engineer_handled === true;
  const agentResolved = agentFlag && !engineerHandled;

  if (gstOwner) {
    return {
      resolvedBy: agentResolved ? "agent" : "engineer",
      finalOwner: gstOwner,
      agentResolved,
    };
  }
  // No GST owner. Keep only genuinely agent-resolved tickets (flag set AND no
  // engineer co-handling) in the agent era. A non-GST HUMAN owner (e.g. a
  // Solutions/CSM engineer) previously fell through here and was stored as
  // "Unassigned"/agent, inflating GST analytics with tickets GST never solved
  // (e.g. TKT-314228, solved by a non-roster engineer with
  // tnt__agent_resolved=false). Those are now skipped entirely.
  if (closedDate >= AGENT_START_DATE && agentResolved) {
    return { resolvedBy: "agent", finalOwner: "Unassigned", agentResolved };
  }
  return { resolvedBy: null, finalOwner: null, agentResolved };
};

/** Reduce a raw DevRev ticket to only the fields the frontend renders. */
export const trimTicket = (t) => {
  const cf = t.custom_fields || {};
  return {
    id: t.id,
    display_id: t.display_id,
    title: t.title,
    // Work subtype (query / bug / feature) — carried to the live cache so the Parts
    // View classification filter can scope active tickets without a backend round-trip.
    subtype: t.subtype || null,
    priority: t.priority,
    severity: t.severity,
    account: t.account?.display_name || t.account,
    // Sub-objects reduced to exactly the fields consumers read (frontend:
    // stage.name, owned_by display_id/display_name, tag.tag.name; backend:
    // owned_by id/email for reconcile + attention). Full DevRev sub-objects
    // roughly double the cache blob and every client download.
    stage: t.stage ? { name: t.stage.name } : t.stage,
    owned_by: (t.owned_by || []).map((u) => ({
      id: u.id,
      display_id: u.display_id,
      display_name: u.display_name,
      email: u.email,
    })),
    created_date: t.created_date,
    modified_date: t.modified_date,
    custom_fields: {
      tnt__csatrating: cf.tnt__csatrating,
      tnt__region_salesforce: cf.tnt__region_salesforce,
      tnt__instance_account_name: cf.tnt__instance_account_name,
      tnt__csm_email_id: cf.tnt__csm_email_id,
      tnt__csm: cf.tnt__csm,
      tnt__tam: cf.tnt__tam,
      tnt__rwt_business_hours: cf.tnt__rwt_business_hours,
      tnt__frt_hours: cf.tnt__frt_hours,
      tnt__iteration_count: cf.tnt__iteration_count,
      tnt__frr: cf.tnt__frr,
      tnt__customer_wait_time: cf.tnt__customer_wait_time,
      tnt__last_devu_message_ts: cf.tnt__last_devu_message_ts,
      tnt__last_revu_message_ts: cf.tnt__last_revu_message_ts,
      tnt__account_cohort_fy_25: cf.tnt__account_cohort_fy_25,
      // Agent (AI) handling — surfaced to the live cache so the dashboard
      // "Resolved By" filter can classify active tickets without a backend round-trip.
      // Both flags are needed: a ticket counts as agent-handled only when
      // tnt__agent_resolved is true AND tnt__support_engineer_handled is false.
      tnt__agent_resolved: cf.tnt__agent_resolved === true,
      tnt__support_engineer_handled: cf.tnt__support_engineer_handled === true,
      tnt__agent_response_count: cf.tnt__agent_response_count || 0,
    },
    tags: (t.tags || []).map((tag) => ({ tag: { name: tag.tag?.name } })),
    sentiment: t.sentiment,
    isZendesk: t.tags?.some((tag) => tag.tag?.name === "Zendesk import"),
    actual_close_date: t.actual_close_date,
    // Parts View: carry the part this ticket is filed under so the parts-sync /
    // active-parts refresh can resolve its ancestry from cache without a works.get.
    applies_to_part_id: t.applies_to_part?.id || null,
  };
};

/** Check if a ticket's stage is "active" (open/pending/waiting). */
const isActiveStage = (stage) =>
  stage.includes("waiting on assignee") ||
  stage.includes("awaiting customer reply") ||
  stage.includes("waiting on clevertap") ||
  stage.includes("on hold") ||
  stage.includes("pending") ||
  stage.includes("open");

/**
 * Check if a ticket belongs in the live dashboard cache.
 *
 * ACTIVE ONLY as of 2026-08-09. This used to also admit solved tickets created
 * since SOLVED_CUTOFF_DATE, to match the phase-2 stream scan. With that scan
 * removed and solved data served from Mongo, admitting them here would make
 * the cold-start fast path (quickFetchTickets) briefly show solved tickets
 * that the very next full sync then strips out — a visible flicker and a
 * disagreement between two views of the same cache.
 */
export const isRelevantTicket = (t) => isActiveStage(t.stage?.name?.toLowerCase() || "");

// Require a resolved GST owner before caching to Redis. Unassigned tickets
// (including agent-resolved ones with finalOwner="Unassigned") are excluded
// from tickets:active to keep the cache within the free-tier Valkey 25MB cap.
// They still flow into MongoDB via syncHistoricalToDB → classifyResolution,
// so analytics, the Resolved-By filter, and agent-handled metrics are intact.
export const isGSTOwned = (t) => !!resolveOwnerName(t.owned_by?.[0]?.display_name);

// Bump VALKEY_CAP_MB when the Valkey plan is upgraded — currently 25MB free tier.
// Hash key roughly doubles total memory because tickets:active and
// tickets:active:hash hold the same data shaped differently, so headroom
// thresholds are intentionally conservative.
const VALKEY_CAP_MB = 25;
const CACHE_WARN_PCT = 0.7;
const CACHE_ALERT_PCT = 0.9;

// Takes the pre-stringified payload so the caller can reuse the SAME string
// for the Redis write — stringifying a multi-MB array twice was part of the
// hourly memory spike that OOM-killed the 512MB instance (2026-08-03).
export const checkCacheSize = (ticketCount, json) => {
  const bytes = Buffer.byteLength(json);
  const mb = bytes / (1024 * 1024);
  const pctOfCap = mb / VALKEY_CAP_MB;
  const meta = {
    ticketCount,
    sizeMB: Number(mb.toFixed(2)),
    capMB: VALKEY_CAP_MB,
    pctOfCap: Number((pctOfCap * 100).toFixed(1)),
  };
  if (pctOfCap >= CACHE_ALERT_PCT) {
    logger.error(meta, "tickets:active near Valkey cap — OOM imminent, upgrade or tighten filters");
  } else if (pctOfCap >= CACHE_WARN_PCT) {
    logger.warn(meta, "tickets:active past 70% of Valkey cap — investigate before it hits the limit");
  } else {
    logger.info(meta, "tickets:active size snapshot");
  }
};
