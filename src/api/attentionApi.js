/**
 * Attention Queue API — shift-end backlog queues.
 *
 * Visibility is resolved server-side from the JWT email: a GST member sees
 * their own queue plus their teammates' (same TEAMS block), supervisors
 * (Anmol / Mashnu) see all of GST, everyone else gets { visible: false }.
 */
import { authAxios, API_URL } from "./apiClient";

/** Latest queue for the logged-in member: { isGstMember, member, queue } */
export const fetchMyAttentionQueue = async () => {
  const res = await authAxios.get(`${API_URL}/api/attention/queue`);
  return res.data?.data || res.data;
};

/**
 * Latest queue for every member the viewer may see:
 * { visible, viewer: { member, scope }, members: [{ member, email, team, isSelf, queue }] }
 */
export const fetchTeamAttentionQueues = async () => {
  const res = await authAxios.get(`${API_URL}/api/attention/team-queues`);
  return res.data?.data || res.data;
};

/**
 * Verify & Clear — backend re-checks every pending item against live DevRev;
 * items clear only when the required action verifiably happened. Pass a
 * member name to verify a visible teammate's queue (permission-checked
 * server-side); defaults to the logged-in member.
 */
export const verifyClearAttentionQueue = async (member) => {
  const res = await authAxios.post(
    `${API_URL}/api/attention/verify-clear`,
    member ? { member } : {},
  );
  return res.data?.data || res.data;
};
