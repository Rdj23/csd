/**
 * Shared hooks — cross-feature only.
 *
 * A hook belongs here when more than one feature uses it. Anything used by a
 * single feature lives in that feature's own `hooks/` folder instead
 * (see features/parts/hooks/usePersistentState.js).
 */
export { useGamification } from "./useGamification";
export { useRemarks } from "./useRemarks";
export { useProfileStats } from "./useProfileStats";
