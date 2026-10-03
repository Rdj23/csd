/**
 * Analytics sub-components.
 *
 * The dashboard is deliberately split into sections that each own one part of
 * the page. AnalyticsDashboard.jsx composes them; the pure computation those
 * sections render lives one level up in features/analytics/lib/.
 *
 * Some exports are renamed here because the file name describes the SECTION
 * while the export describes the COMPONENT (CSATSection -> CSATLeaderboard).
 */
export { default as CSATLeaderboard } from "./CSATSection";
export { default as DSATAlerts } from "./DSATSection";
export { default as PerformanceMetricsCards } from "./PerformanceOverview";
export { default as NOCAnalytics } from "./NOCAnalytics";
export { default as DrillDownModal } from "./DrillDownModal";
export { default as SmartInsights } from "./SmartInsights";
export { default as ThisWeekStats } from "./ThisWeekStats";
