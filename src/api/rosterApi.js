/**
 * Roster API - Backup & availability info
 */
import { authAxios, API_URL } from "./apiClient";

/**
 * Fetch backup info for a user.
 * @param {string} userName
 * @param {boolean} [teamOnly=true]
 */
export const fetchBackupInfo = async (userName, teamOnly = true) => {
  const res = await authAxios.get(
    `${API_URL}/api/roster/backup?userName=${encodeURIComponent(userName)}&teamOnly=${teamOnly}`
  );
  return res.data;
};

/**
 * Fallback: fetch profile status.
 * @param {string} userName
 */
export const fetchProfileStatus = async (userName) => {
  const res = await authAxios.post(`${API_URL}/api/profile/status`, {
    userName,
  });
  return res.data;
};

/**
 * Fetch full roster data (all engineers, shifts, status).
 * @param {string} [quarter] - e.g. "Q2_26" — defaults to current quarter on backend
 */
export const fetchFullRoster = async (quarter) => {
  const params = quarter ? `?quarter=${quarter}` : "";
  const res = await authAxios.get(`${API_URL}/api/roster/full${params}`);
  return res.data;
};
