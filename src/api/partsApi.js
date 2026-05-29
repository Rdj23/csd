/**
 * Parts API — DevRev part hierarchy tree + per-part ticket drilldown.
 * Backed by Mongo/Redis (never DevRev live), so these are fast reads.
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
  if (filters.dateFrom) p.append("dateFrom", filters.dateFrom);
  if (filters.dateTo) p.append("dateTo", filters.dateTo);
  return p;
};

/** Fetch the nested product→capability→feature tree with rolled-up counts. */
export const fetchPartsTree = async (filters = {}) => {
  const res = await authAxios.get(`${API_URL}/api/parts-tree?${buildParams(filters)}`);
  return res.data; // { success, tree, totalTickets, generatedAt }
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
