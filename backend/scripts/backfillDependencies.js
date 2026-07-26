/**
 * backfillDependencies.js — populate the sync-time dependency fields
 * (has_dependency / dependency_issue_ids / dependency_teams /
 * dependency_assignees) on existing AnalyticsTicket rows.
 *
 * WHY: the fields were added on 2026-07-26; the nightly delta sync only
 * touches newly-solved tickets, so every row solved before the deploy would
 * stay "Not checked" forever without this.
 *
 * Mirrors the live /api/tickets/dependencies logic exactly:
 * links.list → dependencyCounterpart → works.get → classifyLinkedWorkTeam.
 *
 * USAGE:
 *   node scripts/backfillDependencies.js                  # since 2026-07-01, unchecked rows only
 *   node scripts/backfillDependencies.js --since 2026-04-01
 *   node scripts/backfillDependencies.js --since 2026-07-01 --until 2026-07-31
 *   node scripts/backfillDependencies.js --force          # recheck rows that already have data
 *   node scripts/backfillDependencies.js --dry-run        # count + sample, no writes
 *
 * Finishes by clearing AnalyticsCache + PrecomputedDashboard so dashboards
 * recompute from the updated rows (they rebuild on demand / next cron).
 */
import "../config/env.js";
import process from "process";
import { connectMongoDB } from "../config/database.js";
import { AnalyticsTicket, AnalyticsCache, PrecomputedDashboard } from "../models/index.js";
import {
  fetchTicketLinks,
  fetchWorkItem,
  dependencyCounterpart,
  classifyLinkedWorkTeam,
} from "../services/devrevApi.js";

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SINCE = new Date(`${argValue("--since", "2026-07-01")}T00:00:00.000+05:30`);
const UNTIL = argv.includes("--until")
  ? new Date(`${argValue("--until")}T23:59:59.999+05:30`)
  : null;
const FORCE = argv.includes("--force");
const DRY_RUN = argv.includes("--dry-run");
const CONCURRENCY = 5;

const resolveTicketDependency = async (row) => {
  const numericId = (row.ticket_id || row.display_id).replace(/^TKT-/i, "");
  const links = await fetchTicketLinks(numericId);

  const seen = new Set();
  const counterparts = [];
  for (const link of links) {
    const cp = dependencyCounterpart(link, numericId);
    if (cp && !seen.has(cp.display_id)) {
      seen.add(cp.display_id);
      counterparts.push(cp);
    }
  }

  const dep = {
    has_dependency: counterparts.length > 0,
    dependency_issue_ids: [],
    dependency_teams: [],
    dependency_assignees: [],
  };
  for (const snapshot of counterparts) {
    let work = null;
    if (/^(ISS|TKT|TASK)-/i.test(snapshot.display_id)) {
      try {
        work = await fetchWorkItem(snapshot.display_id);
      } catch {
        /* enrichment failure — classify from the snapshot */
      }
    }
    const item = work || snapshot;
    dep.dependency_issue_ids.push(snapshot.display_id);
    const team = classifyLinkedWorkTeam(work, snapshot);
    if (team && !dep.dependency_teams.includes(team)) dep.dependency_teams.push(team);
    const assignee = item.owned_by?.[0]?.display_name;
    if (assignee && !dep.dependency_assignees.includes(assignee)) dep.dependency_assignees.push(assignee);
  }
  return dep;
};

const run = async () => {
  await connectMongoDB();

  const filter = { closed_date: { $gte: SINCE } };
  if (UNTIL) filter.closed_date.$lte = UNTIL;
  // {has_dependency: null} matches both null and missing — i.e. "never checked".
  if (!FORCE) filter.has_dependency = null;

  const rows = await AnalyticsTicket.find(filter, { ticket_id: 1, display_id: 1, closed_date: 1 })
    .sort({ closed_date: -1 })
    .lean();

  console.log(`Backfilling dependencies for ${rows.length} tickets (since=${SINCE.toISOString()}${UNTIL ? `, until=${UNTIL.toISOString()}` : ""}, force=${FORCE}, dryRun=${DRY_RUN})`);
  if (DRY_RUN) {
    console.log("Sample:", rows.slice(0, 10).map((r) => r.ticket_id).join(", "));
    process.exit(0);
  }

  let done = 0, withDep = 0, failed = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        try {
          const dep = await resolveTicketDependency(row);
          await AnalyticsTicket.updateOne({ _id: row._id }, { $set: dep });
          if (dep.has_dependency) withDep++;
        } catch (e) {
          failed++;
          console.warn(`  ${row.ticket_id}: FAILED (${e?.response?.status || e.message}) — left as "not checked"`);
        } finally {
          done++;
        }
      }),
    );
    if (done % 100 < CONCURRENCY || done === rows.length) {
      console.log(`  ${done}/${rows.length} processed (${withDep} with dependency, ${failed} failed)`);
    }
  }

  // Old cached dashboards were computed without dependency fields and with
  // UTC day-bucketing — drop them so the next request/cron recomputes.
  const [cacheRes, precompRes] = await Promise.all([
    AnalyticsCache.deleteMany({}),
    PrecomputedDashboard.deleteMany({}),
  ]);
  console.log(`Done. ${done} processed, ${withDep} with dependency, ${failed} failed.`);
  console.log(`Cleared ${cacheRes.deletedCount} AnalyticsCache + ${precompRes.deletedCount} PrecomputedDashboard docs.`);
  process.exit(0);
};

run().catch((err) => {
  console.error("backfillDependencies failed:", err?.response?.data || err?.message || err);
  process.exit(1);
});
