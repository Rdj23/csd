/**
 * clevertap.js — the raw CleverTap SDK adapter.
 *
 * This file owns ONLY the SDK boundary: init, profile identification, and the
 * unvalidated event push. The event *taxonomy* (names, properties, array
 * flattening, ambient context) lives in lib/analytics.js — import `track` and
 * `EV` from there, not `trackEvent` from here.
 */
import clevertap from "clevertap-web-sdk";
import { FLAT_TEAM_MAP, TEAM_GROUPS, TEAMLESS_MEMBERS } from "./teams";

// Initialize only once — wrapped in try/catch because clearing browser
// cookies can leave the SDK in a broken state on first load
try {
  clevertap.init("R57-875-KK7Z");
} catch (e) {
  console.warn("CleverTap init failed (will retry on next page load):", e);
}

/**
 * Raw event push. Prefer `track()` from lib/analytics.js — it flattens arrays
 * (which the SDK would otherwise reject outright) and merges ambient context.
 */
export const trackEvent = (eventName, eventProps = {}) => {
  try {
    clevertap.event.push(eventName, eventProps);
  } catch (e) {
    // The SDK is best-effort by design: analytics must never break the app.
    if (import.meta.env?.DEV) console.warn("[clevertap] event.push failed", eventName, e);
  }
};

/** GST name → their team lead, or null for teamless/non-GST logins. */
export const resolveTeam = (gstName) => {
  if (!gstName) return null;
  if (Object.values(TEAMLESS_MEMBERS).includes(gstName)) return "Teamless";
  for (const [lead, members] of Object.entries(TEAM_GROUPS)) {
    if (Object.values(members).includes(gstName)) return lead;
  }
  return null;
};

/**
 * Identify the logged-in user and stamp the profile properties every event
 * can later be segmented by.
 *
 * WHY THE PROFILE CARRIES Team / Role / Is Lead:
 * Event properties answer "what happened"; profile properties answer "to whom".
 * Putting Team on the profile means every historical event becomes filterable
 * by team the moment the profile updates — you don't have to have thought to
 * attach it to each event at fire time.
 *
 * @param {Object} user      { name, email }
 * @param {Object} [extra]   { gstName, isLead } when the caller already knows
 */
export const loginUser = (user, { gstName = null, isLead = null } = {}) => {
  if (!user?.email) return;
  const name = gstName || user.name;
  const team = resolveTeam(name);
  try {
    clevertap.onUserLogin.push({
      Site: {
        Name: user.name,
        Identity: user.email, // Unique ID
        Email: user.email,
        // Profile dimensions — see the note above.
        "GST Name": name || undefined,
        Team: team || undefined,
        "Is GST Member": Object.values(FLAT_TEAM_MAP).includes(name),
        "Is Team Lead": isLead ?? (team ? name === team : undefined),
      },
    });
  } catch (e) {
    if (import.meta.env?.DEV) console.warn("[clevertap] onUserLogin failed", e);
  }
};

export default clevertap;
