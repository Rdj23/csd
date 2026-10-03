/**
 * partsService.js — DevRev part-hierarchy resolution + Parts View data layer.
 *
 * WHAT THIS POWERS:
 * The "Parts View" tab renders DevRev's part tree (Product > Capability > Feature >
 * sub-Feature) with ticket counts rolled up to every level. A ticket points to ONE
 * part via `applies_to_part` (any level — usually a deep feature) and does NOT name
 * its product directly. To find the product we must walk UP the `is_part_of` chain
 * via links.list (parts.get does NOT expose parent info on the public API).
 *
 * THE THREE RESPONSIBILITIES:
 * 1. resolvePartAncestry()  — the reusable link-walking resolver (pure, DI'd for tests).
 * 2. runPartsSync()         — the daily cron body: tag tickets + cache the hierarchy.
 * 3. buildPartsTree() / getPartTickets() — the read side the API endpoints serve.
 *
 * WHY WE CACHE ancestry IN MONGO (`parts` collection):
 * Walking links is expensive (1 links.list + 1 parts.get per uncached part). The
 * hierarchy rarely changes, so once a part's chain is resolved we store it and never
 * re-walk it. After the first backfill, syncs are almost entirely cache hits.
 *
 * ── WHERE THE CODE LIVES ────────────────────────────────────────────────
 * The three responsibilities above are now three modules, in dependency
 * order; each may only import from those above it.
 *
 *   config.js    cache keys, the unresolved-node sentinel, the DevRev URL
 *                builder, and the status -> stage matchers.
 *   ancestry.js  RESPONSIBILITY 1 — pickParentDon + resolvePartAncestry, the
 *                link-walking resolver. Dependencies are injected, so it is
 *                unit-testable without DevRev (see tests/partsResolver.test.js).
 *   sync.js      RESPONSIBILITY 2 — the daily cron: build a part context, tag
 *                tickets with their resolved chain, warm the caches.
 *   queries.js   RESPONSIBILITY 3 — the read side: buildPartsTree,
 *                getPartTickets, getPartsTrend.
 *
 * A wrong PARENT is an ancestry.js bug. A ticket tagged with the wrong part is
 * a sync.js bug. Wrong counts on a correct tree is a queries.js bug.
 */

// ── Public surface ───────────────────────────────────────────────────────
// Exactly the 11 symbols services/partsService.js used to export.

export { PARTS_LAST_SYNC_KEY, UNKNOWN_NODE_ID, buildDevrevTicketUrl } from "./config.js";
export { pickParentDon, resolvePartAncestry } from "./ancestry.js";
export { createPartContext, resolveWorkPartFields, runPartsSync } from "./sync.js";
export { buildPartsTree, getPartTickets, getPartsTrend } from "./queries.js";
