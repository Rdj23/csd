/**
 * webhookSchemas.js — Zod validation schema for DevRev webhook payloads.
 *
 * WHAT IS ZOD:
 * Zod is a TypeScript-first schema validation library. It defines WHAT SHAPE
 * your data should have, and rejects anything that doesn't match.
 * Think of it as a bouncer at a club: "You need to have an ID (type field)
 * or a VIP pass (ai_agent_response) to get in."
 *
 * WHY VALIDATE WEBHOOKS:
 * Even after HMAC signature verification proves the request is FROM DevRev,
 * the payload could be malformed (DevRev API bug, version change, etc.).
 * Validation catches bad data before it reaches your business logic,
 * preventing cryptic runtime errors deep in the controller.
 *
 * WHY SO MANY .optional() FIELDS:
 * DevRev sends DIFFERENT payload shapes for different event types:
 * - Ticket events: { type: "work_updated", ... }
 * - Agent responses: { ai_agent_response: { ... } }
 * - Verification: { type: "webhook_verify", challenge: "abc" }
 * - Wrapped format: { verify: { challenge: "abc" } }
 *
 * Since one schema must handle ALL variants, most fields are optional.
 * The controller then branches on which fields are actually present.
 *
 * .passthrough() — Allows extra fields that aren't in our schema.
 * DevRev payloads have many fields we don't use (org_id, workspace, etc.).
 * Without passthrough(), Zod would strip them. While we don't need them,
 * stripping could cause issues if we ever log the full payload for debugging.
 */

import { z } from "zod";

export const devrevWebhookSchema = z.object({
  body: z.object({
    // Standard event type: "work_created", "work_updated", "work_deleted",
    // "timeline_entry_created", "webhook_verify", etc.
    type: z.string().optional(),

    // Challenge string for webhook URL verification handshake
    challenge: z.string().optional(),

    // AI Agent async API response — present when DevRev's agent replies
    // Has its OWN structure (agent_response + session_object), no top-level "type"
    ai_agent_response: z.object({
      agent_response: z.string(),     // "message" or "error"
      session_object: z.string(),     // Correlation ID to match request→response
    }).passthrough().optional(),

    // Some DevRev events wrap the payload in a "payload" envelope
    payload: z.object({
      ai_agent_response: z.any(),     // z.any() because we just need to know it exists
    }).passthrough().optional(),

    // Alternative verification format used by some DevRev webhook versions
    verify: z.object({
      challenge: z.string(),
    }).optional(),
  }).passthrough(), // Allow extra fields DevRev sends that we don't validate
});
