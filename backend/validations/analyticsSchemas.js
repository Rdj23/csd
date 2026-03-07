import { z } from "zod";

const optionalString = z.string().optional();

export const analyticsQuerySchema = z.object({
  query: z.object({
    quarter: z.string().optional().default("Q1_26"),
    excludeZendesk: optionalString,
    excludeNOC: optionalString,
    owner: optionalString,
    owners: optionalString,
    region: optionalString,
    forceRefresh: optionalString,
    groupBy: z.enum(["daily", "weekly", "monthly"]).optional().default("daily"),
  }).passthrough(),
});

export const ticketDrillDownSchema = z.object({
  query: z.object({
    quarter: z.string().optional().default("Q1_26"),
    scope: z.enum(["individual", "team", "all"]).optional().default("all"),
    email: z.string().email().optional(),
    owner: optionalString,
    team: optionalString,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format").optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format").optional(),
  }).passthrough(),
});
