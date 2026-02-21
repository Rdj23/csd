import { z } from "zod";

export const devrevWebhookSchema = z.object({
  body: z.object({
    type: z.string().min(1, "Event type is required"),
    challenge: z.string().optional(),
  }).passthrough(),
});
