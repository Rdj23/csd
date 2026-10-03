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

/**
 * Fetch this IST week's solved + CSAT counts for one user, from Mongo.
 *
 * These CANNOT be derived from the /api/tickets payload — that's the
 * active-only cache and holds no closed tickets, so any client-side
 * "solved this week" over it is always 0.
 *
 * @param {string} email
 * @returns {Promise<{ solved: number, positiveCSAT: number, negativeCSAT: number, weekStart: string }>}
 */
export const fetchMyWeekStats = async (email) => {
  const res = await authAxios.get(
    `${API_URL}/api/gamification/my-week?email=${encodeURIComponent(email)}`
  );
  return res.data;
};
