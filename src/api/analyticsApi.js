/**
 * Analytics API - Pre-aggregated analytics data
 */
import { API_URL } from "./apiClient";

/**
 * Fetch pre-aggregated analytics data.
 * @param {Function} authFetch - Authenticated fetch function from store
 * @param {Object} filters - { quarter, excludeZendesk, excludeNOC, owner, forceRefresh, groupBy }
 */
export const fetchAnalyticsData = async (authFetch, filters = {}) => {
  const params = new URLSearchParams();

  if (filters.quarter) params.append("quarter", filters.quarter);
  if (filters.excludeZendesk) params.append("excludeZendesk", "true");
  if (filters.excludeNOC) params.set("excludeNOC", "true");
  if (filters.owner) params.append("owner", filters.owner);
  if (filters.forceRefresh) params.append("forceRefresh", "true");
  if (filters.groupBy) params.append("groupBy", filters.groupBy);

  const url = `${API_URL}/api/tickets/analytics?${params.toString()}`;
  const res = await authFetch(url);
  return res.json();
};

/**
 * Fetch NOC analytics data.
 * @param {Function} authFetch - Authenticated fetch function from store
 * @param {URLSearchParams|string} params - Query params string
 */
export const fetchNOCAnalytics = async (authFetch, params) => {
  const response = await authFetch(`${API_URL}/api/tickets/noc?${params}`);
  return response.json();
};
