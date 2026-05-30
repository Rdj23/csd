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
import { SOLVED_STATUSES } from "../config/constants.js";
import logger from "../config/logger.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Redis key holding the slim, part-tagged list of currently-ACTIVE tickets. */
const ACTIVE_PARTS_KEY = "parts:active_tickets";
/** Redis key caching the default (unfiltered) parts tree for instant first paint. */
const TREE_CACHE_KEY = "parts:tree:default";
const TREE_CACHE_TTL = 600; // 10 min — cron refreshes the underlying data daily
const ACTIVE_PARTS_TTL = 3600; // 1 hour
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

const isSolvedStage = (stageName = "") =>
  SOLVED_STATUSES.some((s) => stageName.toLowerCase().includes(s));

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
 * still get cached, and active tickets are tagged separately in PHASE C.
 *
 * IDEMPOTENT/RESUMABLE: uses plain updateOne (no upsert), so re-running only refreshes
 * the same rows; a crash just means the next run re-walks (mostly cache hits). NO Slack.
 *
 * @param {object} opts
 *   @param {number} [opts.maxTickets]  stop after processing this many works — use a
 *                                       small value (e.g. 100) for a validated batch.
 * @returns {Promise<{processed,tagged,viaWorksGet,newParts,activeTagged,errors,lastRun}>}
 */
export const runPartsSync = async ({ maxTickets = null } = {}) => {
  const startedAt = new Date();
  const stats = { processed: 0, tagged: 0, viaWorksGet: 0, newParts: 0, activeTagged: 0, errors: 0 };
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

  // ── Refresh part-tagged snapshot of active tickets (no-op without Redis) ──
  try {
    stats.activeTagged = await refreshActivePartsCache(ctx);
  } catch (err) {
    stats.errors++;
    logger.error({ err }, "[parts-sync] active refresh error");
  }

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

/**
 * refreshActivePartsCache — resolve part ancestry for the live active-ticket set and
 * store a slim, part-tagged snapshot in Redis for the tree/drilldown endpoints.
 *
 * IMPORTANT (no double-counting): the `tickets:active` cache also holds recently-SOLVED
 * tickets, which already live in analyticstickets. We keep ONLY genuinely-active stages
 * here so the tree doesn't count those tickets twice.
 */
export const refreshActivePartsCache = async (ctx = null) => {
  const active = (await redisGet("tickets:active")) || [];
  if (!Array.isArray(active) || !active.length) {
    await redisSet(ACTIVE_PARTS_KEY, [], ACTIVE_PARTS_TTL);
    return 0;
  }
  const context = ctx || (await createPartContext());
  const slim = [];

  for (const t of active) {
    const stageName = t.stage?.name || "";
    if (isSolvedStage(stageName)) continue; // already counted via analyticstickets
    if (!t.applies_to_part_id) {
      slim.push(makeActiveRow(t, null));
      continue;
    }
    let leaf = context.partsById.get(t.applies_to_part_id);
    if (!leaf?.ancestry?.length) {
      try {
        leaf = await context.resolveLeaf(t.applies_to_part_id);
      } catch {
        leaf = null;
      }
    }
    slim.push(makeActiveRow(t, leaf));
  }

  await redisSet(ACTIVE_PARTS_KEY, slim, ACTIVE_PARTS_TTL);
  return slim.length;
};

/** Reduce a live active ticket + its resolved leaf part to the slim row we cache. */
const makeActiveRow = (t, leaf) => ({
  ticket_id: t.display_id,
  display_id: t.display_id,
  title: t.title,
  account_name: t.account?.display_name || t.account || t.custom_fields?.tnt__instance_account_name || "Unknown",
  priority: t.priority || t.severity || null,
  stage_name: t.stage?.name || null,
  created_date: t.created_date || null,
  applies_to_part_id: t.applies_to_part_id || "",
  product_id: leaf?.product_id || null,
  product_name: leaf?.product_name || null,
  ancestry: leaf?.ancestry || [],
});

const getActivePartsCache = async () => {
  const cached = await redisGet(ACTIVE_PARTS_KEY);
  return Array.isArray(cached) ? cached : [];
};

// ─────────────────────────────────────────────────────────────────────────
// 4. THE READ SIDE (tree + drilldown the API serves)
// ─────────────────────────────────────────────────────────────────────────

/** Build a case-insensitive stage_name regex filter from team-vocab statuses. */
const stageFilterFromStatuses = (statuses) => {
  const subs = statuses.flatMap((s) => STATUS_STAGE_MATCHERS[s?.toLowerCase()] || []);
  if (!subs.length) return null;
  return { $in: subs.map((sub) => new RegExp(sub, "i")) };
};

/** Does a slim active row pass the same filters we apply to solved tickets? */
const activeRowMatches = (row, { priorities, statuses, accounts, dateFrom, dateTo }) => {
  if (priorities?.length && !priorities.includes(row.priority)) return false;
  if (accounts?.length && !accounts.includes(row.account_name)) return false;
  if (statuses?.length) {
    const subs = statuses.flatMap((s) => STATUS_STAGE_MATCHERS[s?.toLowerCase()] || []);
    const sn = (row.stage_name || "").toLowerCase();
    if (!subs.some((sub) => sn.includes(sub.toLowerCase()))) return false;
  }
  if (dateFrom && new Date(row.created_date) < new Date(dateFrom)) return false;
  if (dateTo && new Date(row.created_date) > new Date(dateTo)) return false;
  return true;
};

/** Translate UI filters into a Mongo match on analyticstickets (created_date based). */
const buildSolvedMatch = ({ priorities, statuses, accounts, dateFrom, dateTo }) => {
  const match = { applies_to_part_id: { $nin: [null, ""] } };
  if (dateFrom || dateTo) {
    match.created_date = {};
    if (dateFrom) match.created_date.$gte = new Date(dateFrom);
    if (dateTo) match.created_date.$lte = new Date(dateTo);
  }
  if (priorities?.length) match.priority = { $in: priorities };
  if (accounts?.length) match.account_name = { $in: accounts };
  const stageFilter = statuses?.length ? stageFilterFromStatuses(statuses) : null;
  if (stageFilter) match.stage_name = stageFilter;
  return match;
};

/**
 * buildPartsTree — assemble the nested product→capability→feature tree with ticket
 * counts ROLLED UP to every level, honoring the supplied filters.
 *
 * counts come from two cheap sources, merged: (1) a Mongo $group of analyticstickets
 * by applies_to_part_id, (2) the in-memory active snapshot. Never calls DevRev.
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

  // Active tickets created within the window.
  const active = await getActivePartsCache();
  for (const row of active) {
    if (!row.applies_to_part_id || !row.created_date) continue;
    if (!activeRowMatches(row, { ...filters, dateFrom: undefined, dateTo: undefined })) continue;
    const istKey = new Date(new Date(row.created_date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    const idx = index.get(istKey);
    if (idx === undefined) continue;
    ensure(row.applies_to_part_id)[idx] += 1;
  }
  return leafDaily;
};

export const buildPartsTree = async (filters = {}) => {
  const hasFilters =
    (filters.priorities?.length || filters.statuses?.length || filters.accounts?.length ||
      filters.dateFrom || filters.dateTo) ? true : false;

  // Serve the cached default tree for the common unfiltered case.
  if (!hasFilters) {
    const cached = await redisGet(TREE_CACHE_KEY);
    if (cached) return cached;
  }

  // 1. Solved/closed counts grouped by the leaf part.
  const grouped = await AnalyticsTicket.aggregate([
    { $match: buildSolvedMatch(filters) },
    { $group: { _id: "$applies_to_part_id", c: { $sum: 1 } } },
  ]);
  const leafCounts = new Map(); // partDon -> direct ticket count
  for (const g of grouped) if (g._id) leafCounts.set(g._id, g.c);

  // 2. Merge in genuinely-active tickets.
  const active = await getActivePartsCache();
  for (const row of active) {
    if (!row.applies_to_part_id || !activeRowMatches(row, filters)) continue;
    leafCounts.set(row.applies_to_part_id, (leafCounts.get(row.applies_to_part_id) || 0) + 1);
  }

  // 2b. Daily volume (last 14d) per leaf, for the trend sparkline/delta.
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
  const roots = parts
    .filter((p) => !p.parent_id || !partsById.has(p.parent_id))
    .map(buildNode)
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
 * to that subtree. Active (genuinely-open) tickets matching the subtree are surfaced
 * FIRST on page 1 (they're the "live" ones); solved tickets paginate after them.
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

  // Active matches (small set) — included on page 1 only.
  let activeRows = [];
  if (page === 1) {
    const active = await getActivePartsCache();
    activeRows = active.filter((row) => {
      if (!activeRowMatches(row, filters)) return false;
      if (partId === UNKNOWN_NODE_ID) return !row.ancestry?.length;
      return (row.ancestry || []).includes(partId);
    });
  }

  const toRow = (t, isActive) => ({
    ticket_id: t.ticket_id || t.display_id,
    display_id: t.display_id,
    title: t.title,
    account_name: t.account_name,
    priority: t.priority || null,
    status: t.stage_name || null,
    created_date: t.created_date,
    is_active: isActive,
    devrevUrl: buildDevrevTicketUrl(t.display_id),
  });

  const tickets = [
    ...activeRows.map((t) => toRow(t, true)),
    ...solved.map((t) => toRow(t, false)),
  ];

  return {
    tickets,
    page,
    pageSize,
    total: total + activeRows.length, // active surfaced once, on page 1
    hasMore: skip + solved.length < total,
  };
};
