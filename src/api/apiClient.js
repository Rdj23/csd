/**
 * The single entry point for talking to the API.
 *
 * WHICH CLIENT DO I USE?
 *   authAxios  — default for everything. Interceptors attach the bearer token
 *                and log the user out on 401, so no call site handles auth.
 *                Rejects on non-2xx, so errors surface as exceptions.
 *   authFetch  — the fetch-based client. Use ONLY when a call site needs the
 *                raw Response: reading ETag headers, treating 304 as success,
 *                or streaming. axios rejects non-2xx, which makes 304
 *                revalidation awkward — that is the whole reason this exists.
 *
 * NEW CODE SHOULD NOT IMPORT EITHER DIRECTLY. Add a function to the matching
 * src/api/<domain>Api.js module instead, so every endpoint this app calls is
 * discoverable in one folder rather than spread across components.
 */

const API_URL = import.meta.env.VITE_API_URL || "";

export { default as authAxios } from "./authAxios";
export { authFetch } from "./authFetch";
export { API_URL };
