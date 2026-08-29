/**
 * Ticket dependencies — which linked NOC tasks / ISS issues block a ticket,
 * and which team owns each of them.
 *
 * MOVED OUT OF controllers/ticketController.js. The handler was 170 lines of
 * cache strategy and DevRev fan-out with two lines of HTTP at the ends; the
 * caching rationale below is the most load-bearing comment in the backend and
 * it was buried in a controller. Only the request parsing and the response
 * call stayed behind.
 *
 * The logic below is unchanged.
 */

import { redisHMGet, redisMGet, redisMSet } from "../lib/cache.js";
import {
  fetchTicketLinks,
  fetchWorkItem,
  fetchWorkItems,
  dependencyCounterpart,
  classifyLinkedWorkTeam,
} from "./devrevApi.js";
import logger from "../config/logger.js";

// ── Dependency cache ─────────────────────────────────────────────────────
// This endpoint was, by a wide margin, the heaviest thing running on Render —
// and it had no cache at all. Every call issued a live DevRev links.list per
// ticket, plus works.get enrichment for each linked item.
//
// The client side made that expensive: the dashboard holds ~814 active
// tickets, treats a dependency entry as stale after 1h, and batches 50 ids per
// request. So each open dashboard fired ~17 requests covering ~814 live
// links.list calls every hour — and because nothing was shared server-side,
// 60 users meant 60× that for identical data.
//
// Caching per TICKET (not per batch) is the important detail: batches are
// arbitrary client-side slices, so a batch-level key would almost never be
// reused, while ticket-level entries are shared across every user and every
// differently-sliced batch.
//
// INVALIDATION IS BY modified_date, NOT BY A TIMER.
// Linking a NOC task / ISS to a ticket mutates the TICKET — DevRev bumps its
// modified_date and fires a webhook, which re-syncs it into tickets:active(:hash).
// So the ticket's own modified_date is an exact change signal for "might this
// ticket's dependencies differ now?", and we already have it cached per ticket.
// A plain TTL would ignore that signal and re-fetch every ticket on a fixed
// clock, which is precisely the waste that made this endpoint the heaviest
// thing on the box.
//
// Entries therefore store the modified_date they were computed against; a
// mismatch is a miss. Steady state (nothing changed) costs ZERO DevRev calls.
//
// DEP_CACHE_TTL is only a BACKSTOP, not the invalidation mechanism. It covers
// the one case modified_date can't see: the LINKED ISS changing owner/stage/
// team without the ticket itself being touched. Those fields are displayed and
// filtered on, so they can't drift indefinitely — 6h bounds it while still
// collapsing virtually all traffic.
const DEP_CACHE_TTL = 6 * 3600;
const depCacheKey = (ticketId) => `dep:v2:${ticketId}`;

/**
 * Resolve dependencies for a batch of numeric ticket ids (no "TKT-" prefix).
 * Returns a plain object keyed by id. Never throws for a single bad ticket —
 * that entry carries an `error` instead and is deliberately left uncached so
 * the next request retries it.
 */
export const resolveDependencies = async (ticketIds) => {
    const results = {};
    const BATCH_SIZE = 5;

    // Current modified_date per ticket, straight from the per-ticket hash the
    // sync/webhook already maintain. One HMGET, no DevRev involvement. Ids
    // arrive numeric (the client strips "TKT-"), the hash is keyed by display_id.
    const mtimes = await redisHMGet(
      "tickets:active:hash",
      ticketIds.map((id) => `TKT-${id}`),
    );

    const cached = await redisMGet(ticketIds.map(depCacheKey));
    const toFetch = [];
    let staleHits = 0;
    for (const id of ticketIds) {
      const hit = cached.get(depCacheKey(id));
      const currentMtime = mtimes.get(`TKT-${id}`)?.modified_date ?? null;
      // Unknown current mtime (ticket not in the hash — solved, or a cold
      // cache) means we cannot prove the entry is current. Trust the entry
      // anyway: the backstop TTL still bounds it, and refetching every ticket
      // whenever the hash is cold would reproduce the original stampede.
      if (hit && (currentMtime === null || hit._mtime === currentMtime)) {
        const { _mtime, ...data } = hit;
        results[id] = data;
        continue;
      }
      if (hit) staleHits++;
      toFetch.push(id);
    }
    if (toFetch.length) {
      logger.info(
        {
          requested: ticketIds.length,
          cacheHits: ticketIds.length - toFetch.length,
          staleByMtime: staleHits,
          fetching: toFetch.length,
        },
        "Dependencies batch",
      );
    }

    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE);

      // Step 1: Fetch all links for this batch of tickets in parallel
      const batchLinks = await Promise.all(
        batch.map(async (ticketId) => {
          try {
            const links = await fetchTicketLinks(ticketId);
            return { ticketId, links };
          } catch (e) {
            logger.warn({ err: e.message, ticketId }, "Failed to fetch links for ticket");
            results[ticketId] = { hasDependency: false, issues: [], error: e.message };
            return { ticketId, links: [] };
          }
        }),
      );

      // Step 2: Pick the dependency counterpart of every link — issues, plus
      // UCMR-synced tickets and TAM tasks / custom objects — deduped per
      // ticket and across the batch (Sets keep the dedup O(1) per check).
      const depsByTicket = new Map();
      const allIssueIdSet = new Set();
      for (const { ticketId, links } of batchLinks) {
        const seen = new Set();
        const deps = [];
        for (const link of links) {
          const counterpart = dependencyCounterpart(link, ticketId);
          if (!counterpart || seen.has(counterpart.display_id)) continue;
          seen.add(counterpart.display_id);
          deps.push({ displayId: counterpart.display_id, snapshot: counterpart });
        }
        depsByTicket.set(ticketId, deps);
        for (const { displayId } of deps) {
          // Custom objects (e.g. TAM tasks) aren't works — works.get would
          // fail on them, so only real work items get the enrichment fetch;
          // everything else renders from the links.list snapshot.
          if (/^(ISS|TKT|TASK)-/i.test(displayId)) allIssueIdSet.add(displayId);
        }
      }
      const allIssueIds = [...allIssueIdSet];

      // Step 3: Single batch fetch for all linked issues (replaces N separate works.get calls)
      let issueMap = new Map();
      if (allIssueIds.length > 0) {
        try {
          issueMap = await fetchWorkItems(allIssueIds);
        } catch (e) {
          logger.warn({ err: e.message, issueCount: allIssueIds.length }, "Batch fetch of linked work items failed, falling back to individual fetches");
          // Fallback: fetch individually so partial data is still returned
          for (const id of allIssueIds) {
            try {
              const work = await fetchWorkItem(id);
              if (work) issueMap.set(id, work);
            } catch (innerErr) {
              logger.warn({ err: innerErr.message, targetId: id }, "Failed to fetch linked work item individually");
            }
          }
        }
      }

      // Step 4: Assemble results for each ticket using the pre-fetched issue map
      for (const { ticketId } of batchLinks) {
        if (results[ticketId]) continue; // already set (e.g. link-fetch error)
        const deps = depsByTicket.get(ticketId) || [];

        if (deps.length === 0) {
          results[ticketId] = { hasDependency: false, issues: [] };
          continue;
        }

        const issues = deps.map(({ displayId, snapshot }) => {
          // Custom objects and failed fetches fall back to the links.list
          // snapshot, which already carries owner/stage/title.
          const work = issueMap.get(displayId) || snapshot;
          const customFields = work.custom_fields || {};
          return {
            issueId: displayId,
            title: work.title,
            owner: work.owned_by?.[0]?.display_name || "Unassigned",
            team: classifyLinkedWorkTeam(work, snapshot),
            isNOC: customFields.ctype__issuetype === "PSN Task",
            jiraKey: customFields.ctype__key,
            priority: work.priority_v2?.label || work.priority,
            stage: work.stage?.name,
            // Feeds the Attention Queue on-hold rule (linked ISS age ≥7d)
            createdDate: work.created_date || snapshot?.created_date || null,
          };
        }).filter(Boolean);

        const sorted = [...issues].sort((a, b) => {
          if (a.isNOC && !b.isNOC) return -1;
          if (!a.isNOC && b.isNOC) return 1;
          return 0;
        });

        results[ticketId] = {
          hasDependency: true,
          issues: sorted,
          primary: sorted.find((i) => i.isNOC) || sorted[0],
        };
      }
    }

    // Persist only what we just computed, and only when it's trustworthy.
    // Entries carrying `error` came from a failed links.list — caching those
    // would pin a transient DevRev blip as "no dependencies" for a full hour
    // across every user. They stay uncached so the next request retries.
    if (toFetch.length) {
      const writes = toFetch
        .filter((id) => results[id] && !results[id].error)
        .map((id) => [
          depCacheKey(id),
          // Stamp the modified_date this was computed against — that stamp is
          // what the next request compares to decide hit vs. stale.
          { ...results[id], _mtime: mtimes.get(`TKT-${id}`)?.modified_date ?? null },
          DEP_CACHE_TTL,
        ]);
      await redisMSet(writes);
    }

  return results;
};
