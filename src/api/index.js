/**
 * API Layer - Central re-export
 * Import all API functions from here: import { fetchTickets, fetchLeaderboard } from "@/api"
 */
export { API_URL, authAxios, authFetch } from "./apiClient";

export { loginWithGoogle } from "./authApi";

export {
  fetchTickets,
  fetchDependencies,
  fetchTicketTimeline,
} from "./ticketApi";

export { fetchAnalyticsData, fetchNOCAnalytics } from "./analyticsApi";

export { fetchLeaderboard, fetchMyStats } from "./gamificationApi";

export {
  fetchUsers,
  fetchRemarkHistory,
  postLocalRemark,
  postDevRevComment,
} from "./remarkApi";

export { fetchViews, saveView, deleteView } from "./viewApi";

export { fetchBackupInfo, fetchProfileStatus, fetchFullRoster } from "./rosterApi";
