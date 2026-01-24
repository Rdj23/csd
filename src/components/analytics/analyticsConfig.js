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
export const SUPER_ADMIN_EMAILS = ["rohan.jadhav@clevertap.com"];

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
    label: "FRR Met",
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
    color: "#f43f5e",
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

// Quarter date ranges
export const getQuarterDates = (quarter) => {
  const quarters = {
    Q4_25: { start: new Date("2025-10-01"), end: new Date("2025-12-31") },
    Q1_26: { start: new Date("2026-01-01"), end: new Date("2026-03-31") },
    Q2_26: { start: new Date("2026-04-01"), end: new Date("2026-06-30") },
    Q3_26: { start: new Date("2026-07-01"), end: new Date("2026-09-30") },
    Q4_26: { start: new Date("2026-10-01"), end: new Date("2026-12-31") },
  };
  return quarters[quarter] || { start: new Date(), end: new Date() };
};
