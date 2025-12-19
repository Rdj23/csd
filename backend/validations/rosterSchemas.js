import { z } from "zod";

export const profileStatusSchema = z.object({
  body: z.object({
    userName: z.string().min(1, "User name is required"),
  }),
});

export const backupSchema = z.object({
  query: z.object({
    userName: z.string().min(1, "User name is required"),
    teamOnly: z.string().optional().default("true"),
  }).passthrough(),
});
