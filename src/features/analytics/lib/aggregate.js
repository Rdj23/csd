/**
 * Rolling daily data points up into weekly or monthly buckets.
 *
 * Extracted verbatim from a 55-line useCallback inside AnalyticsDashboard.jsx,
 * which was a single 3580-line component. Pure: same arguments in, same
 * value out. The call site keeps its original dependency array, so nothing
 * about when this recomputes has changed.
 */

import { format, startOfWeek, endOfWeek, parseISO } from "date-fns";

// Metrics that must be AVERAGED across a bucket rather than summed. Getting
// this list wrong silently triples a weekly average, so it lives next to the
// only function that reads it.
export const isAverageMetric = (metric) =>
  ["rwt", "avgRWT", "avgFRT", "avgIterations", "frrPercent"].includes(metric);

export const aggregateData = (dailyData, groupMode, metric, users) => {

  const buckets = new Map();
  const useAvg = isAverageMetric(metric);

  dailyData.forEach((point) => {
    const d = parseISO(point.date);
    let bucketKey, bucketLabel;

    if (groupMode === "weekly") {
      const weekStart = startOfWeek(d, { weekStartsOn: 1 });
      bucketKey = format(weekStart, "yyyy-MM-dd");
      const weekEnd = endOfWeek(d, { weekStartsOn: 1 });
      bucketLabel = `${format(weekStart, "MMM dd")} - ${format(weekEnd, "MMM dd")}`;
    } else {
      bucketKey = format(d, "yyyy-MM");
      bucketLabel = format(d, "MMM yyyy");
    }

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { name: bucketLabel, date: bucketKey, _count: 0 });
    }
    const bucket = buckets.get(bucketKey);
    bucket._count += 1;

    // Aggregate user values
    users.forEach((user) => {
      bucket[user] = (bucket[user] || 0) + (point[user] || 0);
    });
    // Aggregate team/GST
    if (point.compare_team !== undefined) {
      bucket.compare_team = (bucket.compare_team || 0) + (point.compare_team || 0);
    }
    if (point.compare_gst !== undefined) {
      bucket.compare_gst = (bucket.compare_gst || 0) + (point.compare_gst || 0);
    }
  });

  // For average metrics, divide sums by count
  if (useAvg) {
    buckets.forEach((bucket) => {
      const count = bucket._count || 1;
      users.forEach((user) => {
        bucket[user] = Number(((bucket[user] || 0) / count).toFixed(2));
      });
      if (bucket.compare_team !== undefined) {
        bucket.compare_team = Number((bucket.compare_team / count).toFixed(2));
      }
      if (bucket.compare_gst !== undefined) {
        bucket.compare_gst = Number((bucket.compare_gst / count).toFixed(2));
      }
    });
  }

  return Array.from(buckets.values()).map(({ _count, ...rest }) => rest);
};
