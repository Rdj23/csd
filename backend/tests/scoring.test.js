/**
 * Gamification weight schemes are versioned by quarter: past quarters must
 * keep the weights they were published with, and Q4_26 onwards uses the new
 * RWT-heavy scheme. These tests lock that cutoff down.
 */
import { describe, it, expect } from "vitest";
import {
  scoreAndRank,
  getWeightScheme,
  WEIGHT_SCHEMES,
  LEGACY_WEIGHTS,
  Q4_26_WEIGHTS,
} from "../utils/scoring.js";
import { getQuarterDateRange, resolveDateRange } from "../config/constants.js";

const sum = (w) => Object.values(w).reduce((a, b) => a + b, 0);

const corpus = () => [
  // Legacy: A 70, B 60.  Q4_26: A 55, B 80.
  { name: "A", productivity: 6, csatPercent: 100, positiveCSAT: 30, avgRWT: 40, avgIterations: 3, frrPercent: 70 },
  { name: "B", productivity: 3, csatPercent: 100, positiveCSAT: 5, avgRWT: 10, avgIterations: 2, frrPercent: 80 },
  { name: "C", productivity: 4, csatPercent: 80, positiveCSAT: 15, avgRWT: 25, avgIterations: 4, frrPercent: 60 },
];

describe("weight schemes", () => {
  it("every scheme sums to 100%", () => {
    for (const s of WEIGHT_SCHEMES) expect(sum(s.weights)).toBeCloseTo(1, 10);
  });

  it("Q4_26 weights match the agreed split", () => {
    expect(Q4_26_WEIGHTS).toMatchObject({
      avgRWT: 0.25, productivity: 0.2, frrPercent: 0.2, avgIterations: 0.2, csatPercent: 0.15, positiveCSAT: 0,
    });
  });

  it("quarters before Q4_26 keep the legacy weights", () => {
    for (const q of ["Q1_26", "Q2_26", "Q3_26", "Q3_26_W13", "Q3_26_M3", "Q4_25"]) {
      expect(getWeightScheme(getQuarterDateRange(q).start).id).toBe("LEGACY");
    }
  });

  it("Q4_26 and later use the new weights", () => {
    for (const q of ["Q4_26", "Q4_26_W1", "Q4_26_M1", "Q1_27"]) {
      expect(getWeightScheme(getQuarterDateRange(q).start).id).toBe("Q4_26");
    }
  });

  it("custom ranges are scored by their start date", () => {
    expect(getWeightScheme(resolveDateRange({ startDate: "2026-09-30", endDate: "2026-10-15" }).start).id).toBe("LEGACY");
    expect(getWeightScheme(resolveDateRange({ startDate: "2026-10-01", endDate: "2026-10-15" }).start).id).toBe("Q4_26");
  });
});

describe("scoreAndRank", () => {
  it("applies the weights it is given", () => {
    const [legacyTop] = scoreAndRank(corpus(), LEGACY_WEIGHTS);
    const [q4Top] = scoreAndRank(corpus(), Q4_26_WEIGHTS);
    // A wins on productivity/#CSATs (legacy-heavy); B wins on RWT (Q4-heavy).
    expect(legacyTop.name).toBe("A");
    expect(q4Top.name).toBe("B");
  });

  it("legacy final score is the old 30/15/10/15/15/15 formula", () => {
    const entries = scoreAndRank(corpus(), LEGACY_WEIGHTS);
    for (const e of entries) {
      const expected =
        e.productivityNormScore * 0.3 + e.csatPercentNormScore * 0.15 + e.positiveCSATNormScore * 0.1 +
        e.avgRWTNormScore * 0.15 + e.avgIterationsNormScore * 0.15 + e.frrPercentNormScore * 0.15;
      expect(e.finalScore).toBeCloseTo(expected, 1);
    }
  });

  it("# CSATs still gets a display percentile under Q4_26 even though it is unweighted", () => {
    const entries = scoreAndRank(corpus(), Q4_26_WEIGHTS);
    for (const e of entries) expect(e.positiveCSATPercentile).toBeGreaterThan(0);
  });
});
