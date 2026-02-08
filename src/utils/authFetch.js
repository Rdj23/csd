import { useTicketStore } from "../store";

/**
 * Authenticated fetch wrapper.
 * - Injects Authorization: Bearer <token> header on all requests.
 * - Auto-logs out on 401 (expired/invalid token) so users see the login screen.
 */
export const authFetch = async (url, options = {}) => {
  const { token } = useTicketStore.getState();

  const headers = { ...options.headers };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    console.warn("[Auth] 401 received — session expired, logging out");
    useTicketStore.getState().logout();
    return response;
  }

  return response;
};
