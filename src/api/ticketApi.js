/**
 * Ticket API - Fetching tickets, dependencies, timeline replies
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
 * Fetch timeline replies for given ticket IDs.
 * @param {Function} authFetch - Authenticated fetch function from store
 * @param {string[]} ticketIds
 * @param {number} [timeoutMs=20000]
 */
export const fetchTimelineReplies = async (authFetch, ticketIds, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const res = await authFetch(`${API_URL}/api/tickets/timeline-replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketIds }),
    signal: controller.signal,
  });
  clearTimeout(timeout);
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
