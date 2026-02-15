// ============================================================================
// SKELETON LOADER COMPONENTS - Modern Loading States
// ============================================================================
import React from "react";

// Basic skeleton shape
export const Skeleton = ({ className = "", width, height, rounded = "lg" }) => (
  <div
    className={`skeleton ${className}`}
    style={{
      width: width || "100%",
      height: height || "1rem",
      borderRadius: rounded === "full" ? "9999px" : rounded === "2xl" ? "1rem" : "0.5rem",
    }}
  />
);

// Metric Card Skeleton
export const MetricCardSkeleton = ({ className = "" }) => (
  <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 h-44 ${className}`}>
    <div className="flex justify-between items-start mb-4">
      <Skeleton width="60%" height="12px" />
      <Skeleton width="32px" height="32px" rounded="2xl" />
    </div>
    <Skeleton width="50%" height="36px" className="mb-2" />
    <Skeleton width="30%" height="14px" className="mb-4" />
    <Skeleton width="100%" height="48px" rounded="lg" />
  </div>
);

// Performance Overview Skeleton (5 metric cards grid)
export const PerformanceOverviewSkeleton = () => (
  <div className="space-y-4 animate-pulse-slow">
    {/* Header skeleton */}
    <div className="flex flex-wrap justify-between items-center gap-4">
      <div className="flex items-center gap-3">
        <Skeleton width="40px" height="40px" rounded="2xl" />
        <Skeleton width="200px" height="24px" />
        <Skeleton width="100px" height="28px" rounded="full" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton width="140px" height="32px" rounded="lg" />
        <Skeleton width="120px" height="32px" rounded="lg" />
        <Skeleton width="36px" height="36px" rounded="lg" />
      </div>
    </div>

    {/* Metric cards grid */}
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {[...Array(5)].map((_, i) => (
        <MetricCardSkeleton key={i} className={`stagger-${i + 1}`} />
      ))}
    </div>
  </div>
);

// Chart Skeleton
export const ChartSkeleton = ({ height = "300px" }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 animate-pulse-slow">
    <div className="flex justify-between items-start mb-6">
      <div>
        <Skeleton width="150px" height="20px" className="mb-2" />
        <Skeleton width="100px" height="14px" />
      </div>
      <div className="flex gap-2">
        <Skeleton width="80px" height="28px" rounded="lg" />
        <Skeleton width="80px" height="28px" rounded="lg" />
      </div>
    </div>
    <Skeleton width="100%" height={height} rounded="xl" />
  </div>
);

// Leaderboard Skeleton
export const LeaderboardSkeleton = () => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 animate-pulse-slow">
    <div className="flex items-center gap-3 mb-6">
      <Skeleton width="40px" height="40px" rounded="2xl" />
      <Skeleton width="180px" height="24px" />
    </div>

    {/* Podium skeleton */}
    <div className="flex items-end justify-center gap-4 mb-8 h-40">
      <div className="flex flex-col items-center">
        <Skeleton width="60px" height="60px" rounded="full" className="mb-2" />
        <Skeleton width="80px" height="80px" rounded="xl" />
      </div>
      <div className="flex flex-col items-center">
        <Skeleton width="70px" height="70px" rounded="full" className="mb-2" />
        <Skeleton width="80px" height="100px" rounded="xl" />
      </div>
      <div className="flex flex-col items-center">
        <Skeleton width="60px" height="60px" rounded="full" className="mb-2" />
        <Skeleton width="80px" height="60px" rounded="xl" />
      </div>
    </div>

    {/* List skeleton */}
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
          <Skeleton width="24px" height="24px" rounded="full" />
          <Skeleton width="40px" height="40px" rounded="full" />
          <div className="flex-1">
            <Skeleton width="120px" height="14px" className="mb-1" />
            <Skeleton width="80px" height="12px" />
          </div>
          <Skeleton width="60px" height="24px" rounded="full" />
        </div>
      ))}
    </div>
  </div>
);

// Table Row Skeleton
export const TableRowSkeleton = () => (
  <div className="flex items-center gap-4 p-4 border-b border-slate-100 dark:border-slate-800">
    <Skeleton width="80px" height="16px" />
    <Skeleton width="200px" height="16px" />
    <Skeleton width="100px" height="16px" />
    <Skeleton width="60px" height="16px" />
    <Skeleton width="80px" height="24px" rounded="full" />
  </div>
);

// Table Skeleton
export const TableSkeleton = ({ rows = 5 }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden animate-pulse-slow">
    {/* Header */}
    <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
      <Skeleton width="80px" height="12px" />
      <Skeleton width="200px" height="12px" />
      <Skeleton width="100px" height="12px" />
      <Skeleton width="60px" height="12px" />
      <Skeleton width="80px" height="12px" />
    </div>
    {/* Rows */}
    {[...Array(rows)].map((_, i) => (
      <TableRowSkeleton key={i} />
    ))}
  </div>
);

// Dashboard Full Page Skeleton
export const DashboardSkeleton = () => (
  <div className="space-y-6 p-6 max-w-[1600px] mx-auto">
    {/* Header/Controls skeleton */}
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Skeleton width="100px" height="36px" rounded="xl" />
        <Skeleton width="100px" height="36px" rounded="xl" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton width="200px" height="36px" rounded="xl" />
        <Skeleton width="36px" height="36px" rounded="lg" />
      </div>
    </div>

    {/* Performance Overview */}
    <PerformanceOverviewSkeleton />

    {/* Charts Grid */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ChartSkeleton height="250px" />
      <ChartSkeleton height="250px" />
    </div>

    {/* Leaderboard + DSAT */}
    <div className="grid grid-cols-1 gap-6">
      <LeaderboardSkeleton />
    </div>
  </div>
);

// Loading Overlay Component
export const LoadingOverlay = ({ message = "Loading..." }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4 animate-scale-in">
      <div className="loading-spinner w-10 h-10" />
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{message}</p>
    </div>
  </div>
);

// Inline Loading Spinner
export const LoadingSpinner = ({ size = "md", className = "" }) => {
  const sizeClasses = {
    sm: "w-4 h-4 border",
    md: "w-6 h-6 border-2",
    lg: "w-8 h-8 border-2",
    xl: "w-12 h-12 border-3",
  };

  return (
    <div
      className={`${sizeClasses[size]} border-slate-200 dark:border-slate-700 border-t-indigo-500 rounded-full animate-spin ${className}`}
    />
  );
};

// Loading Dots
export const LoadingDots = ({ className = "" }) => (
  <div className={`loading-dots ${className}`}>
    <span />
    <span />
    <span />
  </div>
);

export default {
  Skeleton,
  MetricCardSkeleton,
  PerformanceOverviewSkeleton,
  ChartSkeleton,
  LeaderboardSkeleton,
  TableSkeleton,
  DashboardSkeleton,
  LoadingOverlay,
  LoadingSpinner,
  LoadingDots,
};
