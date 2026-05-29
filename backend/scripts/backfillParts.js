/**
 * backfillParts.js — one-off / on-demand backfill of ticket part ancestry.
 *
 * Resolves the DevRev part chain for tickets that aren't tagged yet and warms the
 * `parts` hierarchy cache. Safe to re-run: runPartsSync only touches untagged tickets,
 * so an interrupted run resumes cleanly on the next invocation. Emits NO Slack alerts.
 *
 * USAGE:
 *   node scripts/backfillParts.js              # validated batch — newest 100 tickets
 *   node scripts/backfillParts.js --max=250    # newest 250 tickets
 *   node scripts/backfillParts.js --max=all    # full backfill (heavy; run off-hours)
 *
 * Recommended flow (matches "small validated batch first"):
 *   1. Run with the default 100, spot-check the `parts` collection + a few tickets'
 *      ancestry against DevRev.
 *   2. Once correct, run with --max=all to backfill everything.
 */
import "../config/env.js";
import process from "process";
import { connectMongoDB, initRedis } from "../config/database.js";
import { runPartsSync } from "../services/partsService.js";
import logger from "../config/logger.js";

const arg = process.argv.find((a) => a.startsWith("--max="));
const rawMax = arg ? arg.split("=")[1] : "100";
const maxTickets = rawMax === "all" ? null : Math.max(1, parseInt(rawMax, 10) || 100);

const run = async () => {
  await connectMongoDB();
  try {
    await initRedis();
  } catch (err) {
    // Redis powers the active-ticket portion of the tree. Without it the backfill
    // still tags solved tickets + builds the hierarchy; active counts just stay empty.
    logger.warn({ err: err?.message }, "[backfill-parts] Redis unavailable — active-ticket tagging will be skipped");
  }

  logger.info({ maxTickets: maxTickets ?? "all" }, "[backfill-parts] starting");
  const result = await runPartsSync({ maxTickets });
  logger.info(result, "[backfill-parts] complete");
  process.exit(0);
};

run().catch((err) => {
  logger.fatal({ err }, "[backfill-parts] failed");
  process.exit(1);
});
