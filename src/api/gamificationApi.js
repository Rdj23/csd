/**
 * Gamification API - Leaderboard & user performance stats
 */
import { authAxios, API_URL } from "./apiClient";

/**
 * Fetch full leaderboard data (admin only).
 * @param {string} quarter - e.g. "Q1_26"
 */
export const fetchLeaderboard = async (quarter) => {
  const res = await authAxios.get(`${API_URL}/api/gamification?quarter=${quarter}`);
  return res.data;
};

/**
 * Fetch individual user stats (non-admin, secure endpoint).
 * @param {string} quarter
 * @param {string} email
 */
export const fetchMyStats = async (quarter, email) => {
  const res = await authAxios.get(
    `${API_URL}/api/gamification/my-stats?quarter=${quarter}&email=${encodeURIComponent(email)}`
  );
  return res.data;
};
