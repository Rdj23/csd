/**
 * backfillSubtype.js — one-off backfill of the `subtype` classification (query / bug /
 * feature) onto existing analyticstickets, so the Parts View classification filter works
 * on historical data without waiting for a full re-sync.
 *
 * Going forward, syncService tags `subtype` inline on every sync (DB upsert + live cache).
 * This script only patches rows that predate that change. It pages works.list newest-first
 * (the same source the historical sync uses) and $sets subtype on the matching ticket.
 *
 * IDEMPOTENT/RESUMABLE: plain updateOne, no upsert — re-running only refreshes the same
 * rows. Safe to interrupt; a re-run resumes from the top (mostly cheap no-op writes).
 *
 * USAGE:
 *   node scripts/backfillSubtype.js              # validated batch — newest 100 tickets
 *   node scripts/backfillSubtype.js --max=500    # newest 500 tickets
 *   node scripts/backfillSubtype.js --max=all    # full backfill (heavy; run off-hours)
 */
import "../config/env.js";
import process from "process";
import { connectMongoDB } from "../config/database.js";
import { DEVREV_API, HEADERS, fetchWithRetry } from "../services/devrevApi.js";
import { AnalyticsTicket } from "../models/index.js";
import logger from "../config/logger.js";

const arg = process.argv.find((a) => a.startsWith("--max="));
const rawMax = arg ? arg.split("=")[1] : "100";
const maxTickets = rawMax === "all" ? null : Math.max(1, parseInt(rawMax, 10) || 100);

// Match the historical sync's lower bound so we don't page into ancient tickets.
const TARGET_DATE = new Date("2026-01-01");

const run = async () => {
  await connectMongoDB();
  logger.info({ maxTickets: maxTickets ?? "all" }, "[backfill-subtype] starting");

  const stats = { processed: 0, tagged: 0, errors: 0 };
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
      logger.error({ err: err?.message }, "[backfill-subtype] works.list page failed");
      break;
    }
    const works = res.data.works || [];
    if (!works.length) break;

    // works.list is newest-first — stop once we page past the cutoff.
    const lastCreated = works[works.length - 1]?.created_date;
    if (lastCreated && new Date(lastCreated) < TARGET_DATE) stop = true;

    const ops = [];
    for (const t of works) {
      if (maxTickets && stats.processed >= maxTickets) {
        stop = true;
        break;
      }
      stats.processed++;
      // Only write rows that actually have a subtype; null stays null.
      ops.push({
        updateOne: {
          filter: { ticket_id: t.display_id },
          update: { $set: { subtype: t.subtype || null } },
        },
      });
    }

    if (ops.length) {
      // ordered:false → one bad row doesn't abort the batch.
      const r = await AnalyticsTicket.bulkWrite(ops, { ordered: false });
      stats.tagged += r.modifiedCount || 0;
    }

    logger.info(stats, "[backfill-subtype] progress");
    cursor = res.data.next_cursor;
    loop++;
  } while (cursor && !stop && loop < 1000);

  logger.info(stats, "[backfill-subtype] complete");
  process.exit(0);
};

run().catch((err) => {
  logger.fatal({ err }, "[backfill-subtype] failed");
  process.exit(1);
});
