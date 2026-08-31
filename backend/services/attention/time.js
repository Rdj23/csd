/**
 * attention/time — IST calendar helpers — every attention decision is IST-relative.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import { DAY_MS } from "./config.js";

// ── IST time helpers ─────────────────────────────────────────────────────
// All shift math is done on epoch ms anchored to IST calendar days, so the
// server's own timezone never matters.

/** "YYYY-MM-DD" for a Date, in IST. */
export const istYmd = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/** Instant for `decimalHours` (7.5 = 07:30 IST) on an IST calendar day. */
export const istInstant = (ymd, decimalHours) =>
  new Date(new Date(`${ymd}T00:00:00+05:30`).getTime() + decimalHours * 3600 * 1000);

export const istTodayStartMs = () => new Date(`${istYmd()}T00:00:00+05:30`).getTime();

/**
 * An IST calendar day shifted by whole days — "YYYY-MM-DD" in, "YYYY-MM-DD"
 * out. Anchored at noon so the arithmetic can never straddle a midnight edge.
 */
export const istYmdShift = (ymd, deltaDays) =>
  istYmd(new Date(new Date(`${ymd}T12:00:00+05:30`).getTime() + deltaDays * DAY_MS));

/**
 * "YYYY-MM-DD" → the roster API's own date format, "D-MMM" ("30-Aug"): the
 * day is NOT zero-padded and the month is the en-US short name, matching how
 * gst-hub builds its default (`day: "numeric", month: "short"`) and how the
 * roster sheet keys its schedule map. Anything else misses the lookup and
 * comes back as "Data Missing".
 */
export const ymdToDMmm = (ymd) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  }).formatToParts(new Date(`${ymd}T12:00:00+05:30`));
  const part = (type) => parts.find((p) => p.type === type)?.value;
  return `${part("day")}-${part("month")}`;
};

export const ms = (v) => (v ? new Date(v).getTime() : null);
export const daysAgo = (tsMs, nowMs) => Math.floor((nowMs - tsMs) / DAY_MS);

const istWeekday = (tsMs) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(new Date(tsMs));

/** Sat/Sun on the IST calendar — the days no attention Slack may post. */
export const isWeekendIst = (tsMs) => {
  const wd = istWeekday(tsMs);
  return wd === "Sat" || wd === "Sun";
};

/**
 * Whole business days (Mon–Fri, IST calendar) elapsed from `fromMs` to
 * `nowMs`. Fri→Mon = 1: the weekend doesn't count, which is what keeps a
 * follow-up that legitimately slips over a weekend from flagging.
 */
export const businessDaysSince = (fromMs, nowMs) => {
  let count = 0;
  // Noon-IST anchor so the day-stepping loop can't straddle a midnight edge.
  let d = new Date(`${istYmd(new Date(fromMs))}T12:00:00+05:30`).getTime();
  const endYmd = istYmd(new Date(nowMs));
  while (istYmd(new Date(d)) < endYmd) {
    d += DAY_MS;
    const wd = istWeekday(d);
    if (wd !== "Sat" && wd !== "Sun") count++;
    if (count > 30) break; // ancient ticket — precision past a month is pointless
  }
  return count;
};
