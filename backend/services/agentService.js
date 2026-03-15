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

// In-memory store for pending agent responses (key → response)
const pendingResponses = new Map();

/**
 * Send a query to the DevRev AI Agent using the async API.
 * Returns the DevRev session DON which the webhook will reference in session_object.
 */
export async function sendAgentQuery(query, sessionObject) {
  if (!WEBHOOK_DON) {
    throw new Error("DEVREV_AGENT_WEBHOOK_DON not configured — deploy backend and create webhook first");
  }

  // Use provided sessionObject for multi-turn, or generate a unique one
  const clientSessionId = sessionObject || `dash_${crypto.randomUUID()}`;

  const res = await axios.post(
    `${DEVREV_API}/internal/ai-agents.events.execute-async`,
    {
      agent: AGENT_DON,
      event: {
        input_message: {
          message: query,
        },
      },
      session_object: clientSessionId,
      webhook_target: {
        webhook: WEBHOOK_DON,
      },
    },
    { headers }
  );

  // DevRev returns a session DON — this is what the webhook will use as session_object
  const devrevSessionId = res.data?.session?.id;

  // We poll using the client session ID, but the webhook may arrive with either
  // our clientSessionId or the DevRev session DON — register both as pending
  const pollKey = clientSessionId;
  pendingResponses.set(pollKey, { status: "pending", createdAt: Date.now() });
  if (devrevSessionId && devrevSessionId !== clientSessionId) {
    // Map DevRev session DON → our poll key so webhook can find it
    pendingResponses.set(devrevSessionId, { status: "pending", createdAt: Date.now(), aliasOf: pollKey });
  }

  logger.info({ pollKey, devrevSessionId, query: query.substring(0, 80) }, "Agent query sent via async API");

  return pollKey;
}

/**
 * Store a response received via webhook.
 * The webhook's session_object could be our clientSessionId or the DevRev DON.
 */
export function storeAgentResponse(webhookSessionId, type, text) {
  const responseData = {
    status: "done",
    type,
    text,
    receivedAt: Date.now(),
  };

  // Check if this is an alias pointing to the real poll key
  const existing = pendingResponses.get(webhookSessionId);
  if (existing?.aliasOf) {
    // Store on the real poll key
    pendingResponses.set(existing.aliasOf, responseData);
    pendingResponses.delete(webhookSessionId);
    logger.info({ webhookSessionId, resolvedTo: existing.aliasOf, type }, "Agent response stored (via alias)");
  } else {
    // Store directly
    pendingResponses.set(webhookSessionId, responseData);
    logger.info({ webhookSessionId, type }, "Agent response stored");
  }

  // Auto-cleanup after 10 minutes
  setTimeout(() => {
    pendingResponses.delete(webhookSessionId);
    if (existing?.aliasOf) pendingResponses.delete(existing.aliasOf);
  }, 10 * 60 * 1000);
}

/**
 * Poll for a response by session ID.
 */
export function pollAgentResponse(sessionId) {
  const entry = pendingResponses.get(sessionId);
  if (!entry) return { status: "not_found" };
  if (entry.aliasOf) return { status: "pending" }; // alias entry, real response not yet received
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
