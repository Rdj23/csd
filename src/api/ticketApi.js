/**
 * Ticket API - Fetching tickets, dependencies
 */
import { API_URL } from "./apiClient";

/**
 * Fetch active tickets (merge-based).
 * @param {Function} authFetch - Authenticated fetch function from store
 */
export const fetchTickets = async (authFetch) => {
  const response = await authFetch(`${API_URL}/api/tickets`);
  return response.json();
};

/**
 * Fetch the full solved/closed ticket history for a date range from MongoDB.
 *
 * The active cache (/api/tickets) only retains recently-created solved tickets,
 * so the All Tickets view used it to show solved counts and came up empty for
 * past quarters. This pulls the permanent solved record (by closed_date) so the
 * Solved bucket is accurate for any range; live buckets still use the cache.
 *
 * @param {Function} authFetch - Authenticated fetch function from store
 * @param {{start: string, end: string}} range - yyyy-MM-dd start/end (inclusive)
 * @returns {Promise<{tickets: object[], count: number, capped?: boolean}>}
 */
export const fetchAllSolvedTickets = async (authFetch, { start, end }) => {
  const params = new URLSearchParams({ start, end });
  const response = await authFetch(`${API_URL}/api/tickets/all-solved?${params}`);
  if (!response.ok) return { tickets: [], count: 0 };
  return response.json();
};

/**
 * Fetch dependencies for given ticket IDs.
 * @param {Function} authFetch - Authenticated fetch function from store
 * @param {string[]} ticketIds
 */
export const fetchDependencies = async (authFetch, ticketIds) => {
  const res = await authFetch(`${API_URL}/api/tickets/dependencies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketIds }),
  });
  return res.json();
};

/**
 * Fetch ticket timeline / comments.
 * @param {Function} authFetch - Authenticated fetch function from store
 * @param {string} ticketId
 */
export const fetchTicketTimeline = async (authFetch, ticketId) => {
  const response = await authFetch(
    `${API_URL}/timeline?ticket_id=${encodeURIComponent(ticketId)}`
  );
  if (!response.ok) return [];
  return (await response.json()) || [];
};
