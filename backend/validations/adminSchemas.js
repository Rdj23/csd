import { z } from "zod";

export const jobStatusSchema = z.object({
  params: z.object({
    jobId: z.string().min(1, "Job ID is required"),
  }),
  query: z.object({
    queue: z.enum(["historical-sync", "analytics", "ticket-sync", "timeline", "roster"]).optional(),
  }).passthrough(),
});

export const syncTicketSchema = z.object({
  body: z.object({
    ticketId: z.string().min(1, "Ticket ID is required"),
  }),
});
