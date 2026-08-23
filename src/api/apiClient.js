/**
 * API Client - Centralized HTTP configuration
 * Re-exports the existing authAxios and authFetch wrappers.
 * All service modules should import from here.
 */

const API_URL = import.meta.env.VITE_API_URL || "";

export { default as authAxios } from "../utils/authAxios";
export { authFetch } from "../utils/authFetch";
export { API_URL };
