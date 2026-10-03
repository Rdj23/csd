/**
 * Agent API - DevRev AI Agent query & polling
 */
import { authAxios, API_URL } from "./apiClient";

/**
 * Send a query to the DevRev AI Agent.
 * @param {string} query - Free-text question
 * @returns {{ sessionId: string }}
 */
export const sendAgentQuery = async (query, sessionObject) => {
  const res = await authAxios.post(`${API_URL}/api/agent/query`, { query, sessionObject });
  return res.data;
};

/**
 * Poll for agent response by session ID.
 * @param {string} sessionId
 * @returns {{ status: "pending"|"done"|"not_found", type?: string, text?: string }}
 */
export const pollAgentResponse = async (sessionId) => {
  const res = await authAxios.get(`${API_URL}/api/agent/poll/${sessionId}`);
  return res.data;
};
