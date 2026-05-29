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
 * Fetch linked issues for a ticket via DevRev links.list.
 * Returns the raw `links` array (may be empty).
 */
export const fetchTicketLinks = async (ticketId) => {
  const res = await axios.post(
    `${DEVREV_API}/links.list`,
    { object: ticketUrn(ticketId), object_types: ["issue"], limit: 10 },
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
 * Fetch multiple work items by display IDs in a single API call.
 * Uses works.list with an `apply_to` filter instead of N separate works.get calls.
 * Returns a Map of display_id → work object for O(1) lookups.
 */
export const fetchWorkItems = async (ids) => {
  if (!ids.length) return new Map();
  const res = await axios.post(
    `${DEVREV_API}/works.list`,
    { apply_to: ids, limit: ids.length },
    { headers: HEADERS },
  );
  const works = res.data.works || [];
  return new Map(works.map((w) => [w.display_id, w]));
};

/**
 * Fetch timeline entries (comments/events) for a work item.
 * Used by activityService for syncing comment data.
 * Returns { entries: Array, nextCursor: string|null }.
 */
export const fetchTimelineEntries = async (objectId, { cursor, limit = 50 } = {}) => {
  const body = { object: objectId, collections: ["discussions"], limit };
  if (cursor) body.cursor = cursor;

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
 * fetchTicketLinks() hardcodes the ticket URN shape and filters to object_types:["issue"]
 * — it only answers "what issues is this ticket linked to?". The Parts View needs the
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
