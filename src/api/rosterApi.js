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
