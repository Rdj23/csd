/**
 * Attention Queue API — per-user shift-end backlog queue.
 * Backend resolves the member from the JWT email, so these endpoints can
 * only ever return/clear the logged-in user's own queue.
 */
import { authAxios, API_URL } from "./apiClient";

/** Latest queue for the logged-in member: { isGstMember, member, queue } */
export const fetchMyAttentionQueue = async () => {
  const res = await authAxios.get(`${API_URL}/api/attention/queue`);
  return res.data?.data || res.data;
};

/**
 * Verify & Clear — backend re-checks every pending item against live DevRev;
 * items clear only when the required action verifiably happened.
 */
export const verifyClearAttentionQueue = async () => {
  const res = await authAxios.post(`${API_URL}/api/attention/verify-clear`);
  return res.data?.data || res.data;
};
