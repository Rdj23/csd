/**
 * gapfillActivity.js — One-off local recovery for the Aug 5–7 2026 activity gap.
 *
 * WHY THIS EXISTS:
 * Render suspended the workspace mid-day Aug 5 (bandwidth cap), so webhook
 * ingestion and the activity crons captured nothing until Aug 7 evening.
 * The prod fullBackfill (scan every quarter ticket) OOM-killed the free
 * 512MB hybrid instance, so this script runs the SAME canonical ingestion
 * (syncTicketActivity: entry_id dedup, points, daily rollups) from a dev
 * machine — but only for tickets that could actually hold gap comments:
 *   1. Active tickets modified since the gap started (DevRev works.list)
 *   2. Tickets closed since the gap started (Mongo), minus already-synced
 *
 * Requires: .env with MONGO_URI + DEVREV_PAT. Redis is NOT needed — every
 * Redis helper degrades to null and ctx supplies owner/cohort/stage.
 *
 * Run:  node scripts/gapfillActivity.js [sinceISO]
 *       default since = 2026-08-04T18:30:00Z (Aug 5 IST midnight)
 */
import "../config/env.js";
import { connectMongoDB } from "../config/database.js";
import { streamActiveFromDevRev } from "../services/syncService.js";
import { syncTicketActivity } from "../services/activityService.js";
import { AnalyticsTicket, ActivitySyncedTicket } from "../models/index.js";
import { resolveOwnerName } from "../config/constants.js";
import mongoose from "mongoose";

const SINCE = new Date(process.argv[2] || "2026-08-04T18:30:00.000Z");
const CONCURRENCY = 4;

const main = async () => {
  await connectMongoDB();
  console.log(`Gap-fill starting — scanning tickets touched since ${SINCE.toISOString()}`);

  const tickets = [];
  const seen = new Set();

  // 1. Active tickets from DevRev, filtered to GST-owned + modified in window
  let activeTotal = 0;
  await streamActiveFromDevRev(async (works) => {
    for (const t of works) {
      activeTotal++;
      if (new Date(t.modified_date) < SINCE) continue;
      const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
      if (!owner || seen.has(t.display_id)) continue;
      seen.add(t.display_id);
      tickets.push({
        devrev_id: t.id,
        display_id: t.display_id,
        ctx: {
          owner,
          accountCohort: t.custom_fields?.tnt__account_cohort_fy_25,
          stage: t.stage?.name,
        },
      });
    }
  });
  const activeCandidates = tickets.length;

  // 2. Tickets closed during the gap (Mongo is durable — unaffected by outage)
  const closed = await AnalyticsTicket.find(
    { closed_date: { $gte: SINCE } },
    { ticket_id: 1, devrev_id: 1, owner: 1, account_cohort: 1, stage_name: 1 },
  ).lean();
  const syncedDocs = await ActivitySyncedTicket.find(
    { ticket_display_id: { $in: closed.map((t) => t.ticket_id) } },
    { ticket_display_id: 1 },
  ).lean();
  const syncedSet = new Set(syncedDocs.map((d) => d.ticket_display_id));
  for (const t of closed) {
    if (seen.has(t.ticket_id) || syncedSet.has(t.ticket_id) || !t.devrev_id) continue;
    seen.add(t.ticket_id);
    tickets.push({
      devrev_id: t.devrev_id,
      display_id: t.ticket_id,
      ctx: { owner: t.owner, accountCohort: t.account_cohort, stage: t.stage_name || "solved" },
    });
  }

  console.log(
    `Candidates: ${tickets.length} (${activeCandidates} active-modified of ${activeTotal} active total, ${tickets.length - activeCandidates} closed-in-gap)`,
  );

  let done = 0, entries = 0, failed = 0;
  for (let i = 0; i < tickets.length; i += CONCURRENCY) {
    const batch = tickets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((t) => syncTicketActivity(t.devrev_id, t.display_id, t.ctx)),
    );
    for (const r of results) {
      done++;
      if (r.status === "fulfilled") entries += r.value ?? 0;
      else failed++;
    }
    if (done % 40 < CONCURRENCY || done === tickets.length) {
      console.log(`${done}/${tickets.length} tickets | ${entries} new entries | ${failed} failed`);
    }
  }

  // Per-day verification straight from Mongo
  const rows = await mongoose.connection.db
    .collection("useractivityentries")
    .aggregate([
      { $match: { date_bucket: { $gte: "2026-08-05" } } },
      { $group: { _id: "$date_bucket", entries: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  console.log("Entries per IST day after gap-fill:");
  rows.forEach((r) => console.log(` ${r._id}: ${r.entries}`));

  await mongoose.disconnect();
  console.log("DONE");
  process.exit(0);
};

main().catch((e) => {
  console.error("Gap-fill failed:", e);
  process.exit(1);
});
