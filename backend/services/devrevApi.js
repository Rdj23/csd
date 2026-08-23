/**
 * devrevApi.js — DevRev API configuration and HTTP helper.
 *
 * WHY THIS FILE EXISTS:
 * Every service that talks to DevRev (syncService, activityService, agentService)
 * needs the same base URL and auth headers. Centralizing them here means:
 * 1. One place to update if DevRev changes their API URL
 * 2. One place to update the PAT (Personal Access Token) when it rotates
 * 3. DRY — no duplicated auth header construction across 5+ files
 *
 * DATA FLOW:
 *   Any service → import { DEVREV_API, HEADERS } → axios.get/post(DEVREV_API + endpoint, { headers: HEADERS })
 */

import axios from "axios";
import logger from "../config/logger.js";

/**
 * DEVREV_API — Base URL for all DevRev REST API calls.
 * All endpoints are relative to this: /works.list, /works.get, /timeline-entries.list, etc.
 */
export const DEVREV_API = "https://api.devrev.ai";

/**
 * HEADERS — Auth + content-type headers sent with every DevRev request.
 *
 * WHY VITE_DEVREV_PAT (not just DEVREV_PAT):
 * This env var is prefixed with VITE_ because it was originally also used by
 * the frontend (Vite exposes env vars with VITE_ prefix to client code).
 * The backend reads it too for API calls.
 *
 * WHAT IS A PAT (Personal Access Token):
 * DevRev's equivalent of an API key. It's a long-lived token tied to a specific
 * DevRev user/org that grants read/write access to the API. You generate it in
 * DevRev Settings → API Tokens.
 *
 * SECURITY NOTE: This token has broad access. In production, generate a dedicated
 * DevRev Service Account Token with minimal permissions instead of a personal token.
 * A personal PAT shares rate limits with your browser session — aggressive syncs
 * can throttle your own DevRev UI.
 *
 * Migration: prefer DEVREV_PAT; falls back to VITE_DEVREV_PAT for backward compat.
 */
const DEVREV_TOKEN = process.env.DEVREV_PAT || process.env.VITE_DEVREV_PAT;
if (!DEVREV_TOKEN) {
  logger.warn("Neither DEVREV_PAT nor VITE_DEVREV_PAT is set — DevRev API calls will fail");
}

export const HEADERS = {
  Authorization: `Bearer ${DEVREV_TOKEN}`,
  "Content-Type": "application/json",
};

/**
 * fetchWithRetry — Wraps axios.get with automatic retry logic.
 *
 * WHY WE NEED THIS:
 * DevRev API occasionally returns 5xx errors or times out under load.
 * Without retry, one bad response would fail the entire sync operation.
 * With retry, transient errors are handled transparently.
 *
 * RETRY STRATEGY:
 * - Default: 2 attempts (1 initial + 1 retry)
 * - Delay: attempt * 2000ms → 1st retry after 2s, 2nd after 4s
 * - This is LINEAR backoff (not exponential like BullMQ).
 *   It's simpler because this is for individual API calls within a
 *   job that already has BullMQ's exponential retry on top.
 *
 * WHY ONLY axios.get (not POST):
 * Currently only used by fetchAndCacheTickets() which calls works.list (GET).
 * POST endpoints (works.get, timeline-entries.list) use raw axios with their
 * own error handling. Could be extended to support POST in the future.
 *
 * NOTE: This is separate from BullMQ's retry mechanism:
 * - fetchWithRetry: retries individual HTTP calls (2-3 times, seconds apart)
 * - BullMQ retry: retries entire jobs (3-4 times, minutes apart)
 * Both work together: a job might make 20 API calls, each retried internally,
 * and if the whole job still fails, BullMQ retries the entire thing.
 */
export const fetchWithRetry = async (url, options, retries = 2) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, options);
    } catch (err) {
      if (attempt === retries) throw err; // Last attempt — propagate error to caller
      logger.warn({ attempt, retries, err }, "API attempt failed, retrying");
      await new Promise((r) => setTimeout(r, attempt * 2000)); // Wait 2s, 4s, 6s...
    }
  }
};

// ── DevRev domain helpers (extracted from ticketController) ─────────────

/** Build the full DON URN for a ticket ID. */
const ticketUrn = (ticketId) =>
  `don:core:dvrv-us-1:devo/1iVu4ClfVV:ticket/${ticketId}`;

/**
 * Fetch links for a ticket via DevRev links.list.
 * Returns the raw `links` array (may be empty).
 *
 * Deliberately UNFILTERED (no object_types): dependencies aren't only issues —
 * UCMR-synced tickets (external_sync_unit "UCMR (ex-PROD)") and TAM tasks /
 * custom objects also count. Callers pick relevant targets with
 * dependencyCounterpart().
 */
export const fetchTicketLinks = async (ticketId) => {
  const res = await axios.post(
    `${DEVREV_API}/links.list`,
    { object: ticketUrn(ticketId), limit: 20 },
    { headers: HEADERS },
  );
  return res.data.links || [];
};

/**
 * Fetch a single work item (issue/ticket) by its display ID.
 * Returns the `work` object or null.
 */
export const fetchWorkItem = async (id) => {
  const res = await axios.post(
    `${DEVREV_API}/works.get`,
    { id },
    { headers: HEADERS },
  );
  return res.data.work || null;
};

/**
 * Fetch multiple work items by display IDs.
 * Returns a Map of display_id → work object for O(1) lookups.
 *
 * NOTE: DevRev's works.list has no "fetch by a list of display_ids" filter
 * (the old `apply_to` body was rejected with HTTP 400 on every call), so we
 * fan out parallel works.get requests instead. allSettled keeps partial data:
 * one failed ID logs a warning but never sinks the whole batch.
 */
export const fetchWorkItems = async (ids) => {
  if (!ids.length) return new Map();
  const settled = await Promise.allSettled(ids.map((id) => fetchWorkItem(id)));
  const map = new Map();
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      map.set(r.value.display_id, r.value);
    } else if (r.status === "rejected") {
      logger.warn({ err: r.reason?.message, targetId: ids[i] }, "Failed to fetch linked work item");
    }
  });
  return map;
};

/**
 * Fetch timeline entries (comments/events) for a work item.
 * Used by activityService for syncing comment data.
 * Returns { entries: Array, nextCursor: string|null }.
 *
 * `mode: "before"` walks the timeline BACKWARDS: no cursor = the newest
 * page, then keep passing next_cursor to move toward the oldest. Entries
 * stay ascending WITHIN each page either way. Pagination runs over the RAW
 * timeline (every event type) and the discussions filter applies per page —
 * so pages can be sparse or empty while next_cursor keeps going (a busy
 * ticket took 15 forward pages for 53 comments, probed 2026-08-11). Recent
 * comments are therefore only reachable cheaply via mode:"before".
 */
export const fetchTimelineEntries = async (objectId, { cursor, limit = 50, mode } = {}) => {
  const body = { object: objectId, collections: ["discussions"], limit };
  if (cursor) body.cursor = cursor;
  if (mode) body.mode = mode;

  const res = await axios.post(
    `${DEVREV_API}/timeline-entries.list`,
    body,
    { headers: HEADERS, timeout: 30000 },
  );
  return {
    entries: res.data?.timeline_entries || [],
    nextCursor: res.data?.next_cursor || null,
  };
};

/**
 * Fetch ALL links for an arbitrary DevRev object (by full DON id).
 *
 * WHY THIS IS SEPARATE FROM fetchTicketLinks:
 * fetchTicketLinks() hardcodes the ticket URN shape — it answers "what is this
 * ticket linked to?". The Parts View needs the
 * opposite kind of walk: "what part is THIS part a child of?" That means calling
 * links.list on a *part* DON and reading the `is_part_of` link. So we keep a generic
 * helper that takes any object DON and returns the raw links array unfiltered.
 *
 * The DevRev links.list response shape (per object):
 *   { links: [ { link_type: "is_part_of", source: {...}, target: { id, display_id,
 *                 type, ... } }, ... ] }
 * The caller decides which link_type to follow.
 */
export const fetchObjectLinks = async (objectDon) => {
  const res = await axios.post(
    `${DEVREV_API}/links.list`,
    { object: objectDon },
    { headers: HEADERS },
  );
  return res.data?.links || [];
};

/**
 * Fetch a single part (product / capability / feature) by its DON id or display id.
 * Returns the `part` object (with display_id, type, name, ...) or null.
 *
 * NOTE: parts.get does NOT return parent info on the public API — only links.list does.
 * So this is used purely to resolve a part's own metadata (name + level), never its parent.
 */
export const fetchPart = async (id) => {
  const res = await axios.post(
    `${DEVREV_API}/parts.get`,
    { id },
    { headers: HEADERS },
  );
  return res.data?.part || null;
};

/**
 * Classify an issue into a team based on its custom fields and subtype.
 * Centralised here so both getIssueDetails and getBatchDependencies
 * produce consistent team labels.
 */
export const classifyIssueTeam = (issue, fallback = "Unknown") => {
  const customFields = issue.custom_fields || {};
  const subtype = issue.subtype || "";

  if (customFields.ctype__issuetype === "PSN Task") return "NOC";
  if (customFields.ctype__team_involved) return customFields.ctype__team_involved;
  if (subtype === "internal_clevertap_slack") return customFields.ctype__team_involved || "Internal";
  if (subtype.includes("email")) return "Email";
  if (subtype.includes("whatsapp")) return "Whatsapp";
  return fallback;
};

// ── Dependency link helpers ─────────────────────────────────────────────
// A ticket's "dependency" can be an issue, another ticket (e.g. UCMR-synced
// "UCMR (ex-PROD)" tickets), a task, or a custom object (e.g. TAM tasks
// defined via schemas.custom.list). Parts (is_part_of) and conversations are
// never dependencies.

const DEP_WORK_TYPES = new Set(["issue", "ticket", "task"]);

const isDependencyTarget = (obj) => {
  if (!obj || !obj.display_id) return false;
  const type = (obj.type || "").toLowerCase();
  return DEP_WORK_TYPES.has(type) || type.includes("custom") || Boolean(obj.leaf_type);
};

/**
 * The sync-unit name of an airdropped object ("UCMR (ex-PROD)" etc.), if any.
 * Verified against works.get: lives at
 * sync_metadata.last_sync_in.sync_unit.external_sync_unit_name.
 */
export const getSyncUnitName = (obj) => {
  const sm = obj?.sync_metadata;
  return (
    sm?.last_sync_in?.sync_unit?.external_sync_unit_name ||
    sm?.last_sync_out?.sync_unit?.external_sync_unit_name ||
    sm?.last_sync_in?.sync_unit?.name ||
    obj?.external_sync_unit_name ||
    ""
  );
};

/**
 * Pick the dependency object out of a link, whichever side of the link it is
 * on. Returns the target/source summary object, or null if the link isn't a
 * dependency (part links, self-references, conversations...).
 */
export const dependencyCounterpart = (link, ticketId) => {
  const selfId = String(ticketId).replace(/^TKT-/i, "");
  return (
    [link.target, link.source].find(
      (o) =>
        isDependencyTarget(o) &&
        (o.display_id || "").replace(/^TKT-/i, "") !== selfId,
    ) || null
  );
};

/**
 * Team label for any linked work item / custom object.
 * `snapshot` is the summary object embedded in the links.list response — the
 * full works.get record doesn't exist for custom objects and may omit
 * sync_metadata, so both are consulted.
 */
export const classifyLinkedWorkTeam = (work, snapshot = null, fallback = "Other") => {
  const src = work || snapshot || {};
  const type = (src.type || snapshot?.type || "").toLowerCase();
  const customFields = src.custom_fields || {};

  // Issues keep the existing classification (NOC, ctype__team_involved —
  // which is how TAM-owned issues are labeled — email/whatsapp subtypes...).
  if (type === "issue" || !type) {
    const team = classifyIssueTeam(src, "");
    if (team) return team;
  }

  // UCMR: Jira-synced objects carry the sync-unit name ("UCMR (ex-PROD)")
  // and/or UCMR-flavored ctype fields (verified on ISS-135552 / TKT-315943).
  const syncUnit = getSyncUnitName(work) || getSyncUnitName(snapshot);
  const ucmrHint = `${syncUnit} ${customFields.ctype__ext_object_type || ""} ${customFields.ctype__issuetype || ""} ${customFields.ctype__project || ""}`;
  if (/ucmr/i.test(ucmrHint)) return "UCMR";

  // TAM tasks / custom objects. Issues are excluded here: their subtype can
  // be an opaque hash that could contain "tam" by accident.
  const kind = `${src.leaf_type || snapshot?.leaf_type || ""} ${src.subtype || snapshot?.subtype || ""}`;
  if (type !== "issue" && type !== "" && (/tam/i.test(kind) || type === "task")) return "TAM";

  // Other sync units: use the unit name minus any "(ex-PROD)"-style suffix.
  if (syncUnit) return syncUnit.replace(/\s*\(.*\)\s*$/, "").trim() || fallback;
  if (type === "ticket") return "Linked Ticket";
  return fallback;
};
