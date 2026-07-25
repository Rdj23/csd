/**
 * inspectTicketLinks.js — READ-ONLY diagnostic. Answers two questions for a
 * ticket: (1) is it in Mongo (AnalyticsTicket), and if not, WHY the historical
 * sync would have missed it; (2) what its DevRev links look like and whether the
 * current dependency logic counts them.
 *
 * Writes nothing — safe to run anytime.
 *
 * USAGE:
 *   node scripts/inspectTicketLinks.js 315055
 *   node scripts/inspectTicketLinks.js TKT-315055
 */
import "../config/env.js";
import process from "process";
import { connectMongoDB } from "../config/database.js";
import {
  fetchTicketLinks,
  fetchWorkItem,
  dependencyCounterpart,
  classifyLinkedWorkTeam,
} from "../services/devrevApi.js";
import { AnalyticsTicket } from "../models/index.js";
import { resolveOwnerName } from "../config/constants.js";
import { classifyResolution } from "../services/syncService.js";

const raw = process.argv[2] || "315055";
const ticketId = raw.replace(/^TKT-/i, "");
const displayId = `TKT-${ticketId}`;

const TARGET_DATE = new Date("2026-01-01");
const AGENT_START_DATE = new Date("2026-03-01");

const summarize = (o) =>
  o
    ? { display_id: o.display_id, type: o.type, leaf_type: o.leaf_type, subtype: o.subtype }
    : null;

const run = async () => {
  await connectMongoDB();

  // ── 1. Is it in Mongo? ──────────────────────────────────────────────
  const inMongo = await AnalyticsTicket.findOne({ ticket_id: displayId }).lean();
  console.log(`\n=== MONGO (AnalyticsTicket) ===`);
  if (inMongo) {
    console.log(`FOUND in Mongo. closed_date=${inMongo.closed_date}, owner=${inMongo.owner}, resolved_by=${inMongo.resolved_by}`);
  } else {
    console.log(`NOT in Mongo.`);
  }

  // ── 2. Fetch live from DevRev and replay sync eligibility ───────────
  const work = await fetchWorkItem(displayId);
  console.log(`\n=== DEVREV (works.get) ===`);
  if (!work) {
    console.log(`Ticket not found in DevRev.`);
  } else {
    const closeRaw = work.actual_close_date || work.modified_date || work.created_date;
    const closedDate = new Date(closeRaw);
    const gstOwner = resolveOwnerName(work.owned_by?.[0]?.display_name || "");
    const { resolvedBy, finalOwner } = classifyResolution(work, closedDate, gstOwner);

    console.log(`stage         : ${work.stage?.name}`);
    console.log(`created_date  : ${work.created_date}`);
    console.log(`actual_close  : ${work.actual_close_date}`);
    console.log(`owner (raw)   : ${work.owned_by?.[0]?.display_name}`);
    console.log(`owner (GST)   : ${gstOwner || "(unresolved)"}`);
    console.log(`classifyResolution -> finalOwner=${finalOwner}, resolvedBy=${resolvedBy}`);

    console.log(`\n=== SYNC-ELIGIBILITY VERDICT ===`);
    const createdBeforeWindow = new Date(work.created_date) < TARGET_DATE;
    console.log(`created < 2026-01-01 (delta-sync page cutoff)? ${createdBeforeWindow}`);
    console.log(`closed  >= agent era (2026-03-01)?            ${closedDate >= AGENT_START_DATE}`);
    console.log(`would classifyResolution keep it?             ${!!finalOwner}`);
    if (!finalOwner) {
      console.log(`>>> CAUSE: no GST owner + pre-agent-era close → skipped by design.`);
    } else if (createdBeforeWindow) {
      console.log(`>>> CAUSE: created before the delta window; a delta run pages newest-CREATED first and stops on known batches, so it never reaches this old-created/recently-solved ticket. Fix: full syncHistoricalToDB(true) or targeted upsert.`);
    } else {
      console.log(`>>> Row is eligible & created in-window → likely a SKIPPED CRON RUN (whole-day gap). Fix: re-run delta syncHistoricalToDB(false), then bust caches.`);
    }
  }

  // ── 3. Dependency links ─────────────────────────────────────────────
  console.log(`\n=== links.list for ${displayId} ===`);
  const links = await fetchTicketLinks(ticketId);
  console.log(`Total links: ${links.length}`);
  links.forEach((link, i) => {
    const cp = dependencyCounterpart(link, ticketId);
    console.log(`--- link[${i}] type=${link.link_type}`);
    console.log(`   source:`, JSON.stringify(summarize(link.source)));
    console.log(`   target:`, JSON.stringify(summarize(link.target)));
    console.log(`   counts as dependency? ${cp ? `YES (${cp.display_id}, team=${classifyLinkedWorkTeam(cp)})` : "NO"}`);
  });
  const seen = new Set();
  const deps = links.map((l) => dependencyCounterpart(l, ticketId)).filter((c) => c && !seen.has(c.display_id) && seen.add(c.display_id));
  console.log(`\nhasDependency (current logic): ${deps.length > 0} [${deps.map((d) => d.display_id).join(", ")}]`);

  process.exit(0);
};

run().catch((err) => {
  console.error("inspectTicketLinks failed:", err?.response?.data || err?.message || err);
  process.exit(1);
});
