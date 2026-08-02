/**
 * verifyResponseTimestamps.js — one-off diagnostic (read-only, no DB writes).
 *
 * Question it answers: do the DevRev custom fields
 *   tnt__last_devu_message_ts  (last agent message)
 *   tnt__last_revu_message_ts  (last customer message)
 * count ONLY external (customer-visible) comments, or internal notes too?
 *
 * The Attention Queue rules define "response" as an external comment, so the
 * rule engine must read whichever source matches that definition.
 *
 * Run: node backend/scripts/verifyResponseTimestamps.js
 */
import "../config/env.js";
import axios from "axios";
import { DEVREV_API, HEADERS, fetchTimelineEntries } from "../services/devrevApi.js";

const SAMPLE_SIZE = 6;

const fetchActivePage = async () => {
  const params = new URLSearchParams({ limit: "100", type: "ticket" });
  for (const s of ["open", "in_progress"]) params.append("state", s);
  const res = await axios.get(`${DEVREV_API}/works.list?${params.toString()}`, {
    headers: HEADERS,
    timeout: 60000,
  });
  return res.data.works || [];
};

const lastCommentTimes = async (ticketDon) => {
  let cursor = null;
  const acc = {
    devAny: null, devExternal: null, devInternal: null,
    revAny: null, revExternal: null,
  };
  do {
    const { entries, nextCursor } = await fetchTimelineEntries(ticketDon, { cursor, limit: 50 });
    for (const e of entries) {
      if (e.type !== "timeline_comment") continue;
      const ts = e.created_date;
      const vis = e.visibility || "internal";
      const kind = e.created_by?.type; // dev_user | rev_user | sys_user
      const keep = (k) => { if (!acc[k] || ts > acc[k]) acc[k] = ts; };
      if (kind === "dev_user") {
        keep("devAny");
        if (vis === "internal") keep("devInternal"); else keep("devExternal");
      } else if (kind === "rev_user") {
        keep("revAny");
        if (vis !== "internal") keep("revExternal");
      }
    }
    cursor = nextCursor;
  } while (cursor);
  return acc;
};

const fmt = (ts) => (ts ? new Date(ts).toISOString().slice(0, 16) : "—");
const close = (a, b) => a && b && Math.abs(new Date(a) - new Date(b)) < 60 * 1000;

const main = async () => {
  const works = await fetchActivePage();
  const withFields = works.filter(
    (w) => w.custom_fields?.tnt__last_devu_message_ts && w.custom_fields?.tnt__last_revu_message_ts,
  );
  // Prefer tickets that actually have internal notes mixed in — those are the
  // discriminating cases. We can't know upfront, so just sample a spread.
  const sample = withFields.slice(0, SAMPLE_SIZE);
  console.log(`Active page: ${works.length} tickets, ${withFields.length} with both ts fields. Sampling ${sample.length}.\n`);

  let devMatchesExternal = 0, devMatchesAny = 0, checked = 0;
  for (const w of sample) {
    const cf = w.custom_fields;
    const t = await lastCommentTimes(w.id);
    checked++;
    if (close(cf.tnt__last_devu_message_ts, t.devExternal)) devMatchesExternal++;
    if (close(cf.tnt__last_devu_message_ts, t.devAny)) devMatchesAny++;
    console.log(
      `${w.display_id}  stage=${w.stage?.name}\n` +
      `  field devu_ts:      ${fmt(cf.tnt__last_devu_message_ts)}\n` +
      `  timeline dev ext:   ${fmt(t.devExternal)}   dev int: ${fmt(t.devInternal)}   dev any: ${fmt(t.devAny)}\n` +
      `  field revu_ts:      ${fmt(cf.tnt__last_revu_message_ts)}\n` +
      `  timeline rev any:   ${fmt(t.revAny)}\n`,
    );
  }
  console.log(`\nSummary: devu_ts matched last EXTERNAL dev comment on ${devMatchesExternal}/${checked}, matched last ANY dev comment on ${devMatchesAny}/${checked}.`);
  console.log("If EXTERNAL < ANY, the field counts internal notes too → rule engine must use timeline/Activity data instead.");
};

main().then(() => process.exit(0)).catch((e) => { console.error(e.response?.data || e); process.exit(1); });
