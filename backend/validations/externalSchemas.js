import { z } from "zod";

const datePattern = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format").optional();

export const externalCSATSchema = z.object({
  query: z.object({
    quarter: z.string().optional().default("Q1_26"),
    startDate: datePattern,
    endDate: datePattern,
    email: z.string().email().optional(),
  }).passthrough(),
});

export const externalAnalyticsSchema = z.object({
  query: z.object({
    quarter: z.string().optional().default("Q1_26"),
    startDate: datePattern,
    endDate: datePattern,
  }).passthrough(),
});
