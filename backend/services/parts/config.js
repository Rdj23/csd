/**
 * parts/config — Cache keys, the unresolved-node sentinel, DevRev URL builder, stage matchers.
 *
 * Extracted from the 726-line partsService.js; logic unchanged.
 * See parts/index.js for how the resolver, the sync and the read side relate.
 */

import { SOLVED_STATUSES } from "../../config/constants.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Redis key caching the default (unfiltered) parts tree for instant first paint. */
export const TREE_CACHE_KEY = "parts:tree:default";
export const TREE_CACHE_TTL = 600; // 10 min — cron refreshes the underlying data daily
/** SyncMetadata key for the cron's last-run timestamp (resumability). */
export const PARTS_LAST_SYNC_KEY = "parts_last_sync";

/** Synthetic node id for tickets whose part couldn't be resolved (or have none). */
export const UNKNOWN_NODE_ID = "__unresolved__";

/**
 * DevRev web app org slug, used to build clickable ticket links for the UI.
 * Overridable via env in case the org slug differs from the email domain.
 */
const DEVREV_ORG_SLUG = process.env.DEVREV_ORG_SLUG || "clevertapsupport";

/** Build the DevRev web URL for a ticket from its display id (e.g. TKT-309513). */
export const buildDevrevTicketUrl = (displayId) =>
  displayId ? `https://app.devrev.ai/${DEVREV_ORG_SLUG}/works/${displayId}` : null;

/**
 * Team-vocabulary status → DevRev stage-name matcher substrings.
 * (See dashboard ticket vocabulary: open=Waiting on Assignee, pending=Awaiting
 * Customer Reply, on hold=Waiting on CleverTap, solved=Solved/Resolved.)
 */
export const STATUS_STAGE_MATCHERS = {
  open: ["waiting on assignee"],
  pending: ["awaiting customer reply"],
  "on hold": ["waiting on clevertap"],
  solved: SOLVED_STATUSES, // ["solved","closed","resolved"]
};
