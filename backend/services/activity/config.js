/**
 * activity/config — Ingest window, concurrency, cooldown keys.
 *
 * Extracted from the 653-line activityService.js; logic unchanged.
 * See activity/index.js for how a comment becomes points.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Only ingest comments from this date onwards (IST)
export const ACTIVITY_START_DATE = new Date("2025-12-31T18:30:00Z"); // Jan 1 2026 00:00 IST

// Concurrency: process N tickets in parallel
export const CONCURRENCY = 3;

// Delay between each concurrent batch (ms) — keeps DevRev API happy
export const BATCH_DELAY_MS = 500;

// Rate limit for the tickets:active self-heal below. Deliberately longer than
// the "frequent" job's 10-min cadence so at most every OTHER run can trigger a
// full ticket crawl — and shorter than that job's 15-min lookback window, so
// the one skipped run's comments are still picked up by the next one. No data
// loss, half the crawl rate, and a hard ceiling if the sync is broken.
export const REPOPULATE_COOLDOWN_KEY = "cooldown:activity:repopulate-active";
export const REPOPULATE_COOLDOWN_S = 900;
