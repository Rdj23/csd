import { z } from "zod";

const optionalString = z.string().optional();
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "Use YYYY-MM-DD format")
  .optional();

/**
 * GET /api/parts-tree — filters arrive as comma-separated strings (same convention as
 * analytics' `owners`/`cohorts`). The controller splits them into arrays.
 */
export const partsTreeSchema = z.object({
  query: z
    .object({
      priorities: optionalString, // e.g. "P0,P1"
      statuses: optionalString, // team vocab: "open,pending,on hold,solved"
      accounts: optionalString,
      subtypes: optionalString, // classification: "query,bug,feature"
      regions: optionalString, // e.g. "APAC,EMEA"
      dateFrom: dateString,
      dateTo: dateString,
      forceRefresh: optionalString,
    })
    .passthrough(),
});

/** GET /api/parts/:id/tickets — same filters plus pagination. */
export const partTicketsSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  query: z
    .object({
      priorities: optionalString,
      statuses: optionalString,
      accounts: optionalString,
      subtypes: optionalString,
      regions: optionalString,
      dateFrom: dateString,
      dateTo: dateString,
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
    })
    .passthrough(),
});
