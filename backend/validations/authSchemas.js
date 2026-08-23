import { z } from "zod";

export const googleAuthSchema = z.object({
  body: z.object({
    credential: z.string().min(1, "Google credential is required"),
  }),
});
