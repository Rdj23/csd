import { useState, useEffect } from "react";

/**
 * usePersistentState — useState mirrored to localStorage, so a user's expansion
 * state and last filters survive reloads. Fails silently if storage is unavailable
 * (private mode, quota) and just behaves like normal useState.
 */
export function usePersistentState(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore write failures */
    }
  }, [key, state]);

  return [state, setState];
}
