import { ZodError } from "zod";
import { badRequest } from "../utils/response.js";

/**
 * Express middleware factory for Zod validation.
 * Validates req.body, req.query, and req.params against the provided schema.
 * Returns 400 with structured error details on failure.
 */
export const validate = (schema) => (req, res, next) => {
  try {
    const parsed = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    if (parsed.body) req.body = parsed.body;
    if (parsed.query) req.query = parsed.query;
    if (parsed.params) req.params = parsed.params;
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
