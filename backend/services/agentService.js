import axios from "axios";
import crypto from "crypto";
import logger from "../config/logger.js";

const DEVREV_API = "https://api.devrev.ai";
const DEVREV_PAT = process.env.VITE_DEVREV_PAT;

// Agent DON — agent ID 4 under your devo
const AGENT_DON = process.env.DEVREV_AGENT_DON || "don:core:dvrv-us-1:devo/1iVu4ClfVV:ai_agent/4";
// Webhook DON — set via env after deploying & creating the webhook
const WEBHOOK_DON = process.env.DEVREV_AGENT_WEBHOOK_DON || "";

const headers = {
  Authorization: `Bearer ${DEVREV_PAT}`,
  "Content-Type": "application/json",
};

// In-memory store for pending agent responses (session_object → response)
const pendingResponses = new Map();

/**
 * Send a query to the DevRev AI Agent using the async API.
 * Uses a unique session_object per query. DevRev manages session memory automatically.
 */
export async function sendAgentQuery(query, sessionObject) {
  if (!WEBHOOK_DON) {
    throw new Error("DEVREV_AGENT_WEBHOOK_DON not configured — deploy backend and create webhook first");
  }

  // Generate a unique session_object if not provided (for new conversations)
  const sessionId = sessionObject || `dash_${crypto.randomUUID()}`;

  await axios.post(
    `${DEVREV_API}/internal/ai-agents.events.execute-async`,
    {
      agent: AGENT_DON,
      event: {
        input_message: {
          message: query,
        },
      },
      session_object: sessionId,
      webhook_target: {
        webhook: WEBHOOK_DON,
      },
    },
    { headers }
  );

  logger.info({ sessionId, query: query.substring(0, 80) }, "Agent query sent via async API");

  // Mark as pending
  pendingResponses.set(sessionId, { status: "pending", createdAt: Date.now() });

  return sessionId;
}

/**
 * Store a response received via webhook.
 */
export function storeAgentResponse(sessionId, type, text) {
  pendingResponses.set(sessionId, {
    status: "done",
    type, // "message" or "error"
    text,
    receivedAt: Date.now(),
  });
  logger.info({ sessionId, type }, "Agent response stored");

  // Auto-cleanup after 10 minutes
  setTimeout(() => pendingResponses.delete(sessionId), 10 * 60 * 1000);
}

/**
 * Poll for a response by session ID.
 */
export function pollAgentResponse(sessionId) {
  const entry = pendingResponses.get(sessionId);
  if (!entry) return { status: "not_found" };
  return entry;
}

// Cleanup stale entries every 15 minutes
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, entry] of pendingResponses) {
    if (entry.createdAt < cutoff || (entry.receivedAt && entry.receivedAt < cutoff)) {
      pendingResponses.delete(id);
    }
  }
}, 15 * 60 * 1000);
