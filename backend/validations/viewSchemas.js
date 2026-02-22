import { z } from "zod";

export const getViewsSchema = z.object({
  params: z.object({
    userId: z.string().min(1, "User ID is required"),
  }),
});

export const createViewSchema = z.object({
  body: z.object({
    userId: z.string().min(1, "User ID is required"),
    name: z.string().min(1, "View name is required"),
    filters: z.record(z.unknown()),
  }),
});

export const deleteViewSchema = z.object({
  params: z.object({
    userId: z.string().min(1, "User ID is required"),
    viewId: z.string().min(1, "View ID is required"),
  }),
});
