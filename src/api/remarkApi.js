/**
 * Remark / Comment API - Internal remarks & DevRev sync
 */
import { authAxios, API_URL } from "./apiClient";

/**
 * Fetch all users for mention tagging.
 */
export const fetchUsers = async () => {
  const res = await authAxios.get(`${API_URL}/api/users`);
  return res.data;
};

/**
 * Fetch remark history for a ticket.
 * @param {string} displayId - Ticket display ID (e.g. "TKT-123")
 */
export const fetchRemarkHistory = async (displayId) => {
  const res = await authAxios.get(`${API_URL}/api/remarks/${displayId}`);
  return res.data;
};

/**
 * Save a local remark.
 * @param {Function} authFetch - Authenticated fetch from store
 * @param {Object} payload - { ticketId, user, text }
 */
export const postLocalRemark = async (authFetch, { ticketId, user, text }) => {
  return authFetch(`${API_URL}/api/remarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketId, user, text }),
  });
};

/**
 * Sync comment to DevRev.
 * @param {Function} authFetch - Authenticated fetch from store
 * @param {Object} payload - { ticketId (internal UUID), body }
 */
export const postDevRevComment = async (authFetch, { ticketId, body }) => {
  const response = await authFetch(`${API_URL}/api/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketId, body }),
  });
  if (!response.ok) throw new Error("DevRev Sync Failed");
  return response;
};
