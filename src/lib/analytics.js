/**
 * analytics.js — the dashboard's CleverTap event taxonomy and its safe tracker.
 *
 * WHY THIS EXISTS ON TOP OF lib/clevertap.js:
 * clevertap.js is the raw SDK adapter (init / onUserLogin / event.push). This
 * file is the *schema*. Event names and property keys are a permanent contract
 * with the CleverTap dashboard — a typo doesn't error, it creates a second
 * event that can never be merged with the first, and every segment built on
 * the old name silently stops matching. So call sites never pass raw strings;
 * they pass EV.* / PROP-shaped objects from here.
 *
 * ── THE ARRAY TRAP (the reason `track` is not just a passthrough) ─────────
 * clevertap-web-sdk validates every event with isEventStructureFlat()
 * (clevertap.js:8026). If ANY property value is an array or a nested object it
 * reports error 512 and drops **the entire event** — not just that property.
 * This dashboard's filters are all multi-select arrays, so
 *     trackEvent("Filter Applied", { Teams: ["Rohan", "Harsh"] })
 * sends nothing at all. And because the SDK wrapper swallows exceptions, you
 * get no warning either.
 *
 * So `track()` flattens at the boundary: every array becomes a sorted,
 * capped, comma-joined string PLUS a numeric `<Key> Count` companion. Sorting
 * is not cosmetic — CleverTap segments on exact string equality, so an
 * unsorted "Rohan, Harsh" and "Harsh, Rohan" would be two segments describing
 * one selection.
 *
 * ── AMBIENT CONTEXT ──────────────────────────────────────────────────────
 * Every event carries who/where automatically (Tab, Role, Team, Theme) via
 * setAnalyticsContext(), so no call site has to remember to thread them and
 * every event is segmentable by them. Call-site props always win.
 */

import { trackEvent as pushEvent } from "./clevertap";

// ═══════════════════════════════════════════════════════════════════════════
// EVENT REGISTRY — the whole taxonomy, in one place
// ═══════════════════════════════════════════════════════════════════════════
// Deliberately FEW names with RICH properties rather than one name per tab:
// "Filter Applied" segmented by Tab answers far more questions than eight
// per-tab filter events, and CleverTap caps the distinct event names an
// account may hold. Add a property before you add an event.
//
// Names are frozen. Renaming one orphans every segment, funnel and campaign
// built on it — add a new name and deprecate the old one instead.
export const EV = Object.freeze({
  // ── Cross-tab navigation & shell ──
  TAB_VIEWED: "Tab Viewed",
  TAB_EXITED: "Tab Exited",
  THEME_TOGGLED: "Theme Toggled",
  SYNC_TRIGGERED: "Sync Triggered",

  // ── Cross-tab data shaping ──
  FILTER_APPLIED: "Filter Applied",
  FILTERS_CLEARED: "Filters Cleared",
  SEARCH_PERFORMED: "Search Performed",
  DATE_RANGE_CHANGED: "Date Range Changed",
  REPORT_DOWNLOADED: "Report Downloaded",
  TICKET_OPENED: "Ticket Opened",

  // ── Ongoing Tickets / CSD Highlighted ──
  KPI_CARD_CLICKED: "KPI Card Clicked",

  // ── All Tickets ──
  GROUP_BY_CHANGED: "Group By Changed",
  CHART_SLICE_CLICKED: "Chart Slice Clicked",

  // ── Analytics ──
  ANALYTICS_PERIOD_CHANGED: "Analytics Period Changed",
  METRIC_EXPANDED: "Metric Expanded",
  CHART_DRILL_DOWN: "Chart Drill Down",

  // ── Parts View ──
  PARTS_TREE_LOADED: "Parts Tree Loaded",
  PART_NODE_TOGGLED: "Part Node Toggled",
  PART_TREE_BULK_TOGGLED: "Part Tree Bulk Toggled",
  PART_DRILLDOWN_OPENED: "Part Drilldown Opened",
  PART_SLICE_CLICKED: "Part Slice Clicked",
  PARTS_PANEL_TOGGLED: "Parts Panel Toggled",

  // ── Activity Intel ──
  ACTIVITY_MEMBER_SELECTED: "Activity Member Selected",
  ACTIVITY_DATE_CHANGED: "Activity Date Changed",
  ACTIVITY_DRILLDOWN_OPENED: "Activity Drilldown Opened",

  // ── Gamification ──
  LEADERBOARD_SORTED: "Leaderboard Sorted",
  GAMIFICATION_VIEW_SWITCHED: "Gamification View Switched",
  PROFILE_CARD_OPENED: "Profile Card Opened",

  // ── My Views ──
  VIEW_SAVED: "View Saved",
  VIEW_SELECTED: "View Selected",
  VIEW_DELETED: "View Deleted",

  // ── Attention Queue ──
  ATTENTION_QUEUE_OPENED: "Attention Queue Opened",
  ATTENTION_BUCKET_SWITCHED: "Attention Bucket Switched",
  ATTENTION_VERIFY_CLICKED: "Attention Verify Clicked",

  // ── DevRev AI Agent ──
  AGENT_QUERY_SENT: "Agent Query Sent",
  AGENT_RESPONSE_RECEIVED: "Agent Response Received",

  // ── Remarks ──
  COMMENT_ADDED: "Comment Added",
});

/** Tab id → the label the user actually sees. Keep in sync with App.jsx's tab array. */
export const TAB_LABELS = Object.freeze({
  tickets: "Ongoing Tickets",
  alltickets: "All Tickets",
  csd: "CSD Highlighted",
  vistas: "My Views",
  analytics: "Analytics",
  parts: "Parts View",
  activity: "Activity Intel",
  gamification: "Gamification",
});

// ═══════════════════════════════════════════════════════════════════════════
// AMBIENT CONTEXT
// ═══════════════════════════════════════════════════════════════════════════
// Merged into every event so each one is segmentable by who fired it and
// where they were, without 40 call sites remembering to pass it.

let context = {};

/**
 * Register/refresh the ambient properties. Safe to call on every render —
 * it only shallow-merges. Pass `{ Tab: "parts" }` on tab change,
 * `{ Role, Team }` on login, `{ Theme }` on toggle.
 */
export const setAnalyticsContext = (next = {}) => {
  context = { ...context, ...next };
};

export const getAnalyticsContext = () => ({ ...context });

// ═══════════════════════════════════════════════════════════════════════════
// SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════

// Joined lists past this many values stop being useful for segmentation and
// become unique-per-user strings. The exact size still ships as `<Key> Count`.
const MAX_LIST_VALUES = 12;
// The SDK trims at 1024 (clevertap.js:326). Trimming earlier keeps the value
// readable in the dashboard instead of a wall of text.
const MAX_STRING_LENGTH = 512;

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

const clampString = (s) =>
  s.length > MAX_STRING_LENGTH ? `${s.slice(0, MAX_STRING_LENGTH - 1)}…` : s;

/**
 * Array → a stable, capped, comma-joined string.
 * SORTED because CleverTap segments on exact string equality: without this,
 * picking the same two teams in a different order produces two segments.
 */
const joinList = (arr) => {
  const values = arr
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => String(v))
    .sort();
  if (!values.length) return null;
  if (values.length <= MAX_LIST_VALUES) return clampString(values.join(", "));
  const shown = values.slice(0, MAX_LIST_VALUES).join(", ");
  return clampString(`${shown} +${values.length - MAX_LIST_VALUES} more`);
};

/**
 * Flatten one props object into something the SDK will actually accept.
 *
 * - array          → "a, b, c" + "<Key> Count": n   (see THE ARRAY TRAP above)
 * - nested object  → dropped, with a dev-only warning
 * - null/undefined/"" → dropped (the SDK also treats the literal string
 *   "undefined" as invalid, so we never let one form)
 * - Date           → passed through; the SDK converts it
 * - number/bool    → passed through
 */
export const flattenProps = (props = {}) => {
  const out = {};

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === "") continue;

    if (Array.isArray(value)) {
      // The count ships even when every value was empty — "cleared to zero"
      // is a real, segmentable state and must not vanish.
      out[`${key} Count`] = value.length;
      const joined = joinList(value);
      if (joined) out[key] = joined;
      continue;
    }

    if (isPlainObject(value)) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[analytics] Dropped nested object prop "${key}" — CleverTap rejects ` +
            `non-flat events outright (error 512). Flatten it at the call site.`,
        );
      }
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || trimmed === "undefined") continue;
      out[key] = clampString(trimmed);
      continue;
    }

    if (typeof value === "number" && !Number.isFinite(value)) continue;

    out[key] = value;
  }

  return out;
};

// ═══════════════════════════════════════════════════════════════════════════
// THE TRACKER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Track one event. The only function call sites should use.
 *
 * @param {string} name  An EV.* value. Never a literal.
 * @param {Object} props Flat-ish props; arrays are flattened for you.
 *
 * Ambient context is merged UNDER the call-site props, so a call that passes
 * its own `Tab` (e.g. an event fired from a modal opened over another tab)
 * always wins over the ambient one.
 */
export const track = (name, props = {}) => {
  if (!name) return;
  if (import.meta.env?.DEV && !Object.values(EV).includes(name)) {
    console.warn(
      `[analytics] "${name}" is not in the EV registry. Add it to lib/analytics.js ` +
        `so the taxonomy stays reviewable.`,
    );
  }
  pushEvent(name, flattenProps({ ...context, ...props }));
};

/**
 * Back-compat alias for the pre-registry call sites. Prefer `track` + EV.*.
 * @deprecated
 */
export const trackEvent = track;

// ═══════════════════════════════════════════════════════════════════════════
// TAB DWELL TIME
// ═══════════════════════════════════════════════════════════════════════════

let tabEntry = { tab: null, at: 0 };

/**
 * Fire Tab Viewed for the new tab and Tab Exited (with dwell) for the old one.
 *
 * WHY DWELL LIVES HERE: "which tabs do people actually use?" is not answerable
 * from view counts alone — a tab people land on and leave in 2 seconds looks
 * identical to one they work in for 20 minutes. Pairing the two events makes
 * the CleverTap funnel report time-on-tab directly.
 *
 * @param {string} tab        the tab id being entered
 * @param {Object} [meta]     { entryMethod: "click" | "url" | "history" }
 */
export const trackTabChange = (tab, { entryMethod = "click" } = {}) => {
  if (!tab || tab === tabEntry.tab) return;

  if (tabEntry.tab) {
    track(EV.TAB_EXITED, {
      Tab: tabEntry.tab,
      "Tab Label": TAB_LABELS[tabEntry.tab] || tabEntry.tab,
      "Dwell Seconds": Math.round((Date.now() - tabEntry.at) / 1000),
    });
  }

  setAnalyticsContext({ Tab: tab });
  track(EV.TAB_VIEWED, {
    Tab: tab,
    "Tab Label": TAB_LABELS[tab] || tab,
    "Entry Method": entryMethod,
    "Previous Tab": tabEntry.tab || "none",
  });

  tabEntry = { tab, at: Date.now() };
};

/**
 * Flush the pending Tab Exited when the user closes/hides the page — without
 * this, the last (usually longest) session on a tab is never measured.
 * Uses `visibilitychange`, not `beforeunload`: the latter is unreliable on
 * mobile and blocked in some browsers.
 */
export const installDwellFlush = () => {
  if (typeof document === "undefined") return () => {};
  const onHidden = () => {
    if (document.visibilityState !== "hidden" || !tabEntry.tab) return;
    track(EV.TAB_EXITED, {
      Tab: tabEntry.tab,
      "Tab Label": TAB_LABELS[tabEntry.tab] || tabEntry.tab,
      "Dwell Seconds": Math.round((Date.now() - tabEntry.at) / 1000),
      "Exit Reason": "page hidden",
    });
    // Restart the clock so returning to the page doesn't double-count.
    tabEntry = { ...tabEntry, at: Date.now() };
  };
  document.addEventListener("visibilitychange", onHidden);
  return () => document.removeEventListener("visibilitychange", onHidden);
};

// ═══════════════════════════════════════════════════════════════════════════
// SHARED PROPERTY BUILDERS
// ═══════════════════════════════════════════════════════════════════════════
// Property KEYS are as much a contract as event names. These builders keep
// the same question phrased the same way across every tab, so one CleverTap
// segment ("Span Days > 90") works no matter which tab produced the event.

/** Inclusive day span of a {start,end} range, or null if it isn't a real range. */
export const rangeSpanDays = (range) => {
  if (!range?.start || !range?.end) return null;
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86400000) + 1;
};

/** Standard props for any date-range change. */
export const dateRangeProps = (range, preset = null) => ({
  "Range Start": range?.start || null,
  "Range End": range?.end || null,
  "Span Days": rangeSpanDays(range),
  Preset: preset,
});

/**
 * How many filter keys are actually narrowing the data.
 * Counts KEYS, not values — "3 filters active" is the question people ask.
 */
export const activeFilterCount = (filters = {}) =>
  Object.entries(filters).reduce((n, [, value]) => {
    if (Array.isArray(value)) return n + (value.length ? 1 : 0);
    if (isPlainObject(value)) return n + (value.start || value.end ? 1 : 0);
    return n + (value ? 1 : 0);
  }, 0);

/** Standard props for a ticket being opened, from any tab. */
export const ticketProps = (ticket = {}) => ({
  "Ticket ID": ticket.display_id || ticket.ticket_id || null,
  Account: ticket.account?.display_name || ticket.account || null,
  Stage: ticket.stage?.name || ticket.stage || null,
  Severity: ticket.severity?.name || ticket.severity || null,
  Owner: ticket.owned_by?.[0]?.display_name || ticket.owner || null,
  "Age Days": ticket.created_date
    ? Math.floor((Date.now() - new Date(ticket.created_date).getTime()) / 86400000)
    : null,
});
