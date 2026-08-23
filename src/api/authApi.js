/**
 * Auth API - Google OAuth login
 */
import { API_URL } from "./apiClient";

export const loginWithGoogle = async (credential) => {
  const res = await fetch(`${API_URL}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const data = await res.json();
  return { ok: res.ok, data };
};
