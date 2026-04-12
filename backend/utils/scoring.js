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
 *    Weights reflect business priorities: productivity (30%) is weighted highest
 *    because ticket throughput is the primary team KPI.
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
 * METRIC_WEIGHTS — Business-priority weights for the final composite score.
 * Must sum to 1.0 (100%).
 *
 * WHY THESE WEIGHTS:
 * - productivity (30%): Ticket throughput per working day — the team's primary KPI
 * - csatPercent (15%): % of rated tickets that are positive — customer happiness
 * - positiveCSAT (10%): Absolute count of positive ratings — rewards volume of good work
 * - avgRWT (15%): Average resolution wait time — speed of resolution
 * - avgIterations (15%): Average back-and-forth count — efficiency of communication
 * - frrPercent (15%): First-reply resolution rate — quality of first response
 */
const METRIC_WEIGHTS = {
  productivity:   0.30,
  csatPercent:    0.15,
  positiveCSAT:   0.10,
  avgRWT:         0.15,
  avgIterations:  0.15,
  frrPercent:     0.15,
};

/**
 * METRICS — Defines each scoring dimension and its sort direction.
 *
 * lowerIsBetter = true:  Lower values are better (RWT, iterations → less = faster)
 * lowerIsBetter = false: Higher values are better (productivity, CSAT → more = better)
 *
 * OPEN/CLOSED PRINCIPLE:
 * To add a new metric (e.g., "avgFRT"), add one entry here and one weight above.
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
const computeFinalScore = (entry) =>
  METRICS.reduce(
    (sum, { key }) => sum + (entry[`${key}NormScore`] || 0) * METRIC_WEIGHTS[key],
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
 * @returns {Array} The same array, sorted by finalScore descending, with all scoring fields added
 */
export const scoreAndRank = (entries) => {
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
    e.finalScore = parseFloat(computeFinalScore(e).toFixed(2));
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

/** Export weights and metrics for transparency (e.g., admin UI tooltip) */
export { METRIC_WEIGHTS, METRICS };
