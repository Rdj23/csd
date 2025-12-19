import { sendAgentQuery, pollAgentResponse } from "../services/agentService.js";
import logger from "../config/logger.js";

/**
 * POST /api/agent/query
 * Body: { query: string }
 * Returns: { sessionId: string }
 */
export const queryAgent = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({ success: false, error: "query is required" });
    }

    const { sessionObject } = req.body; // optional: for multi-turn conversation continuity
    const sessionId = await sendAgentQuery(query.trim(), sessionObject);
    res.json({ success: true, sessionId });
  } catch (err) {
    logger.error({ err }, "Agent query failed");
    res.status(500).json({ success: false, error: err.message || "Agent query failed" });
  }
};

/**
 * GET /api/agent/poll/:sessionId
 * Returns: { status: "pending" | "done" | "not_found", type?, text? }
 */
export const pollAgent = (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: "sessionId is required" });
  }

  const result = pollAgentResponse(sessionId);
  res.json({ success: true, ...result });
};
