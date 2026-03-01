/**
 * Activity Intelligence API - User activity tracking & analytics
 */
import { authAxios, API_URL } from "./apiClient";

/** Fetch list of GST members for the sidebar */
export const fetchMembers = async () => {
  const res = await authAxios.get(`${API_URL}/api/activity/members`);
  return res.data.members;
};

/** Fetch daily summary for one user + date */
export const fetchDailySummary = async (user, date) => {
  const res = await authAxios.get(
    `${API_URL}/api/activity/daily?user=${encodeURIComponent(user)}&date=${date}`,
  );
  return res.data;
};

/** Fetch calendar heatmap data for a date range */
export const fetchCalendar = async (user, start, end) => {
  const res = await authAxios.get(
    `${API_URL}/api/activity/calendar?user=${encodeURIComponent(user)}&start=${start}&end=${end}`,
  );
  return res.data.days;
};

/** Fetch ticket-level drill-down for a user/date (optional hour) */
export const fetchDrillDown = async (user, date, hour) => {
  let url = `${API_URL}/api/activity/drill-down?user=${encodeURIComponent(user)}&date=${date}`;
  if (hour !== undefined && hour !== null) url += `&hour=${hour}`;
  const res = await authAxios.get(url);
  return res.data.entries;
};

/** Fetch drill-down for a date range (all entries across days) */
export const fetchRangeDrillDown = async (user, start, end) => {
  const url = `${API_URL}/api/activity/drill-down?user=${encodeURIComponent(user)}&start=${start}&end=${end}`;
  const res = await authAxios.get(url);
  return res.data.entries;
};

/** Fetch leaderboard for a date range */
export const fetchActivityLeaderboard = async (start, end) => {
  const res = await authAxios.get(
    `${API_URL}/api/activity/leaderboard?start=${start}&end=${end}`,
  );
  return res.data.leaderboard;
};

/** Fetch aggregated summary for a user over a date range */
export const fetchSummary = async (user, start, end) => {
  const res = await authAxios.get(
    `${API_URL}/api/activity/summary?user=${encodeURIComponent(user)}&start=${start}&end=${end}`,
  );
  return res.data;
};

/** Fetch dependency table for a date range */
export const fetchDependencyTable = async (start, end) => {
  const res = await authAxios.get(
    `${API_URL}/api/activity/dependency?start=${start}&end=${end}`,
  );
  return res.data.dependency;
};

/** Admin: trigger activity sync */
export const triggerActivitySync = async (fullBackfill = false, quarter = "Q1_26") => {
  const res = await authAxios.post(`${API_URL}/api/admin/activity-sync`, {
    fullBackfill,
    quarter,
  });
  return res.data;
};
