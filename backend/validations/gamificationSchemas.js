import { z } from "zod";

export const gamificationSchema = z.object({
  query: z.object({
    quarter: z.string().optional().default("Q1_26"),
  }).passthrough(),
});

export const myStatsSchema = z.object({
  query: z.object({
    quarter: z.string().optional().default("Q1_26"),
    email: z.string().email("Valid email is required"),
  }).passthrough(),
});
