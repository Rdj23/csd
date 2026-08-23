import { z } from "zod";

const optionalString = z.string().optional();

export const nocQuerySchema = z.object({
  query: z.object({
    startDate: optionalString,
    endDate: optionalString,
    rca: optionalString,
    reporter: optionalString,
    owner: optionalString,
    confirmationBy: optionalString,
    showL2Only: optionalString,
  }).passthrough(),
});
