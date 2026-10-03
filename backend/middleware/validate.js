import { ZodError } from "zod";
import { badRequest } from "../utils/response.js";

/**
 * Express middleware factory for Zod validation.
 * Validates req.body, req.query, and req.params against the provided schema.
 * Returns 400 with structured error details on failure.
 */
export const validate = (schema) => (req, res, next) => {
  try {
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    // In Express 5, req.query is a read-only getter — don't reassign.
    // Controllers already handle their own defaults via destructuring.
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(res, "Validation failed", err.issues.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })));
    }
    next(err);
  }
};
