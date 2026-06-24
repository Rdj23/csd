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
 */

import {
  DEVREV_API,
  HEADERS,
  fetchWithRetry,
  fetchObjectLinks as devrevFetchObjectLinks,
  fetchPart as devrevFetchPart,
  fetchWorkItem as devrevFetchWorkItem,
} from "./devrevApi.js";
import { AnalyticsTicket, Part, SyncMetadata } from "../models/index.js";
import { redisGet, redisSet, redisDelete } from "../config/database.js";
import { SOLVED_STATUSES, getQuarterDateRange, getCurrentQuarterKey } from "../config/constants.js";
import logger from "../config/logger.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Redis key caching the default (unfiltered) parts tree for instant first paint. */
const TREE_CACHE_KEY = "parts:tree:default";
const TREE_CACHE_TTL = 600; // 10 min — cron refreshes the underlying data daily
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
const STATUS_STAGE_MATCHERS = {
  open: ["waiting on assignee"],
  pending: ["awaiting customer reply"],
  "on hold": ["waiting on clevertap"],
  solved: SOLVED_STATUSES, // ["solved","closed","resolved"]
};

// ─────────────────────────────────────────────────────────────────────────
// 1. THE RESOLVER (pure, dependency-injected — unit tested)
// ─────────────────────────────────────────────────────────────────────────

/**
 * pickParentDon — given the links.list result for a part, return the DON of the
 * part it is_part_of (its immediate parent), or null at the root.
 *
 * Link shape: { link_type: "is_part_of", source: {id}, target: {id, type, ...} }.
 * For a child part, the is_part_of link has source = this part, target = parent.
 * We prefer the link whose source is the current part; failing that (some payloads
 * omit a clear source), we take the first is_part_of target that isn't ourselves.
 */
export const pickParentDon = (links, currentDon) => {
  const isPartOf = (links || []).filter((l) => l?.link_type === "is_part_of");
  for (const l of isPartOf) {
    const srcId = l.source?.id || l.source?.don;
    const tgtId = l.target?.id || l.target?.don;
    if (srcId === currentDon && tgtId && tgtId !== currentDon) return tgtId;
  }
  for (const l of isPartOf) {
    const tgtId = l.target?.id || l.target?.don;
    if (tgtId && tgtId !== currentDon) return tgtId;
  }
  return null;
};

/**
 * resolvePartAncestry — walk the is_part_of chain UP from a leaf part to its product.
 *
 * @param {string} leafPartDon  Full DON id of the part a ticket applies to.
 * @param {object} deps
 *   @param {(don:string)=>Promise<Array>} deps.fetchObjectLinks  links.list wrapper.
 *   @param {(id:string)=>Promise<object|null>} deps.fetchPart     parts.get wrapper.
 *   @param {Map<string,object>} [deps.partMetaCache]  memoizes parts.get within a run.
 * @returns {Promise<Array<{id,display_id,type,name}>>}  chain ordered ROOT→LEAF.
 *
 * The chain INCLUDES the leaf as its last element, so a feature's chain looks like
 * [product, capability, feature]. Stops when it reaches a part of type "product",
 * when no parent link exists, or at a safety depth (guards against cyclic links).
 */
export const resolvePartAncestry = async (leafPartDon, deps) => {
  const { fetchObjectLinks, fetchPart, partMetaCache } = deps;
  const chainLeafFirst = [];
  const seen = new Set();
  let currentDon = leafPartDon;
  let safety = 0;

  while (currentDon && !seen.has(currentDon) && safety < 25) {
    seen.add(currentDon);
    safety++;

    // Resolve this part's own metadata (name + level). Memoized per run.
    let meta = partMetaCache?.get(currentDon) || null;
    if (!meta) {
      let part = null;
      try {
        part = await fetchPart(currentDon);
      } catch (err) {
        logger.warn({ part: currentDon, err: err?.message }, "[parts] parts.get failed");
      }
      meta = {
        id: part?.id || currentDon,
        display_id: part?.display_id || null,
        type: (part?.type || "").toLowerCase() || null,
        name: part?.name || null,
      };
      partMetaCache?.set(currentDon, meta);
    }
    chainLeafFirst.push(meta);

    if (meta.type === "product") break; // reached the root product

    // Walk one level up via the is_part_of link.
    let links = [];
    try {
      links = await fetchObjectLinks(currentDon);
    } catch (err) {
      logger.warn({ part: currentDon, err: err?.message }, "[parts] links.list failed");
      break;
    }
    const parentDon = pickParentDon(links, currentDon);
    if (!parentDon) break; // no higher parent found
    currentDon = parentDon;
  }

  return chainLeafFirst.reverse(); // ROOT → LEAF
};

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

// ─────────────────────────────────────────────────────────────────────────
// 4. THE READ SIDE (tree + drilldown the API serves) — COLD DATA ONLY
//
// As of the cold-data migration, every read below sources EXCLUSIVELY from
// analyticstickets (solved/closed tickets, refreshed by the daily historical
// sync) + the `parts` hierarchy cache. We no longer merge the live Redis
// active-ticket set or walk DevRev at read time — that was the server-load /
// latency source. The tradeoff (accepted): pending/on-hold tickets, which only
// ever live in Redis, are not represented here; the tree shows solved volume.
// ─────────────────────────────────────────────────────────────────────────

/** Build a case-insensitive stage_name regex filter from team-vocab statuses. */
const stageFilterFromStatuses = (statuses) => {
  const subs = statuses.flatMap((s) => STATUS_STAGE_MATCHERS[s?.toLowerCase()] || []);
  if (!subs.length) return null;
  return { $in: subs.map((sub) => new RegExp(sub, "i")) };
};

/** Translate UI filters into a Mongo match on analyticstickets (created_date based). */
const buildSolvedMatch = ({ priorities, statuses, accounts, subtypes, regions, dateFrom, dateTo }) => {
  const match = { applies_to_part_id: { $nin: [null, ""] } };
  if (dateFrom || dateTo) {
    match.created_date = {};
    if (dateFrom) match.created_date.$gte = new Date(dateFrom);
    if (dateTo) match.created_date.$lte = new Date(dateTo);
  }
  if (priorities?.length) match.priority = { $in: priorities };
  if (accounts?.length) match.account_name = { $in: accounts };
  if (regions?.length) match.region = { $in: regions };
  // Match subtype case-insensitively as a substring so value variants group together.
  if (subtypes?.length) match.subtype = { $in: subtypes.map((s) => new RegExp(s, "i")) };
  const stageFilter = statuses?.length ? stageFilterFromStatuses(statuses) : null;
  if (stageFilter) match.stage_name = stageFilter;
  return match;
};

/**
 * buildPartsTree — assemble the nested product→capability→feature tree with ticket
 * counts ROLLED UP to every level, honoring the supplied filters.
 *
 * Counts come from a single cold source: a Mongo $group of analyticstickets by
 * applies_to_part_id. Never reads Redis, never calls DevRev.
 *
 * @param {object} filters  { priorities?, statuses?, accounts?, dateFrom?, dateTo? }
 * @returns {Promise<{tree, totalTickets, generatedAt}>}
 */
// ── 7-day trend signal ──────────────────────────────────────────────────
// We surface a per-part momentum signal ("is this part getting worse?"): a 7-day
// sparkline of daily ticket volume + a delta vs the prior 7 days. Computed over a
// fixed 14-day window (IST day buckets) regardless of the user's date filter, so it
// stays a stable recent-momentum read; other filters (priority/status/account) still apply.
const TREND_DAYS = 14;
const SPARK_DAYS = 7;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Build the ordered IST day keys for the trend window + a key→index lookup (0=oldest). */
const buildDayIndex = () => {
  const days = [];
  const index = new Map();
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(istNow);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const pos = TREND_DAYS - 1 - i; // oldest → 0, today → TREND_DAYS-1
    index.set(key, pos);
    days[pos] = key;
  }
  return { days, index };
};

const sumRange = (arr, start, end) => {
  let s = 0;
  for (let i = start; i < end; i++) s += arr[i] || 0;
  return s;
};

/** Map<leafPartDon, number[TREND_DAYS]> of daily ticket volume over the trend window. */
const computeLeafDaily = async (filters) => {
  const { index } = buildDayIndex();
  const since = new Date(Date.now() - TREND_DAYS * 86400000);
  // Force the fixed window; keep the non-date filters.
  const match = buildSolvedMatch({ ...filters, dateFrom: undefined, dateTo: undefined });
  match.created_date = { $gte: since };

  const rows = await AnalyticsTicket.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          part: "$applies_to_part_id",
          day: { $dateToString: { format: "%Y-%m-%d", date: "$created_date", timezone: "Asia/Kolkata" } },
        },
        c: { $sum: 1 },
      },
    },
  ]);

  const leafDaily = new Map();
  const ensure = (part) => {
    let a = leafDaily.get(part);
    if (!a) { a = new Array(TREND_DAYS).fill(0); leafDaily.set(part, a); }
    return a;
  };
  for (const r of rows) {
    const idx = index.get(r._id.day);
    if (idx === undefined || !r._id.part) continue;
    ensure(r._id.part)[idx] += r.c;
  }
  return leafDaily;
};

export const buildPartsTree = async (filters = {}, { fresh = false } = {}) => {
  const hasFilters =
    (filters.priorities?.length || filters.statuses?.length || filters.accounts?.length ||
      filters.subtypes?.length || filters.regions?.length ||
      filters.dateFrom || filters.dateTo) ? true : false;

  // Explicit refresh (the UI's Refresh button): drop the cached default tree so this
  // rebuild re-aggregates the latest cold data (post daily-sync). No DevRev / Redis
  // active walk anymore — the rebuild is a pure Mongo re-read.
  if (fresh) {
    await redisDelete(TREE_CACHE_KEY).catch(() => {});
  }

  // Serve the cached default tree for the common unfiltered case (skipped on refresh).
  if (!hasFilters && !fresh) {
    const cached = await redisGet(TREE_CACHE_KEY);
    if (cached) return cached;
  }

  // 1. Solved/closed counts grouped by the leaf part. This is the ONLY count source.
  const grouped = await AnalyticsTicket.aggregate([
    { $match: buildSolvedMatch(filters) },
    { $group: { _id: "$applies_to_part_id", c: { $sum: 1 } } },
  ]);
  const leafCounts = new Map(); // partDon -> direct ticket count
  for (const g of grouped) if (g._id) leafCounts.set(g._id, g.c);

  // 2. Daily volume (last 14d) per leaf, for the trend sparkline/delta.
  const leafDaily = await computeLeafDaily(filters);

  // 3. Load the hierarchy and roll counts up each leaf's ancestry chain.
  const parts = await Part.find().lean();
  const partsById = new Map(parts.map((p) => [p._id, p]));
  const rolled = new Map(); // partDon -> subtree total
  const direct = new Map(); // partDon -> tickets filed directly at this part
  const rolledDaily = new Map(); // partDon -> number[TREND_DAYS] subtree daily volume
  let unknownCount = 0;

  // Roll the daily arrays up each leaf's ancestry (element-wise), mirroring count rollup.
  for (const [don, daily] of leafDaily) {
    const part = partsById.get(don);
    const chain = part?.ancestry?.length ? part.ancestry : [don];
    for (const anc of chain) {
      let agg = rolledDaily.get(anc);
      if (!agg) { agg = new Array(TREND_DAYS).fill(0); rolledDaily.set(anc, agg); }
      for (let i = 0; i < TREND_DAYS; i++) agg[i] += daily[i];
    }
  }

  let totalTickets = 0;
  for (const [don, cnt] of leafCounts) {
    totalTickets += cnt;
    direct.set(don, cnt);
    const part = partsById.get(don);
    const chain = part?.ancestry?.length ? part.ancestry : null;
    if (!chain) {
      unknownCount += cnt; // ticket's part isn't in the hierarchy cache yet
      continue;
    }
    for (const anc of chain) rolled.set(anc, (rolled.get(anc) || 0) + cnt);
  }

  // 4. Assemble the nested tree from parent_id relationships.
  const childrenOf = new Map();
  for (const p of parts) {
    const key = p.parent_id || "__root__";
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(p);
  }
  const buildNode = (p) => {
    const kids = (childrenOf.get(p._id) || [])
      .map(buildNode)
      .filter((n) => n.count > 0) // hide parts with no tickets (counts roll up, so a
                                  // zero-count node has only zero-count descendants)
      .sort((a, b) => b.count - a.count); // sort by ticket count desc (requirement)
    const daily = rolledDaily.get(p._id);
    const spark = daily ? daily.slice(TREND_DAYS - SPARK_DAYS) : new Array(SPARK_DAYS).fill(0);
    // delta = volume in the last 7d minus the 7d before that.
    const delta = daily
      ? sumRange(daily, TREND_DAYS - SPARK_DAYS, TREND_DAYS) - sumRange(daily, TREND_DAYS - 2 * SPARK_DAYS, TREND_DAYS - SPARK_DAYS)
      : 0;
    return {
      id: p._id,
      display_id: p.display_id,
      type: p.type,
      name: p.name || p.display_id || "(unnamed)",
      count: rolled.get(p._id) || 0,
      directCount: direct.get(p._id) || 0,
      spark,      // number[7] daily volume (oldest → today)
      delta,      // net change vs prior 7 days
      children: kids,
    };
  };

  // Roots = products (parent_id null) plus any orphan whose parent isn't cached.
  // Drop zero-count roots too, so only parts with tickets remain.
  const roots = parts
    .filter((p) => !p.parent_id || !partsById.has(p.parent_id))
    .map(buildNode)
    .filter((n) => n.count > 0)
    .sort((a, b) => b.count - a.count);

  if (unknownCount > 0) {
    roots.push({
      id: UNKNOWN_NODE_ID,
      display_id: null,
      type: "unknown",
      name: "Unresolved / No part",
      count: unknownCount,
      directCount: unknownCount,
      children: [],
    });
  }

  const payload = { tree: roots, totalTickets, generatedAt: new Date().toISOString() };
  if (!hasFilters) await redisSet(TREE_CACHE_KEY, payload, TREE_CACHE_TTL);
  return payload;
};

/**
 * getPartTickets — paginated tickets for a part SUBTREE (the part + all descendants).
 *
 * Uses the multikey `ancestry` index: any ticket whose chain contains `partId` belongs
 * to that subtree. Cold data only — solved/closed tickets from analyticstickets,
 * newest first.
 *
 * @param {string} partId   DON id, or UNKNOWN_NODE_ID for the unresolved bucket.
 * @param {object} filters  same shape as buildPartsTree.
 * @param {object} page     { page=1, pageSize=50 }
 */
export const getPartTickets = async (partId, filters = {}, { page = 1, pageSize = 50 } = {}) => {
  const skip = (Math.max(1, page) - 1) * pageSize;
  const baseMatch = buildSolvedMatch(filters);

  // Scope to the subtree.
  if (partId === UNKNOWN_NODE_ID) {
    baseMatch.$or = [{ ancestry: { $size: 0 } }, { applies_to_part_id: { $in: [null, ""] } }];
    delete baseMatch.applies_to_part_id; // unknown bucket includes the untagged
  } else {
    baseMatch.ancestry = partId;
  }

  const [solved, total] = await Promise.all([
    AnalyticsTicket.find(baseMatch, {
      ticket_id: 1, display_id: 1, title: 1, account_name: 1,
      priority: 1, stage_name: 1, created_date: 1,
    })
      .sort({ created_date: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    AnalyticsTicket.countDocuments(baseMatch),
  ]);

  const toRow = (t) => ({
    ticket_id: t.ticket_id || t.display_id,
    display_id: t.display_id,
    title: t.title,
    account_name: t.account_name,
    priority: t.priority || null,
    status: t.stage_name || null,
    created_date: t.created_date,
    is_active: false, // cold data — every row is a solved/closed ticket
    devrevUrl: buildDevrevTicketUrl(t.display_id),
  });

  return {
    tickets: solved.map(toRow),
    page,
    pageSize,
    total,
    hasMore: skip + solved.length < total,
  };
};

/**
 * getPartsTrend — ticket-volume trend over time for a part SUBTREE (or all parts),
 * grouped daily / weekly / monthly. Powers the Parts tab's analytics-style trendline.
 *
 * Cold data only: a single $group over analyticstickets, bucketed by created_date in
 * IST so it lines up with the tree's filters and per-row sparkline. The `ancestry`
 * multikey index keeps the subtree scope index-backed. Never reads Redis / DevRev.
 *
 * @param {string|null} partId  DON id to scope to its subtree, UNKNOWN_NODE_ID for the
 *                              unresolved bucket, or null/undefined for all tagged tickets.
 * @param {object} filters      same shape as buildPartsTree.
 * @param {object} opts         { groupBy: "daily" | "weekly" | "monthly" }
 * @returns {Promise<{trend: Array<{date:string,count:number}>, groupBy:string, total:number}>}
 */
export const getPartsTrend = async (partId, filters = {}, { groupBy = "daily" } = {}) => {
  const match = buildSolvedMatch(filters);

  // Scope to the part's subtree (or the unresolved bucket) when an id is supplied.
  if (partId === UNKNOWN_NODE_ID) {
    delete match.applies_to_part_id;
    match.$or = [{ ancestry: { $size: 0 } }, { applies_to_part_id: { $in: [null, ""] } }];
  } else if (partId) {
    match.ancestry = partId;
  }

  // Default the window to the current quarter when no date range is set, so the line
  // spans something sensible (mirrors analytics' quarter scoping). An explicit
  // dateFrom/dateTo from buildSolvedMatch already wins when present.
  if (!filters.dateFrom && !filters.dateTo) {
    const { start } = getQuarterDateRange(getCurrentQuarterKey());
    match.created_date = { ...(match.created_date || {}), $gte: start };
  }

  // Same bucket formats analytics uses, so the frontend can render them identically.
  let dateFormat = "%Y-%m-%d";
  if (groupBy === "weekly") dateFormat = "%Y-W%V";
  if (groupBy === "monthly") dateFormat = "%Y-%m";

  const rows = await AnalyticsTicket.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: "$created_date", timezone: "Asia/Kolkata" } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 400 },
  ]).allowDiskUse(true);

  const trend = rows.map((r) => ({ date: r._id, count: r.count }));
  const total = trend.reduce((s, r) => s + r.count, 0);
  return { trend, groupBy, total };
};
