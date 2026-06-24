/**
 * Parts API — DevRev part hierarchy tree + per-part ticket drilldown + volume trend.
 * Backed by cold MongoDB data (solved/closed tickets in analyticstickets) only — never
 * Redis live or DevRev — so these are fast, low-load reads (data is up to ~1 day old).
 */
import { authAxios, API_URL } from "./apiClient";

/**
 * Serialize the shared filter set into query params.
 * statuses are lowercased to match the backend's team-vocab matchers
 * (open / pending / on hold / solved).
 */
const buildParams = (filters = {}) => {
  const p = new URLSearchParams();
  if (filters.priorities?.length) p.append("priorities", filters.priorities.join(","));
  if (filters.statuses?.length)
    p.append("statuses", filters.statuses.map((s) => s.toLowerCase()).join(","));
  if (filters.accounts?.length) p.append("accounts", filters.accounts.join(","));
  // subtypes lowercased to match the backend's case-insensitive substring matcher.
  if (filters.subtypes?.length)
    p.append("subtypes", filters.subtypes.map((s) => s.toLowerCase()).join(","));
  if (filters.regions?.length) p.append("regions", filters.regions.join(","));
  if (filters.dateFrom) p.append("dateFrom", filters.dateFrom);
  if (filters.dateTo) p.append("dateTo", filters.dateTo);
  return p;
};

/**
 * Fetch the nested product→capability→feature tree with rolled-up counts.
 * Pass { fresh:true } (the Refresh button) to bypass the 10-min default-tree cache and
 * re-aggregate the latest cold data.
 */
export const fetchPartsTree = async (filters = {}, { fresh = false } = {}) => {
  const p = buildParams(filters);
  if (fresh) p.append("forceRefresh", "1");
  const res = await authAxios.get(`${API_URL}/api/parts-tree?${p}`);
  return res.data; // { success, tree, totalTickets, generatedAt }
};

/**
 * Fetch the ticket-volume trendline for a part subtree (or all products when partId is
 * omitted), bucketed daily / weekly / monthly. Cold data — backed by analyticstickets.
 */
export const fetchPartsTrend = async (
  partId = null,
  filters = {},
  { groupBy = "daily" } = {},
) => {
  const p = buildParams(filters);
  p.append("groupBy", groupBy);
  if (partId) p.append("partId", partId);
  const res = await authAxios.get(`${API_URL}/api/parts-trend?${p}`);
  return res.data; // { success, trend: [{ date, count }], groupBy, total }
};

/** Fetch paginated tickets for a single part subtree. */
export const fetchPartTickets = async (partId, filters = {}, { page = 1, pageSize = 50 } = {}) => {
  const p = buildParams(filters);
  p.append("page", page);
  p.append("pageSize", pageSize);
  // Part DON ids contain ":" and "/" — must be encoded.
  const res = await authAxios.get(
    `${API_URL}/api/parts/${encodeURIComponent(partId)}/tickets?${p}`,
  );
  return res.data; // { success, tickets, page, pageSize, total, hasMore }
};
