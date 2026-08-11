/**
 * probeQueueInternalNotes.js — one-off diagnostic (read-only, no writes).
 * For every still-pending item on recent attention queues: walk the ticket's
 * full DevRev timeline and report every dev_user comment made on/after the
 * queue's shift_date — with visibility, page number it was found on, and
 * whether the current hasDevRevInternalNote logic (5 pages, strict
 * visibility === "internal") would have caught it.
 * Run: node backend/scripts/probeQueueInternalNotes.js
 */
import "../config/env.js";
import { connectMongoDB } from "../config/database.js";
import { AttentionQueue } from "../models/index.js";
import { fetchTimelineEntries } from "../services/devrevApi.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const scanTicket = async (donId, dayStartMs) => {
  let cursor = null, pages = 0;
  const hits = [];
  let totalEntries = 0;
  do {
    const { entries, nextCursor } = await fetchTimelineEntries(donId, { cursor, limit: 100 });
    totalEntries += entries.length;
    for (const e of entries) {
      if (e.type !== "timeline_comment") continue;
      if (e.created_by?.type !== "dev_user") continue;
      if (new Date(e.created_date).getTime() < dayStartMs) continue;
      hits.push({
        page: pages + 1,
        visibility: e.visibility,
        created: e.created_date,
        author: e.created_by?.display_name,
        snippet: (e.body || "").slice(0, 60).replace(/\n/g, " "),
      });
    }
    cursor = nextCursor;
    pages++;
  } while (cursor && pages < 30);
  return { hits, pages, totalEntries };
};

const main = async () => {
  await connectMongoDB();
  const since = new Date(Date.now() - 3 * DAY_MS);
  const queues = await AttentionQueue.find({ created_at: { $gte: since } }).sort({ created_at: -1 }).lean();

  const seen = new Set();
  for (const q of queues) {
    if (seen.has(q.member)) continue; // newest queue per member only
    seen.add(q.member);
    const pending = (q.items || []).filter((i) => i.status === "pending");
    if (!pending.length) continue;
    console.log(`\n=== ${q.member} · ${q.shift_date} · status=${q.status} · pending=${pending.length} tracked=${(q.items || []).filter((i) => i.status === "partial").length}`);
    const dayStartMs = new Date(`${q.shift_date}T00:00:00+05:30`).getTime();
    for (const item of pending) {
      if (!item.ticket_id) {
        console.log(`  ${item.display_id} [${item.bucket}]  ticket_id=NULL (build predates field?)`);
        continue;
      }
      try {
        const { hits, pages, totalEntries } = await scanTicket(item.ticket_id, dayStartMs);
        if (!hits.length) {
          console.log(`  ${item.display_id} [${item.bucket}]  no dev_user comment since ${q.shift_date} (${pages}p/${totalEntries} entries)`);
          continue;
        }
        for (const h of hits) {
          const caughtByCurrent = h.visibility === "internal" && h.page <= 5;
          console.log(
            `  ${item.display_id} [${item.bucket}]  ${h.created} vis=${JSON.stringify(h.visibility)} page=${h.page}/${pages} by=${h.author}` +
            `  → current-logic-tracks=${caughtByCurrent}  "${h.snippet}"`,
          );
        }
      } catch (e) {
        console.log(`  ${item.display_id} [${item.bucket}]  timeline fetch FAILED: ${e.message}`);
      }
    }
  }
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
