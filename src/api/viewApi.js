/**
 * View API - User saved filter views
 */
import { API_URL } from "./apiClient";

/**
 * Fetch saved views for a user.
 * @param {Function} authFetch - Authenticated fetch from store
 * @param {string} email
 */
export const fetchViews = async (authFetch, email) => {
  const res = await authFetch(
    `${API_URL}/api/views/${encodeURIComponent(email)}`
  );
  return res.json();
};

/**
 * Save a new filter view.
 * @param {Function} authFetch - Authenticated fetch from store
 * @param {Object} payload - { userId, name, filters }
 */
export const saveView = async (authFetch, { userId, name, filters }) => {
  const res = await authFetch(`${API_URL}/api/views`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, name, filters }),
  });
  return res.json();
};

/**
 * Delete a saved view.
 * @param {Function} authFetch - Authenticated fetch from store
 * @param {string} email
 * @param {string} viewId
 */
export const deleteView = async (authFetch, email, viewId) => {
  return authFetch(
    `${API_URL}/api/views/${encodeURIComponent(email)}/${viewId}`,
    { method: "DELETE" }
  );
};
