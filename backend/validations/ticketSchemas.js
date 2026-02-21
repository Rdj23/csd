import { z } from "zod";

// Query string booleans arrive as strings
const boolString = z.string().optional();
const optionalString = z.string().optional();

export const liveStatsSchema = z.object({
  query: z.object({
    start: z.string().min(1, "Start date is required"),
    end: z.string().min(1, "End date is required"),
    owners: optionalString,
    teams: optionalString,
    region: optionalString,
    excludeZendesk: boolString,
    excludeNOC: boolString,
  }).passthrough(),
});

export const drilldownSchema = z.object({
  query: z.object({
    date: z.string().min(1, "Date is required"),
    metric: optionalString,
    type: optionalString,
  }).passthrough(),
});

export const byRangeSchema = z.object({
  query: z.object({
    start: z.string().min(1, "Start date is required"),
    end: z.string().min(1, "End date is required"),
    owners: optionalString,
    metric: optionalString,
    excludeZendesk: boolString,
    excludeNOC: boolString,
    region: optionalString,
  }).passthrough(),
});

export const byDateSchema = z.object({
  query: z.object({
    date: z.string().min(1, "Date is required"),
    owners: optionalString,
    metric: optionalString,
    excludeZendesk: boolString,
    excludeNOC: boolString,
    region: optionalString,
  }).passthrough(),
});

export const ticketLinksSchema = z.object({
  body: z.object({
    ticketId: z.string().min(1, "Ticket ID is required"),
  }),
});

export const issueDetailsSchema = z.object({
  body: z.object({
    issueId: z.string().min(1, "Issue ID is required"),
  }),
});

export const batchDependenciesSchema = z.object({
  body: z.object({
    ticketIds: z.array(z.string()).min(1, "At least one ticket ID is required"),
  }),
});

export const timelineRepliesSchema = z.object({
  body: z.object({
    ticketIds: z.array(z.string()).optional().default([]),
  }),
});
