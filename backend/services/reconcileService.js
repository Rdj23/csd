import axios from "axios";
import { fetchAllActiveFromDevRev } from "./syncService.js";
import { redisGet } from "../config/database.js";
import { resolveOwnerName, GST_MEMBERS, GST_DEVU_MAP } from "../config/constants.js";
import { getSlackWebhookUrl } from "./slackService.js";
import { getTicketSyncQueue } from "../lib/queues.js";
import logger from "../config/logger.js";

// ── Daily active-count reconciliation ────────────────────────────────────
// Answers, per GST member and irrespective of any date range:
//   "How many open / pending / on-hold tickets does DevRev say they have,
//    and does the dashboard cache agree?"
// DevRev truth comes from the same state-filtered works.list the live sync
// uses, so a mismatch means the cache is stale (missed webhook, failed sync)
// — reconcile then auto-heals by dispatching a sync-active job. Non-roster
// owner names that LOOK like GST members are flagged as probable alias gaps
// in constants.js (the silent-drop failure mode).

/** Mirror of the dashboard's stage→bucket vocabulary (see src/utils.js STAGE_MAP). */
export const bucketForStage = (stageName) => {
  const s = (stageName || "").toLowerCase().replace(/_/g, " ");
  if (s.includes("waiting on assignee") || s.includes("open")) return "open";
  if (s.includes("awaiting customer") || s.includes("pending")) return "pending";
  if (s.includes("waiting on clevertap") || s.includes("on hold")) return "onHold";
  // "New", "queued", "Waiting on CSM", "work in progress", … — active in
  // DevRev but invisible to the dashboard's three buckets. Surfaced in the
  // report so they aren't silently uncounted.
  return "other";
};

const isSolvedStage = (stageName) => {
  const s = (stageName || "").toLowerCase();
  return s.includes("solved") || s.includes("closed") || s.includes("resolved");
};

const emptyCounts = () => ({ open: 0, pending: 0, onHold: 0, other: 0, total: 0 });

const tally = (map, owner, bucket, ticketId) => {
  if (!map[owner]) map[owner] = { ...emptyCounts(), ticketIds: new Set() };
  map[owner][bucket]++;
  map[owner].total++;
  map[owner].ticketIds.add(ticketId);
};

/**
 * Compare DevRev's live per-member active counts against the dashboard cache.
 * Returns a full report; optionally alerts Slack and dispatches a heal sync.
 */
export const reconcileActiveCounts = async ({ autoHeal = true, notifySlack = true } = {}) => {
  // 1. DevRev truth — complete non-closed set, no date window.
  const rawActive = await fetchAllActiveFromDevRev();

  const devrev = {};
  const unresolvedOwners = {};
  for (const t of rawActive) {
    const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
    if (!owner) {
      const name = t.owned_by?.[0]?.display_name || "(unowned)";
      if (!unresolvedOwners[name]) unresolvedOwners[name] = { count: 0, devuId: null };
      unresolvedOwners[name].count++;
      // Owner id is a DON like don:identity:…:devu/550 — keep the DEVU form
      // so a renamed roster member (same devu id, new display name) is a
      // DEFINITE alias gap rather than a first-name guess.
      const devuNum = t.owned_by?.[0]?.id?.match(/devu\/(\d+)/)?.[1];
      if (devuNum) unresolvedOwners[name].devuId = `DEVU-${devuNum}`;
      continue;
    }
    tally(devrev, owner, bucketForStage(t.stage?.name), t.display_id);
  }

  // 2. Dashboard side — what the live cache would show for the same question.
  const cached = (await redisGet("tickets:active")) || [];
  const dashboard = {};
  for (const t of cached) {
    if (isSolvedStage(t.stage?.name)) continue; // cache carries recently-solved too
    const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
    if (!owner) continue;
    tally(dashboard, owner, bucketForStage(t.stage?.name), t.display_id);
  }

  // 3. Diff per member per bucket, with the exact missing/extra ticket ids.
  const mismatches = [];
  const members = new Set([...GST_MEMBERS, ...Object.keys(devrev), ...Object.keys(dashboard)]);
  for (const member of members) {
    const truth = devrev[member] || { ...emptyCounts(), ticketIds: new Set() };
    const cache = dashboard[member] || { ...emptyCounts(), ticketIds: new Set() };
    const buckets = ["open", "pending", "onHold", "other"];
    const diffBuckets = buckets.filter((b) => truth[b] !== cache[b]);
    if (diffBuckets.length === 0) continue;

    mismatches.push({
      member,
      buckets: Object.fromEntries(diffBuckets.map((b) => [b, { devrev: truth[b], dashboard: cache[b] }])),
      missingFromDashboard: [...truth.ticketIds].filter((id) => !cache.ticketIds.has(id)),
      extraInDashboard: [...cache.ticketIds].filter((id) => !truth.ticketIds.has(id)),
    });
  }

  // 4. Alias gaps: an unresolved DevRev display_name that needs a new alias
  // in constants.js TEAMS. Two signals, strongest first:
  //  - DEFINITE: the owner's DEVU id belongs to a roster member (they were
  //    renamed in DevRev; display_name lookup broke, id proves identity).
  //  - POSSIBLE: first token matches a canonical name AND that member has
  //    zero resolving active tickets (their whole workload vanished — the
  //    classic rename symptom). Requiring zero avoids flagging unrelated
  //    people who merely share a first name with a roster member.
  const gstFirstNames = new Map([...GST_MEMBERS].map((n) => [n.toLowerCase(), n]));
  const possibleAliasGaps = [];
  for (const [name, info] of Object.entries(unresolvedOwners)) {
    if (info.devuId && GST_DEVU_MAP[info.devuId]) {
      possibleAliasGaps.push({ displayName: name, activeTickets: info.count, likelyMember: GST_DEVU_MAP[info.devuId], confidence: "definite (matching DEVU id)" });
      continue;
    }
    const byFirstName = gstFirstNames.get(name.split(/\s+/)[0]?.toLowerCase());
    if (byFirstName && !(devrev[byFirstName]?.total > 0)) {
      possibleAliasGaps.push({ displayName: name, activeTickets: info.count, likelyMember: byFirstName, confidence: "possible (first-name match, member has 0 resolving tickets)" });
    }
  }

  const report = {
    checkedAt: new Date().toISOString(),
    devrevActiveTotal: rawActive.length,
    cacheTicketCount: cached.length,
    perMember: Object.fromEntries(
      [...members].sort().map((m) => {
        const truth = devrev[m] || emptyCounts();
        const cache = dashboard[m] || emptyCounts();
        return [m, {
          devrev: { open: truth.open, pending: truth.pending, onHold: truth.onHold, other: truth.other, total: truth.total },
          dashboard: { open: cache.open, pending: cache.pending, onHold: cache.onHold, other: cache.other, total: cache.total },
        }];
      }),
    ),
    mismatches,
    possibleAliasGaps,
    healed: false,
  };

  if (mismatches.length === 0 && possibleAliasGaps.length === 0) {
    logger.info({ devrevActiveTotal: rawActive.length }, "Count reconciliation clean — dashboard matches DevRev for all GST members");
    return report;
  }

  logger.warn({ mismatches, possibleAliasGaps }, "Count reconciliation found discrepancies");

  // 5. Auto-heal: a mismatch with no alias gap is a stale cache — resync fixes it.
  if (autoHeal && mismatches.length > 0) {
    try {
      const queue = getTicketSyncQueue();
      if (queue) {
        await queue.add("sync-active", { source: "reconcile-heal" }, { jobId: `reconcile-heal-${Date.now()}` });
        report.healed = true;
        logger.info("Reconcile: dispatched sync-active to heal stale cache");
      }
    } catch (e) {
      logger.warn({ err: e }, "Reconcile: failed to dispatch heal sync");
    }
  }

  if (notifySlack) {
    await sendReconcileAlert(report);
  }
  return report;
};

const sendReconcileAlert = async (report) => {
  const webhook = getSlackWebhookUrl();
  if (!webhook) return;

  const lines = ["⚖️ *Daily ticket-count check: dashboard vs DevRev*"];
  for (const m of report.mismatches.slice(0, 15)) {
    const parts = Object.entries(m.buckets)
      .map(([b, v]) => `${b}: DevRev ${v.devrev} vs dashboard ${v.dashboard}`)
      .join(", ");
    lines.push(`• *${m.member}* — ${parts}`);
    if (m.missingFromDashboard.length) {
      lines.push(`   missing from dashboard: ${m.missingFromDashboard.slice(0, 10).join(", ")}${m.missingFromDashboard.length > 10 ? ` (+${m.missingFromDashboard.length - 10} more)` : ""}`);
    }
  }
  if (report.mismatches.length > 15) lines.push(`…and ${report.mismatches.length - 15} more members with mismatches`);
  for (const gap of report.possibleAliasGaps) {
    lines.push(`⚠️ Alias gap (${gap.confidence}): DevRev name "*${gap.displayName}*" (${gap.activeTickets} active tickets) doesn't resolve — likely ${gap.likelyMember}; add it to aliases in constants.js`);
  }
  if (report.healed) lines.push("🔁 Auto-heal: active-ticket resync dispatched.");

  try {
    await axios.post(webhook, { text: lines.join("\n") });
    logger.info("Reconcile Slack alert sent");
  } catch (e) {
    logger.warn({ err: e }, "Reconcile Slack alert failed");
  }
};
