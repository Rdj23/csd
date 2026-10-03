// Validation for the reworked hasDevRevInternalNote (read-only).
// 1) scan recent active tickets for a dev_user INTERNAL comment made today (IST)
// 2) expect hasDevRevInternalNote(ticket, today) === true for those
// 3) expect false for a ticket with no dev_user comment today
import "../config/env.js";
import axios from "axios";
import { DEVREV_API, HEADERS, fetchTimelineEntries } from "../services/devrevApi.js";
import { hasDevRevInternalNote } from "../services/attentionService.js";

const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const dayStartMs = new Date(`${todayYmd}T00:00:00+05:30`).getTime();

const params = new URLSearchParams({ limit: "60", type: "ticket" });
for (const s of ["open", "in_progress"]) params.append("state", s);
const res = await axios.get(`${DEVREV_API}/works.list?${params}`, { headers: HEADERS, timeout: 60000 });
const works = res.data.works || [];

const withNote = [], withoutNote = [];
for (const w of works) {
  if (withNote.length >= 3 && withoutNote.length >= 2) break;
  // ground truth via full backward walk
  let cursor = null, found = false, pages = 0;
  do {
    const { entries, nextCursor } = await fetchTimelineEntries(w.id, { cursor, limit: 100, mode: "before" });
    let newest = null;
    for (const e of entries) {
      if (e.type !== "timeline_comment") continue;
      const t = new Date(e.created_date).getTime();
      if (!newest || t > newest) newest = t;
      if (t >= dayStartMs && (e.visibility || "internal") === "internal" && e.created_by?.type === "dev_user") found = true;
    }
    if (found || (newest && newest < dayStartMs)) break;
    cursor = nextCursor;
  } while (cursor && ++pages < 30);
  if (found && withNote.length < 3) withNote.push(w);
  else if (!found && withoutNote.length < 2) withoutNote.push(w);
}

let pass = 0, fail = 0;
for (const w of withNote) {
  const r = await hasDevRevInternalNote(w.id, todayYmd);
  console.log(`${w.display_id} has internal note today → hasDevRevInternalNote=${r} ${r ? "PASS" : "FAIL"}`);
  r ? pass++ : fail++;
}
for (const w of withoutNote) {
  const r = await hasDevRevInternalNote(w.id, todayYmd);
  console.log(`${w.display_id} no note today → hasDevRevInternalNote=${r} ${!r ? "PASS" : "FAIL"}`);
  !r ? pass++ : fail++;
}
console.log(`\n${pass} pass, ${fail} fail (found ${withNote.length} tickets with internal notes today)`);
process.exit(fail ? 1 : 0);
