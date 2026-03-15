import { z } from "zod";

export const devrevWebhookSchema = z.object({
  body: z.object({
    type: z.string().optional(),
    challenge: z.string().optional(),
    // AI Agent async API response — no "type" field at top level
    ai_agent_response: z.object({
      agent_response: z.string(),
      session_object: z.string(),
    }).passthrough().optional(),
    // Wrapped format
    payload: z.object({
      ai_agent_response: z.any(),
    }).passthrough().optional(),
    // Verify challenge format
    verify: z.object({
      challenge: z.string(),
    }).optional(),
  }).passthrough(),
});
