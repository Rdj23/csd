// ============================================================================
// ANALYTICS CONFIGURATION - Shared constants and metrics config
// ============================================================================
import {
  CheckCircle,
  Clock,
  ArrowUpRight,
  ArchiveRestore,
  Smile,
  Zap,
  Layers,
  TrendingUp,
} from "lucide-react";

// Users to exclude from analytics
export const HIDDEN_USERS = [
  "System",
  "DevRev Bot",
  "A",
  "V",
  "n",
  "Undefined",
  "null",
  "Anmol",
  "anmol-sawhney",
];

// Super admin emails for elevated access
export const SUPER_ADMIN_EMAILS = [
  "rohan.jadhav@clevertap.com",
  "anmol.sawhney@clevertap.com",
  "mashnu@clevertap.com"
];

// ============================================================================
// CHART METRICS CONFIG
// ============================================================================
export const METRICS = {
  volume: {
    label: "Incoming Volume",
    icon: ArrowUpRight,
    color: "#6366f1",
    desc: "Tickets Created",
  },
  solved: {
    label: "Solved",
    icon: CheckCircle,
    color: "#10b981",
    desc: "Tickets Solved",
  },
  rwt: {
    label: "Avg Resolution",
    icon: Clock,
    color: "#f59e0b",
    desc: "Hours to Solve",
  },
  backlog: {
    label: "Backlog Clearance",
    icon: ArchiveRestore,
    color: "#f97316",
    desc: "Solved (Age > 15 Days)",
  },
};

// ============================================================================
// PERFORMANCE OVERVIEW METRICS
// ============================================================================
export const OVERVIEW_METRICS = {
  avgRWT: {
    label: "Avg RWT",
    fullLabel: "Average Resolution Wait Time",
    icon: Clock,
    color: "#8b5cf6",
    unit: "Hrs",
    desc: "Average time to resolve tickets",
    dataKey: "avgRWT",
  },
  csat: {
    label: "Positive CSAT",
    fullLabel: "Customer Satisfaction",
    icon: Smile,
    color: "#10b981",
    unit: "Count",
    desc: "Positive customer feedback count",
    dataKey: "positiveCSAT",
  },
  frrPercent: {
    label: "FRR",
    fullLabel: "First Response Rate",
    icon: Zap,
    color: "#f59e0b",
    unit: "%",
    desc: "First response within SLA",
    dataKey: "frrPercent",
  },
  avgIterations: {
    label: "Avg Iterations",
    fullLabel: "Average Iterations per Ticket",
    icon: Layers,
    color: "#3b82f6",
    unit: "",
    desc: "Back-and-forth exchanges",
    dataKey: "avgIterations",
  },
  avgFRT: {
    label: "Avg FRT",
    fullLabel: "Average First Response Time",
    icon: TrendingUp,
    color: "#06b6d4",
    unit: "Hrs",
    desc: "Time to first response",
    dataKey: "avgFRT",
  },
};

// Chart color palette
export const CHART_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#06b6d4",
  "#8b5cf6",
];

// ---------------------------------------------------------------------------
// Dynamic quarter helpers (frontend) — mirrors backend logic
// ---------------------------------------------------------------------------

const QUARTER_MONTHS = {
  1: { startMonth: 0, endMonth: 2 },   // Jan–Mar
  2: { startMonth: 3, endMonth: 5 },   // Apr–Jun
  3: { startMonth: 6, endMonth: 8 },   // Jul–Sep
  4: { startMonth: 9, endMonth: 11 },  // Oct–Dec
};

/** Get current quarter key, e.g. "Q2_26" */
export const getCurrentQuarterKey = () => {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  const yy = String(now.getFullYear()).slice(-2);
  return `Q${q}_${yy}`;
};

/** Get previous quarter key, e.g. "Q1_26" when current is "Q2_26" */
export const getPreviousQuarterKey = () => {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  const year = now.getFullYear();
  const prevQ = q === 1 ? 4 : q - 1;
  const prevYear = q === 1 ? year - 1 : year;
  const yy = String(prevYear).slice(-2);
  return `Q${prevQ}_${yy}`;
};

/** Format quarter key for display: "Q2_26" → "Q2 '26" */
export const formatQuarterLabel = (key) => {
  const match = key.match(/^Q([1-4])_(\d{2})$/);
  if (!match) return key;
  return `Q${match[1]} '${match[2]}`;
};

/** Compute date range for any quarter key. */
export const getQuarterDates = (quarter) => {
  const match = quarter.match(/^Q([1-4])_(\d{2})$/);
  if (!match) return { start: new Date(), end: new Date() };
  const q = parseInt(match[1]);
  const year = 2000 + parseInt(match[2]);
  const { startMonth, endMonth } = QUARTER_MONTHS[q];
  const lastDay = new Date(year, endMonth + 1, 0).getDate();
  return {
    start: new Date(year, startMonth, 1),
    end: new Date(year, endMonth, lastDay),
  };
};

// Data availability starts Q1 2026 (mirrors ALL_TIME_START_DATE below).
// Every quarter selector/preset is enumerated from here up to the current quarter.
const DATA_START_QUARTER = { q: 1, year: 2026 };

/**
 * Build the list of available quarters for toggles/presets — every quarter
 * from the data-start quarter (Q1 '26) through the current quarter, inclusive.
 * e.g. in Q3 '26 this returns [Q1_26, Q2_26, Q3_26].
 */
export const getAvailableQuarters = () => {
  const now = new Date();
  const currQ = Math.ceil((now.getMonth() + 1) / 3);
  const currYear = now.getFullYear();

  const quarters = [];
  let q = DATA_START_QUARTER.q;
  let year = DATA_START_QUARTER.year;
  // Advance quarter-by-quarter until we pass the current quarter.
  while (year < currYear || (year === currYear && q <= currQ)) {
    const key = `Q${q}_${String(year).slice(-2)}`;
    quarters.push({ id: key, label: formatQuarterLabel(key) });
    q += 1;
    if (q > 4) {
      q = 1;
      year += 1;
    }
  }
  return quarters;
};

/** Return the quarter key whose date span contains the given Date, or null. */
export const getQuarterKeyForDate = (date) => {
  const match = getAvailableQuarters().find((qtr) => {
    const { start, end } = getQuarterDates(qtr.id);
    return date >= start && date <= end;
  });
  return match ? match.id : null;
};

// All Time date range (starts from Q1_26)
export const ALL_TIME_START_DATE = new Date("2026-01-01");
