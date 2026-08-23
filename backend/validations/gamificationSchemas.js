import { z } from "zod";

const datePattern = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format").optional();

export const gamificationSchema = z.object({
  query: z.object({
    quarter: z.string().optional(),
    startDate: datePattern,
    endDate: datePattern,
  }).passthrough(),
});

export const myStatsSchema = z.object({
  query: z.object({
    quarter: z.string().optional(),
    email: z.string().email("Valid email is required"),
    startDate: datePattern,
    endDate: datePattern,
  }).passthrough(),
});
