/**
 * Analytics API - Pre-aggregated analytics data
 */
import { API_URL } from "./apiClient";

/**
 * Fetch pre-aggregated analytics data.
 * @param {Function} authFetch - Authenticated fetch function from store
 * @param {Object} filters - { quarter, excludeZendesk, excludeNOC, owner, forceRefresh, groupBy, resolvedBy }
 *   resolvedBy: array like ["engineer"] or ["agent"]; both/none = omitted (backend treats as no filter).
 */
export const fetchAnalyticsData = async (authFetch, filters = {}) => {
  const params = new URLSearchParams();

  if (filters.quarter) params.append("quarter", filters.quarter);
  if (filters.excludeZendesk) params.append("excludeZendesk", "true");
  if (filters.excludeNOC) params.set("excludeNOC", "true");
  if (filters.owner) params.append("owner", filters.owner);
  if (filters.cohorts) params.append("cohorts", filters.cohorts);
  if (filters.forceRefresh) params.append("forceRefresh", "true");
  if (filters.groupBy) params.append("groupBy", filters.groupBy);
  // Only send resolvedBy when exactly one option is selected — both/none means
  // "no filter", and sending it would just bypass the precomputed cache for nothing.
  if (Array.isArray(filters.resolvedBy) && filters.resolvedBy.length === 1) {
    params.append("resolvedBy", filters.resolvedBy[0]);
  }

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
