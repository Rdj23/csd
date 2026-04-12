import axios from "axios";
import crypto from "crypto";
import logger from "../config/logger.js";

const DEVREV_API = "https://api.devrev.ai";
const DEVREV_PAT = process.env.DEVREV_PAT || process.env.VITE_DEVREV_PAT;

// Agent DON — agent ID 4 under your devo
const AGENT_DON = process.env.DEVREV_AGENT_DON || "don:core:dvrv-us-1:devo/1iVu4ClfVV:ai_agent/4";
// Webhook DON — set via env after deploying & creating the webhook
const WEBHOOK_DON = process.env.DEVREV_AGENT_WEBHOOK_DON || "";

const headers = {
  Authorization: `Bearer ${DEVREV_PAT}`,
  "Content-Type": "application/json",
};

// Retry configuration for the DevRev async API call
const AGENT_API_TIMEOUT = 15000;     // 15s per attempt (DevRev can be slow)
const AGENT_MAX_RETRIES = 3;         // up to 3 attempts total
const AGENT_RETRY_DELAYS = [2000, 4000, 8000]; // exponential backoff: 2s, 4s, 8s

// In-memory store for pending agent responses (key → response)
const pendingResponses = new Map();

/**
 * Fire a single request to DevRev's async agent API with a timeout.
 * Separated out so the retry wrapper stays clean.
 */
async function callDevRevAgentAPI(payload) {
  return axios.post(
    `${DEVREV_API}/internal/ai-agents.events.execute-async`,
    payload,
    { headers, timeout: AGENT_API_TIMEOUT }
  );
}

/**
 * Retry wrapper with exponential backoff.
 * Only retries on network errors, timeouts, and 5xx responses — NOT on 4xx (bad request).
 */
async function callWithRetry(payload) {
  let lastError;
  for (let attempt = 0; attempt < AGENT_MAX_RETRIES; attempt++) {
    try {
      return await callDevRevAgentAPI(payload);
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isRetryable = !status || status >= 500 || err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";

      if (!isRetryable || attempt === AGENT_MAX_RETRIES - 1) {
        throw err;
      }

      const delay = AGENT_RETRY_DELAYS[attempt] || 8000;
      logger.warn(
        { attempt: attempt + 1, status, code: err.code, delay },
        "DevRev agent API call failed, retrying"
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * Send a query to the DevRev AI Agent using the async API.
 * Returns the DevRev session DON which the webhook will reference in session_object.
 * Includes retry with exponential backoff for transient failures.
 */
export async function sendAgentQuery(query, sessionObject) {
  if (!WEBHOOK_DON) {
    throw new Error("DEVREV_AGENT_WEBHOOK_DON not configured — deploy backend and create webhook first");
  }

  // Use provided sessionObject for multi-turn, or generate a unique one
  const clientSessionId = sessionObject || `dash_${crypto.randomUUID()}`;

  const payload = {
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
  };

  // Register pending BEFORE the API call so webhook responses that arrive
  // extremely fast (race condition) are not lost
  const pollKey = clientSessionId;
  pendingResponses.set(pollKey, { status: "pending", createdAt: Date.now() });

  let res;
  try {
    res = await callWithRetry(payload);
  } catch (err) {
    // Clean up the pending entry on total failure
    pendingResponses.delete(pollKey);
    throw err;
  }

  // DevRev returns a session DON — this is what the webhook will use as session_object
  const devrevSessionId = res.data?.session?.id;

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

// Cleanup stale entries every 15 minutes.
// Uses both createdAt and receivedAt to catch all entry types:
// - Pending entries have createdAt (set when query is sent)
// - Completed entries have receivedAt (set when webhook delivers response)
// - Alias entries have createdAt (set during alias registration)
// If neither timestamp exists, the entry is malformed and should be removed.
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - STALE_THRESHOLD_MS;
  for (const [id, entry] of pendingResponses) {
    const timestamp = entry.createdAt || entry.receivedAt || 0;
    if (timestamp < cutoff) {
      pendingResponses.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS);
