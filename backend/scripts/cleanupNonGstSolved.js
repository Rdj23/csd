/**
 * cleanupNonGstSolved.js — remove solved rows that leaked into analytics from
 * NON-GST owners.
 *
 * WHY: classifyResolution used to store ANY solved ticket closed on/after the
 * agent rollout (2026-03-01) whose owner didn't resolve to a GST roster name
 * as owner="Unassigned" / resolved_by="agent" — including tickets solved by
 * non-GST humans (e.g. TKT-314228, solved by a non-roster engineer). Those
 * rows inflated every unfiltered analytics number. The classifier now keeps a
 * non-GST-owned ticket only when it was GENUINELY agent-resolved
 * (tnt__agent_resolved=true AND tnt__support_engineer_handled=false, stored
 * as agent_resolved=true); this script deletes the historical rows the new
 * rule would have skipped: owner="Unassigned" AND agent_resolved=false.
 *
 * Genuine agent resolutions (agent_resolved=true) are untouched.
 *
 * USAGE:
 *   node scripts/cleanupNonGstSolved.js            # dry-run: count + sample, no writes
 *   node scripts/cleanupNonGstSolved.js --apply    # actually delete + clear caches
 */
import "../config/env.js";
import process from "process";
import { connectMongoDB, initRedis, redisDelete } from "../config/database.js";
import { AnalyticsTicket, AnalyticsCache, PrecomputedDashboard } from "../models/index.js";

const APPLY = process.argv.includes("--apply");

const run = async () => {
  await connectMongoDB();

  const filter = { owner: "Unassigned", agent_resolved: false };
  const count = await AnalyticsTicket.countDocuments(filter);
  const sample = await AnalyticsTicket.find(filter)
    .select({ ticket_id: 1, closed_date: 1, stage_name: 1, resolved_by: 1, account_name: 1 })
    .sort({ closed_date: -1 })
    .limit(20)
    .lean();

  console.log(`Leaked non-GST solved rows (owner=Unassigned, agent_resolved=false): ${count}`);
  console.table(sample.map((t) => ({
    ticket: t.ticket_id,
    closed: t.closed_date?.toISOString().slice(0, 10),
    stage: t.stage_name,
    resolved_by: t.resolved_by,
    account: t.account_name,
  })));

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to delete these rows and clear analytics caches.");
    process.exit(0);
  }

  const res = await AnalyticsTicket.deleteMany(filter);
  console.log(`Deleted ${res.deletedCount} rows.`);

  await Promise.all([AnalyticsCache.deleteMany({}), PrecomputedDashboard.deleteMany({})]);
  console.log("Cleared AnalyticsCache + PrecomputedDashboard.");

  try {
    await initRedis();
    await Promise.all([
      redisDelete("analytics:*"),
      redisDelete("livestats:*"),
      redisDelete("bydate:*"),
      redisDelete("alltickets:*"),
    ]);
    console.log("Cleared Redis analytics/livestats/bydate/alltickets caches.");
  } catch (e) {
    console.warn("Redis cache clear skipped:", e.message);
  }

  process.exit(0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
