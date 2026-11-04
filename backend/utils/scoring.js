/**
 * utils/scoring.js — Gamification scoring engine.
 *
 * Extracted from gamificationController to satisfy the Single Responsibility Principle:
 * the controller orchestrates HTTP + MongoDB, this module owns the math.
 *
 * SCORING PIPELINE (3 stages):
 * 1. Per-metric PERCENTILE RANKS — "Where does this person rank among peers?"
 *    Used for display badges and individual stat cards.
 *
 * 2. Min-Max NORMALIZATION (0-100) — "How does this metric compare on a common scale?"
 *    Converts diverse units (hours, %, count) into a single 0-100 scale so they
 *    can be weighted and summed into a final score.
 *
 * 3. WEIGHTED FINAL SCORE — "What's the single number that represents overall performance?"
 *    Weights reflect business priorities and are versioned by quarter — see
 *    WEIGHT_SCHEMES. Past quarters keep the weights they were scored with.
 *
 * WHY SEPARATE FROM THE CONTROLLER:
 * - Testable: unit tests can verify scoring math without MongoDB or HTTP fixtures
 * - Reusable: both getGamification (admin leaderboard) and getMyStats (personal)
 *   use the same scoring logic — extracting prevents drift between the two
 * - Open/Closed: adding a new metric means adding one entry to METRICS, not
 *   modifying 12 scattered calculation loops
 */

// ── Configuration ────────────────────────────────────────────────────

/**
 * WEIGHT SCHEMES — Business-priority weights for the final composite score,
 * versioned by the date they take effect. Each scheme must sum to 1.0 (100%).
 *
 * WHY VERSIONED: weights change between quarters, but quarters that were
 * already scored (and communicated to the team) must not be re-ranked
 * retroactively. A window is scored with the scheme in effect on its START
 * date — so any window that begins before a cutoff keeps the old weights.
 *
 * TO CHANGE WEIGHTS: add a new scheme at the TOP of WEIGHT_SCHEMES with its
 * effectiveFrom date. Never edit a scheme that has already been used.
 */

/**
 * LEGACY (everything before Q4_26):
 * - productivity (30%): Ticket throughput per working day — the team's primary KPI
 * - csatPercent (15%): % of rated tickets that are positive — customer happiness
 * - positiveCSAT (10%): Absolute count of positive ratings — rewards volume of good work
 * - avgRWT (15%): Average resolution wait time — speed of resolution
 * - avgIterations (15%): Average back-and-forth count — efficiency of communication
 * - frrPercent (15%): First-reply resolution rate — quality of first response
 */
const LEGACY_WEIGHTS = Object.freeze({
  productivity:   0.30,
  csatPercent:    0.15,
  positiveCSAT:   0.10,
  avgRWT:         0.15,
  avgIterations:  0.15,
  frrPercent:     0.15,
});

/**
 * Q4_26 onwards (from 1 Oct 2026 IST):
 * RWT 25%, Productivity 20%, FRR 20%, Iterations 20%, CSAT 15%.
 * CSAT keeps the legacy two-part logic (CSAT % + # CSATs) and the legacy
 * 60/40 ratio between them (15:10), scaled down to 15% → 9% + 6%.
 */
const Q4_26_WEIGHTS = Object.freeze({
  avgRWT:         0.25,
  productivity:   0.20,
  frrPercent:     0.20,
  avgIterations:  0.20,
  csatPercent:    0.09,
  positiveCSAT:   0.06,
});

/** Newest first — getWeightScheme returns the first one whose effectiveFrom <= start. */
const WEIGHT_SCHEMES = Object.freeze([
  { id: "Q4_26", effectiveFrom: new Date("2026-10-01T00:00:00.000+05:30"), weights: Q4_26_WEIGHTS },
  { id: "LEGACY", effectiveFrom: new Date(0), weights: LEGACY_WEIGHTS },
]);

/**
 * getWeightScheme — the weight scheme for a scoring window, chosen by the
 * window's START date (see WHY VERSIONED above).
 *
 * @param {Date} start — Window start
 * @returns {{ id: string, effectiveFrom: Date, weights: Object }}
 */
const getWeightScheme = (start) =>
  WEIGHT_SCHEMES.find((s) => start >= s.effectiveFrom) || WEIGHT_SCHEMES[WEIGHT_SCHEMES.length - 1];

/**
 * METRICS — Defines each scoring dimension and its sort direction.
 *
 * lowerIsBetter = true:  Lower values are better (RWT, iterations → less = faster)
 * lowerIsBetter = false: Higher values are better (productivity, CSAT → more = better)
 *
 * OPEN/CLOSED PRINCIPLE:
 * To add a new metric (e.g., "avgFRT"), add one entry here and a weight to a new scheme above.
 * No other code changes needed — the pipeline loops over this array.
 */
const METRICS = [
  { key: "productivity",   lowerIsBetter: false },
  { key: "csatPercent",    lowerIsBetter: false },
  { key: "positiveCSAT",  lowerIsBetter: false },
  { key: "avgRWT",        lowerIsBetter: true  },
  { key: "avgIterations", lowerIsBetter: true  },
  { key: "frrPercent",    lowerIsBetter: false },
];

// ── Stage 1: Per-Metric Percentile Ranks ─────────────────────────────

/**
 * Assign rank and percentile for a single metric across all entries.
 *
 * Percentile formula: ((N - rank + 1) / N) * 100
 * Rank 1 out of 10 → 100th percentile (top performer)
 * Rank 10 out of 10 → 10th percentile (needs improvement)
 *
 * Mutates entries in place (adds `${key}Rank` and `${key}Percentile` fields).
 */
const assignMetricPercentiles = (entries, { key, lowerIsBetter }) => {
  const total = entries.length;
  if (total === 0) return;

  const sorted = [...entries].sort((a, b) =>
    lowerIsBetter ? a[key] - b[key] : b[key] - a[key],
  );

  sorted.forEach((entry, idx) => {
    const rank = idx + 1;
    // Find the original entry by name (entries may be in different order)
    const original = entries.find((e) => e.name === entry.name);
    if (original) {
      original[`${key}Rank`] = rank;
      original[`${key}Percentile`] = Math.round(((total - rank + 1) / total) * 100);
    }
  });
};

// ── Stage 2: Min-Max Normalization ───────────────────────────────────

/**
 * Normalize a single metric to 0-100 scale across all entries.
 *
 * Min-Max formula:
 *   Higher-is-better: (value - min) / (max - min) * 100
 *   Lower-is-better:  (max - value) / (max - min) * 100
 *
 * Edge case: if all values are the same (range = 0), everyone scores 100.
 * This prevents division-by-zero and is semantically correct: if everyone
 * has the same RWT, nobody is better or worse than anyone else.
 *
 * Mutates entries in place (adds `${key}NormScore` field).
 */
const normalizeMetric = (entries, { key, lowerIsBetter }) => {
  const values = entries.map((e) => e[key] || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  entries.forEach((e) => {
    const value = e[key] || 0;
    const score = range === 0
      ? 100
      : lowerIsBetter
        ? ((max - value) / range) * 100
        : ((value - min) / range) * 100;
    e[`${key}NormScore`] = parseFloat(score.toFixed(2));
  });
};

// ── Stage 3: Weighted Final Score ────────────────────────────────────

/**
 * Compute the weighted composite score from all normalized metric scores.
 * Returns a value between 0 and 100.
 */
const computeFinalScore = (entry, weights) =>
  METRICS.reduce(
    (sum, { key }) => sum + (entry[`${key}NormScore`] || 0) * (weights[key] || 0),
    0,
  );

// ── Public API ───────────────────────────────────────────────────────

/**
 * scoreAndRank — Full scoring pipeline for a designation group (L1 or L2).
 *
 * Takes an array of entries (each with name, productivity, csatPercent, etc.)
 * and mutates them in place with:
 * - Per-metric ranks and percentiles
 * - Normalized scores (0-100)
 * - Final weighted score
 * - Overall rank and percentile
 * - Deterministic tie-breaking by name (alphabetical)
 *
 * @param {Array} entries — Array of { name, productivity, csatPercent, ... } objects
 * @param {Object} weights — Weights from getWeightScheme(start).weights. Defaults to
 *   the scheme in effect today; callers scoring a past window MUST pass their own.
 * @returns {Array} The same array, sorted by finalScore descending, with all scoring fields added
 */
export const scoreAndRank = (entries, weights = getWeightScheme(new Date()).weights) => {
  if (entries.length === 0) return entries;

  // Stage 1: Per-metric percentile ranks (for display)
  for (const metric of METRICS) {
    assignMetricPercentiles(entries, metric);
  }

  // Stage 2: Min-Max normalization (for composite scoring)
  for (const metric of METRICS) {
    normalizeMetric(entries, metric);
  }

  // Stage 3: Weighted final score
  entries.forEach((e) => {
    e.finalScore = parseFloat(computeFinalScore(e, weights).toFixed(2));
    e.weightedAvg = e.finalScore; // Alias for backwards compat with frontend
  });

  // Sort: highest score first, alphabetical tie-breaking for deterministic order
  entries.sort((a, b) =>
    b.finalScore !== a.finalScore
      ? b.finalScore - a.finalScore
      : a.name.localeCompare(b.name),
  );

  // Assign overall rank + percentile
  const total = entries.length;
  entries.forEach((e, i) => {
    e.rank = i + 1;
    e.percentile = total > 0 ? Math.round(((total - e.rank + 1) / total) * 100) : 0;
  });

  return entries;
};

/**
 * calculatePercentile — Compute where a single value ranks among all values.
 * Used by getMyStats to show "you're in the Xth percentile for productivity".
 *
 * @param {number} value — The individual's metric value
 * @param {Array<number>} allValues — All values in the comparison group
 * @param {boolean} lowerIsBetter — True for metrics like RWT where lower = better
 * @returns {number} Percentile (0-100)
 */
export const calculatePercentile = (value, allValues, lowerIsBetter = false) => {
  if (allValues.length === 0) return 0;
  const sorted = [...allValues].sort((a, b) => lowerIsBetter ? a - b : b - a);
  const tolerance = 0.001;
  let rank = sorted.findIndex((v) => Math.abs(v - value) < tolerance) + 1;
  if (rank === 0) {
    rank = lowerIsBetter
      ? sorted.filter((v) => v < value).length + 1
      : sorted.filter((v) => v > value).length + 1;
  }
  return Math.min(Math.round(((allValues.length - rank + 1) / allValues.length) * 100), 100);
};

/** Export weights and metrics for transparency (e.g., admin UI labels) */
export { WEIGHT_SCHEMES, LEGACY_WEIGHTS, Q4_26_WEIGHTS, METRICS, getWeightScheme };
