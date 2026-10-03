/**
 * parts/queries — The read side the Parts View endpoints serve: tree, tickets, trend.
 *
 * Extracted from the 726-line partsService.js; logic unchanged.
 * See parts/index.js for how the resolver, the sync and the read side relate.
 */

import { getCurrentQuarterKey, getQuarterDateRange } from "../../config/constants.js";
import { redisDelete, redisGet, redisSet } from "../../lib/cache.js";
import { AnalyticsTicket, Part } from "../../models/index.js";
import { STATUS_STAGE_MATCHERS, TREE_CACHE_KEY, TREE_CACHE_TTL, UNKNOWN_NODE_ID, buildDevrevTicketUrl } from "./config.js";

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
  // Priority is DevRev severity (low/medium/high/blocker), stored lowercase; match
  // case-insensitively so pretty-cased UI labels still hit.
  if (priorities?.length)
    match.priority = { $in: priorities.map((p) => new RegExp(`^${p}$`, "i")) };
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
