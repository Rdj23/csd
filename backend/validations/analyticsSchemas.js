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
