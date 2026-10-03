import { z } from "zod";

export const getRemarkSchema = z.object({
  params: z.object({
    ticketId: z.string().min(1, "Ticket ID is required"),
  }),
});

export const createRemarkSchema = z.object({
  body: z.object({
    ticketId: z.string().min(1, "Ticket ID is required"),
    user: z.string().min(1, "User is required"),
    text: z.string().min(1, "Text is required").max(5000, "Text must be under 5000 characters"),
  }),
});

export const createCommentSchema = z.object({
  body: z.object({
    ticketId: z.string().min(1, "Ticket ID is required"),
    body: z.string().min(1, "Comment body is required"),
  }),
});
