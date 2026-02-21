/**
 * Standard API response envelope.
 *
 * Success: { success: true,  data, meta? }
 * Error:   { success: false, error: { message, details? }, meta? }
 */

export const ok = (res, data, meta) => {
  // Spread data at top level so frontend can read properties directly
  // (e.g. data.tickets, data.clientId) without unwrapping data.data
  const body = { success: true, ...(data && typeof data === "object" && !Array.isArray(data) ? data : { data }) };
  if (meta) body.meta = meta;
  return res.json(body);
};

export const created = (res, data, meta) => {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(201).json(body);
};

export const accepted = (res, data, meta) => {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(202).json(body);
};

export const fail = (res, status, message, details) => {
  const body = { success: false, error: { message } };
  if (details) body.error.details = details;
  return res.status(status).json(body);
};

export const badRequest = (res, message, details) =>
  fail(res, 400, message, details);

export const notFound = (res, message = "Not found") =>
  fail(res, 404, message);

export const serverError = (res, message = "Internal server error", details) =>
  fail(res, 500, message, details);
