/**
 * parts/sync — The daily cron body: tag tickets with their part chain and cache it.
 *
 * Extracted from the 726-line partsService.js; logic unchanged.
 * See parts/index.js for how the resolver, the sync and the read side relate.
 */

import logger from "../../config/logger.js";
import { redisDelete } from "../../lib/cache.js";
import { AnalyticsTicket, Part, SyncMetadata } from "../../models/index.js";
import {
  DEVREV_API,
  HEADERS,
  fetchWithRetry,
  fetchObjectLinks as devrevFetchObjectLinks,
  fetchPart as devrevFetchPart,
  fetchWorkItem as devrevFetchWorkItem,
} from "../devrevApi.js";
import { resolvePartAncestry } from "./ancestry.js";
import { PARTS_LAST_SYNC_KEY, TREE_CACHE_KEY } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────
// 2. CACHE-FIRST ANCESTRY (persists chains into the `parts` collection)
// ─────────────────────────────────────────────────────────────────────────

/** Small retry/backoff wrapper for the DevRev POST helpers used by the resolver. */
const withRetry = async (fn, { retries = 3, baseMs = 1500 } = {}) => {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      // Only back off on rate-limit / transient server errors; fail fast otherwise.
      if (status && status !== 429 && status < 500) throw err;
      const wait = baseMs * Math.pow(2, attempt); // 1.5s, 3s, 6s
      logger.warn({ attempt, wait, status }, "[parts] DevRev call retrying");
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
};

/**
 * Build a resolution context: an in-memory map of every already-cached part
 * (loaded once from the `parts` collection) so a sync run re-walks links ONLY for
 * parts it has never seen. Returns helpers bound to that context.
 */
export const createPartContext = async () => {
  const cached = await Part.find().lean();
  const partsById = new Map(cached.map((p) => [p._id, p]));
  const partMetaCache = new Map(
    cached.map((p) => [p._id, { id: p._id, display_id: p.display_id, type: p.type, name: p.name }]),
  );
  const stats = { newParts: 0 };

  /**
   * Resolve (and cache) the full ancestry for a leaf part. Returns the leaf's
   * `parts` document shape: { _id, ancestry, product_id, product_name, ... } or null.
   */
  const resolveLeaf = async (leafDon) => {
    if (!leafDon) return null;
    const existing = partsById.get(leafDon);
    if (existing?.ancestry?.length) return existing;

    const chain = await resolvePartAncestry(leafDon, {
      fetchObjectLinks: (don) => withRetry(() => devrevFetchObjectLinks(don)),
      fetchPart: (id) => withRetry(() => devrevFetchPart(id)),
      partMetaCache,
    });
    if (!chain.length) return null;

    const product = chain[0];
    const ancestryDons = chain.map((n) => n.id);

    // Upsert EVERY node in the chain — each with its own ancestry prefix — so the
    // whole hierarchy is materialised, not just the leaf.
    const bulk = chain.map((node, i) => {
      const doc = {
        _id: node.id,
        display_id: node.display_id,
        type: node.type,
        name: node.name,
        parent_id: i > 0 ? chain[i - 1].id : null,
        product_id: product.id,
        product_name: product.name,
        ancestry: ancestryDons.slice(0, i + 1),
        updated_at: new Date(),
      };
      if (!partsById.has(node.id)) stats.newParts++;
      partsById.set(node.id, doc);
      return {
        updateOne: { filter: { _id: node.id }, update: { $set: doc }, upsert: true },
      };
    });
    if (bulk.length) await Part.bulkWrite(bulk);

    return partsById.get(leafDon);
  };

  return { partsById, resolveLeaf, stats };
};

/**
 * resolveWorkPartFields — given a DevRev ticket work object, produce the part-field
 * patch to $set on its analyticstickets row, resolving ancestry cache-first.
 *
 * Reads `applies_to_part` straight off the work (works.list usually includes it). If
 * it's absent, falls back to a per-ticket works.get so a ticket never goes untagged
 * just because the list endpoint trimmed the field. Returns the "" sentinel when a
 * ticket genuinely has no part (so it isn't reprocessed forever).
 *
 * Shared by runPartsSync (backfill) AND the daily historical sync, so part tagging is
 * identical in both paths.
 *
 * @returns {{applies_to_part_id, product_id, product_name, ancestry, _viaWorksGet}}
 */
export const resolveWorkPartFields = async (work, ctx) => {
  let partId = work?.applies_to_part?.id || null;
  let viaWorksGet = false;
  if (!partId && (work?.display_id || work?.id)) {
    try {
      const full = await withRetry(() => devrevFetchWorkItem(work.display_id || work.id));
      partId = full?.applies_to_part?.id || null;
      viaWorksGet = true;
    } catch {
      /* leave untagged — a later run will retry */
    }
  }
  if (!partId) {
    return { applies_to_part_id: "", product_id: null, product_name: null, ancestry: [], _viaWorksGet: viaWorksGet };
  }
  let leaf = null;
  try {
    leaf = await ctx.resolveLeaf(partId);
  } catch {
    /* couldn't resolve chain now; product_id stays null so a future run retries */
  }
  return {
    applies_to_part_id: partId,
    product_id: leaf?.product_id || null,
    product_name: leaf?.product_name || null,
    ancestry: leaf?.ancestry || [],
    _viaWorksGet: viaWorksGet,
  };
};

// ─────────────────────────────────────────────────────────────────────────
// 3. THE DAILY SYNC (idempotent, resumable, rate-limit aware)
// ─────────────────────────────────────────────────────────────────────────

/**
 * runPartsSync — backfill / on-demand: tag tickets with their part ancestry and warm
 * the `parts` hierarchy cache.
 *
 * HOW: paginates `works.list?type=ticket` (the SAME source the historical sync uses —
 * full work objects that include `applies_to_part`), resolves each ticket's ancestry
 * cache-first, and updates the matching analyticstickets row's part fields. Tickets
 * not present in analyticstickets (active / pre-cutoff) are no-ops here — their parts
 * still get cached for when they're later solved and ingested into analyticstickets.
 *
 * IDEMPOTENT/RESUMABLE: uses plain updateOne (no upsert), so re-running only refreshes
 * the same rows; a crash just means the next run re-walks (mostly cache hits). NO Slack.
 *
 * @param {object} opts
 *   @param {number} [opts.maxTickets]  stop after processing this many works — use a
 *                                       small value (e.g. 100) for a validated batch.
 * @returns {Promise<{processed,tagged,viaWorksGet,newParts,errors,lastRun}>}
 */
export const runPartsSync = async ({ maxTickets = null } = {}) => {
  const startedAt = new Date();
  const stats = { processed: 0, tagged: 0, viaWorksGet: 0, newParts: 0, errors: 0 };
  // Match historical-sync's lower bound so we don't page into ancient tickets.
  const TARGET_DATE = new Date("2026-01-01");
  logger.info({ maxTickets }, "[parts-sync] starting");

  const ctx = await createPartContext();

  let cursor = null;
  let loop = 0;
  let stop = false;
  do {
    let res;
    try {
      res = await fetchWithRetry(
        `${DEVREV_API}/works.list?limit=50&type=ticket${cursor ? `&cursor=${cursor}` : ""}`,
        { headers: HEADERS, timeout: 60000 },
      );
    } catch (err) {
      stats.errors++;
      logger.error({ err: err?.message }, "[parts-sync] works.list page failed");
      break;
    }
    const works = res.data.works || [];
    if (!works.length) break;

    // Stop once we've paged past the cutoff (works.list is newest-first).
    const lastCreated = works[works.length - 1]?.created_date;
    if (lastCreated && new Date(lastCreated) < TARGET_DATE) stop = true;

    const ops = [];
    for (const t of works) {
      if (maxTickets && stats.processed >= maxTickets) {
        stop = true;
        break;
      }
      stats.processed++;
      try {
        const fields = await resolveWorkPartFields(t, ctx);
        if (fields._viaWorksGet) stats.viaWorksGet++;
        delete fields._viaWorksGet;
        ops.push({
          updateOne: { filter: { ticket_id: t.display_id }, update: { $set: fields } },
        });
      } catch (err) {
        stats.errors++;
        logger.warn({ ticket: t.display_id, err: err?.message }, "[parts-sync] tag failed");
      }
    }

    if (ops.length) {
      // ordered:false → one bad row doesn't abort the batch.
      const r = await AnalyticsTicket.bulkWrite(ops, { ordered: false });
      stats.tagged += (r.modifiedCount || 0) + (r.upsertedCount || 0);
    }
    stats.newParts = ctx.stats.newParts;

    cursor = res.data.next_cursor;
    loop++;
  } while (cursor && !stop && loop < 1000);

  // ── Persist last-run + invalidate the cached default tree ──
  await SyncMetadata.updateOne(
    { key: PARTS_LAST_SYNC_KEY },
    { $set: { value: startedAt.toISOString(), updated_at: new Date() } },
    { upsert: true },
  );
  await redisDelete(TREE_CACHE_KEY).catch(() => {});

  const result = { ...stats, lastRun: startedAt.toISOString() };
  logger.info(result, "[parts-sync] done");
  return result;
};
