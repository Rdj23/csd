/**
 * testAttentionSweep.js — dry-run the Attention Queue rules against LIVE
 * DevRev data, without Redis/Mongo. Ops tool for tuning thresholds and for
 * previewing the Slack format in the test channel.
 *
 * Usage:
 *   node scripts/testAttentionSweep.js                 # team-wide rule-match summary
 *   node scripts/testAttentionSweep.js --member Rohan  # + full queue build (ISS checks)
 *   node scripts/testAttentionSweep.js --member Rohan --post   # + post preview to Slack
 */
import "../config/env.js";
import { fetchAllActiveFromDevRev } from "../services/syncService.js";
import { resolveOwnerName, isSolvedStatus } from "../config/constants.js";
import {
  evaluateTicket,
  buildItems,
  shiftEndSummaryMessage,
  postAlert,
} from "../services/attentionService.js";

const args = process.argv.slice(2);
const memberArg = args.includes("--member") ? args[args.indexOf("--member") + 1] : null;
const doPost = args.includes("--post");

const main = async () => {
  console.log("Fetching all active tickets from DevRev…");
  const raw = await fetchAllActiveFromDevRev();
  console.log(`${raw.length} active tickets org-wide.\n`);

  const nowMs = Date.now();
  const byMember = new Map();
  for (const t of raw) {
    if (isSolvedStatus(t.stage?.name)) continue;
    const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
    if (!owner) continue;
    if (!byMember.has(owner)) byMember.set(owner, []);
    byMember.get(owner).push(t);
  }

  // Team-wide summary (cheap rules only; onHold = pre-ISS-check candidates)
  const rows = [];
  for (const [member, tickets] of byMember) {
    const counts = { open: 0, pending: 0, onHoldCandidates: 0 };
    for (const t of tickets) {
      const v = evaluateTicket(t, nowMs);
      if (!v) continue;
      if (v.bucket === "open") counts.open++;
      else if (v.bucket === "pending") counts.pending++;
      else if (v.bucket === "onHold") counts.onHoldCandidates++;
    }
    rows.push({ member, active: tickets.length, ...counts, total: counts.open + counts.pending + counts.onHoldCandidates });
  }
  rows.sort((a, b) => b.total - a.total);
  console.table(rows);

  if (!memberArg) return;

  const tickets = byMember.get(memberArg) || [];
  console.log(`\nFull queue build for ${memberArg} (${tickets.length} active tickets)…`);
  const items = await buildItems(tickets, nowMs);
  for (const i of items) {
    console.log(`  [${i.bucket}] ${i.display_id} — ${i.reason}`);
  }
  console.log(`\n${items.length} item(s) in ${memberArg}'s queue.`);

  if (doPost) {
    // shiftEndSummaryMessage handles all variants (congrats / tracked-only /
    // actionable) off item statuses — fresh buildItems output is all "pending".
    const text = shiftEndSummaryMessage([{ member: memberArg, shift: "MANUAL TEST", shift_date: null, items }]);
    const { ok } = await postAlert({ kind: "shift_end_summary", text });
    console.log(ok ? "Posted preview to the attention Slack channel." : "Slack post failed/skipped (check ATTENTION_N8N_WEBHOOK_URL / ATTENTION_SLACK_WEBHOOK_URL).");
  }
};

main().then(() => process.exit(0)).catch((e) => { console.error(e.response?.data || e); process.exit(1); });
