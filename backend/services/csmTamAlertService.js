/**
 * csmTamAlertService.js — Daily stale-ticket DMs to each account's CSM & TAM.
 *
 * WHAT: Every weekday at 11:00 IST, each CSM and TAM gets ONE Slack DM listing
 * their accounts' open / pending / on-hold tickets older than STALE_DAYS —
 * grouped account-wise, only their own accounts (Rohan 2026-08-13).
 *
 * DATA SOURCE: the Redis live cache (tickets:active) — since 2026-08-01 it
 * holds ALL active tickets, so no DevRev works.list calls are needed here.
 * Per-ticket fields (see trimTicket in syncService.js):
 *   - CSM:  custom_fields.tnt__csm_email_id  → a real email, used directly.
 *   - TAM:  custom_fields.tnt__tam           → a DISPLAY NAME ONLY. DevRev has
 *     no TAM-email field on tickets, and CleverTap emails are not guessable
 *     from names ("avinash@" but "riya.rathor@" — verified 2026-08-13), so TAM
 *     names are resolved through the DevRev dev-users directory (below).
 *
 * DELIVERY: through an n8n webhook (CSM_TAM_N8N_WEBHOOK_URL), same pattern as
 * the Attention Queue. The backend has NO Slack bot token — n8n's bot does
 * users.lookupByEmail → chat.postMessage(user_id). Contract in
 * docs/CSM_TAM_ALERTS_N8N_SETUP.md. No URL configured → sweep runs but every
 * send is skipped with a warn (dry runs still work).
 *
 * IDEMPOTENCY: one Redis marker per recipient per IST day. The attention
 * queue this job rides on has attempts:2 — without the marker a retry after a
 * partial send would double-DM everyone already messaged.
 *
 * TESTING (Rohan 2026-08-13: no Slack sends he didn't trigger himself):
 * POST /api/admin/csm-tam-alerts with { dryRun: true } returns the rendered
 * messages without touching Slack; { testEmail: "you@..." } reroutes every DM
 * to that address instead of the real recipients.
 */

import axios from "axios";
import { redisGet, redisSet } from "../config/database.js";
import { DEVREV_API, HEADERS, fetchWithRetry } from "./devrevApi.js";
import { bucketForStage } from "./reconcileService.js";
import { istTodayYmd } from "../config/constants.js";
import logger from "../config/logger.js";

const STALE_DAYS = 15;
const MAX_TICKETS_PER_ACCOUNT = 10; // per DM; overflow is summarized, never silently dropped
const BUCKET_LABELS = { open: "Open", pending: "Pending", onHold: "On Hold" };
const TICKET_URL = (displayId) => `https://app.devrev.ai/clevertapsupport/works/${displayId}`;

// cache carries recently-solved tickets too (see reconcileService) — skip them
const isSolvedStage = (stageName) => {
  const s = (stageName || "").toLowerCase();
  return s.includes("solved") || s.includes("closed") || s.includes("resolved");
};

const normName = (name) => (name || "").toLowerCase().trim().replace(/\s+/g, " ");

const firstName = (name) => {
  const n = (name || "").trim();
  return n ? n.split(/\s+/)[0] : "there";
};

// ── DevRev dev-user directory (TAM name → email) ─────────────────────────
// tnt__tam is a display name; dev-users.list is the only reliable name→email
// source (3.3k users ≈ 34 paginated calls). Cached 24h so the daily cron pays
// the crawl once and manual test runs reuse it. ~200KB JSON — negligible next
// to the multi-MB tickets:active blob under the same Valkey cap.
const DEV_USER_DIR_KEY = "csmtam:devusers";
const DEV_USER_DIR_TTL = 24 * 3600;
const DEV_USER_PAGE_CAP = 60; // 6k users — far above the ~3.3k directory; a cap hit is logged

const loadDevUserDirectory = async () => {
  const cached = await redisGet(DEV_USER_DIR_KEY);
  if (cached?.byName && Object.keys(cached.byName).length) return cached;

  const byName = {}; // normalized display/full name → email
  const byEmail = {}; // email → display name (greeting for CSMs whose tnt__csm is a don: id)
  let cursor = null;
  let pages = 0;
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetchWithRetry(`${DEVREV_API}/dev-users.list?${params}`, { headers: HEADERS });
    for (const u of res.data?.dev_users || []) {
      if (!u.email) continue;
      const email = u.email.toLowerCase();
      for (const name of [u.display_name, u.full_name]) {
        const key = normName(name);
        if (key && !byName[key]) byName[key] = email;
      }
      if (!byEmail[email]) byEmail[email] = u.full_name || u.display_name || "";
    }
    cursor = res.data?.next_cursor || null;
    pages++;
  } while (cursor && pages < DEV_USER_PAGE_CAP);
  if (cursor) logger.error({ pages }, "dev-user directory page cap hit — TAM resolution may be incomplete");

  const dir = { byName, byEmail };
  await redisSet(DEV_USER_DIR_KEY, dir, DEV_USER_DIR_TTL);
  logger.info({ users: Object.keys(byEmail).length, pages }, "dev-user directory refreshed");
  return dir;
};

// ── Message rendering ─────────────────────────────────────────────────────
const bucketSummary = (entries) => {
  const counts = { open: 0, pending: 0, onHold: 0 };
  for (const e of entries) counts[e.bucket]++;
  return ["open", "pending", "onHold"]
    .filter((b) => counts[b])
    .map((b) => `${counts[b]} ${BUCKET_LABELS[b].toLowerCase()}`)
    .join(", ");
};

const truncate = (s, n) => ((s || "").length > n ? `${s.slice(0, n - 1)}…` : s || "");

const renderMessage = (greetName, accounts) => {
  const lines = [
    `Hey ${firstName(greetName)} 👋 — the following accounts have *open / pending / on-hold tickets older than ${STALE_DAYS} days*:`,
    "",
  ];
  const sorted = [...accounts.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [account, entries] of sorted) {
    lines.push(`*${account}* — ${bucketSummary(entries)}`);
    const shown = [...entries].sort((a, b) => b.ageDays - a.ageDays).slice(0, MAX_TICKETS_PER_ACCOUNT);
    for (const e of shown) {
      lines.push(`• <${e.url}|${e.display_id}> — ${BUCKET_LABELS[e.bucket]}, ${e.ageDays}d — ${truncate(e.title, 70)}`);
    }
    if (entries.length > shown.length) lines.push(`_…and ${entries.length - shown.length} more on this account_`);
    lines.push("");
  }
  lines.push(`_Automated daily check (Mon–Fri 11:00 IST) · GST Support Dashboard_`);
  return lines.join("\n");
};

// ── Delivery ──────────────────────────────────────────────────────────────
const sentMarkerKey = (email) => `csmtam:sent:${istTodayYmd()}:${email}`;

const postDm = async ({ email, name, text }) => {
  const url = process.env.CSM_TAM_N8N_WEBHOOK_URL;
  if (!url) {
    logger.warn({ email }, "CSM_TAM_N8N_WEBHOOK_URL not set — DM skipped");
    return false;
  }
  // n8n: users.lookupByEmail(email) → chat.postMessage(user_id, text).
  // Non-2xx (email not in the Slack workspace) throws here → logged by the
  // caller, no sent-marker written, so the recipient is retried next run.
  await axios.post(url, { kind: "csm_tam_stale_dm", email, name, text }, { timeout: 20000 });
  return true;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Sweep ─────────────────────────────────────────────────────────────────
/**
 * @param {Object} opts
 * @param {boolean} opts.dryRun    build + render everything, send nothing;
 *                                 rendered messages come back in the report.
 * @param {string}  opts.testEmail reroute EVERY DM to this address (real
 *                                 recipients untouched, no sent-markers).
 * @param {string}  opts.only      scope the run to ONE recipient, matched by
 *                                 email or display name (e.g. "Avinash Kalani").
 *                                 Composes with dryRun/testEmail for previews.
 * @returns run report — counts, unresolved TAM names, skipped tickets.
 */
export const runCsmTamAlertSweep = async ({ dryRun = false, testEmail = null, only = null } = {}) => {
  const tickets = (await redisGet("tickets:active")) || [];
  if (!tickets.length) {
    throw new Error("CSM/TAM alert sweep: tickets:active cache empty — retry after a live sync");
  }

  const cutoff = Date.now() - STALE_DAYS * 24 * 3600 * 1000;
  const stale = tickets.filter((t) => {
    const stageName = t.stage?.name || "";
    if (isSolvedStage(stageName)) return false;
    if (bucketForStage(stageName) === "other") return false; // New/queued/etc — not the 3 buckets
    const created = Date.parse(t.created_date || "");
    return Number.isFinite(created) && created < cutoff;
  });

  // recipients: email → { name, accounts: Map(account → [ticket entries]) }.
  // Keyed by email so someone who is CSM on one account and TAM on another
  // gets ONE DM covering both.
  const recipients = new Map();
  const addRecipient = (email, name, account, entry) => {
    if (!recipients.has(email)) recipients.set(email, { name, accounts: new Map() });
    const r = recipients.get(email);
    if (!r.name && name) r.name = name;
    if (!r.accounts.has(account)) r.accounts.set(account, []);
    r.accounts.get(account).push(entry);
  };

  // Directory is only needed when a stale ticket actually has a TAM/CSM,
  // but the sweep is daily and the crawl is cached — load unconditionally.
  const dir = await loadDevUserDirectory();

  const unresolvedTams = new Set();
  let noCsmEmail = 0;
  for (const t of stale) {
    const cf = t.custom_fields || {};
    const account = cf.tnt__instance_account_name || t.account || "Unknown";
    const entry = {
      display_id: t.display_id,
      title: t.title,
      bucket: bucketForStage(t.stage?.name),
      ageDays: Math.floor((Date.now() - Date.parse(t.created_date)) / 86400000),
      url: TICKET_URL(t.display_id),
    };

    const csmEmail = (cf.tnt__csm_email_id || "").trim().toLowerCase();
    if (csmEmail) {
      // tnt__csm is sometimes a "don:identity:…" id, not a name — greet from
      // the directory (email → full name) and only trust tnt__csm as fallback.
      const csmName = dir.byEmail[csmEmail] || (String(cf.tnt__csm || "").startsWith("don:") ? "" : cf.tnt__csm);
      addRecipient(csmEmail, csmName, account, entry);
    } else {
      noCsmEmail++;
    }

    const tamName = (cf.tnt__tam || "").trim();
    if (tamName) {
      const tamEmail = dir.byName[normName(tamName)];
      if (tamEmail) addRecipient(tamEmail, tamName, account, entry);
      else unresolvedTams.add(tamName);
    }
  }

  if (unresolvedTams.size) {
    logger.warn({ tams: [...unresolvedTams] }, "TAM names with no dev-user email match — their DMs skipped");
  }

  // `only` — scope to a single recipient for targeted tests ("show me what
  // Avinash would get"). Matched by email OR display name, case-insensitive.
  if (only) {
    const needle = only.toLowerCase().trim();
    for (const [email, r] of recipients) {
      if (email !== needle && normName(r.name) !== normName(only)) recipients.delete(email);
    }
    if (!recipients.size) {
      logger.warn({ only }, "CSM/TAM sweep: `only` matched no recipient with stale tickets");
    }
  }

  const messages = [];
  let sent = 0;
  let alreadySentToday = 0;
  for (const [email, r] of recipients) {
    const text = renderMessage(r.name || dir.byEmail[email] || email.split("@")[0], r.accounts);
    messages.push({ email, name: r.name, accountCount: r.accounts.size, text });
    if (dryRun) continue;

    if (testEmail) {
      // Test mode: reroute to the tester, no sent-marker so re-tests always fire.
      const header = `⚠️ *TEST* — this would have been DM'd to ${r.name || email} <${email}>\n\n`;
      try {
        if (await postDm({ email: testEmail, name: r.name, text: header + text })) sent++;
      } catch (e) {
        logger.error({ err: e.message, intendedFor: email }, "CSM/TAM test DM failed");
      }
      await sleep(300);
      continue;
    }

    if (await redisGet(sentMarkerKey(email))) {
      alreadySentToday++;
      continue;
    }
    try {
      if (await postDm({ email, name: r.name, text })) {
        await redisSet(sentMarkerKey(email), { sentAt: new Date().toISOString() }, 2 * 24 * 3600);
        sent++;
      }
    } catch (e) {
      logger.error({ err: e.message, email }, "CSM/TAM DM failed — will retry next run (no sent-marker)");
    }
    await sleep(300); // stay well under Slack's ~1 msg/sec posting limit
  }

  const report = {
    dryRun,
    testEmail,
    only,
    activeTickets: tickets.length,
    staleTickets: stale.length,
    recipients: recipients.size,
    sent,
    alreadySentToday,
    ticketsWithoutCsmEmail: noCsmEmail,
    unresolvedTams: [...unresolvedTams],
    ...(dryRun || testEmail ? { messages } : {}),
  };
  logger.info(report, "CSM/TAM stale-ticket sweep finished");
  return report;
};
