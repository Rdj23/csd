/**
 * Shared query/filter builders for MongoDB match conditions.
 * Eliminates duplication across analyticsController, ticketController,
 * gamificationController, and externalController.
 */

/** Escape special regex characters so user input is treated as a literal string. */
export const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mutates `match` to add owner filter. Handles comma-separated list and "All". */
export const applyOwnerFilter = (match, owners) => {
  if (!owners || owners === "All" || !owners.length) return;
  const list = owners.split(",").filter((o) => o.trim());
  if (list.length > 0) match.owner = { $in: list };
};

/** Mutates `match` to add single-owner regex filter (for analytics individual view). */
export const applySingleOwnerFilter = (match, owner) => {
  if (owner && owner !== "All") {
    match.owner = { $regex: escapeRegex(owner), $options: "i" };
  }
};

/** Mutates `match` to add region filter. */
export const applyRegionFilter = (match, region) => {
  if (!region || region === "All" || !region.length) return;
  match.region = { $in: region.split(",").filter((r) => r.trim()) };
};

/** Mutates `match` to add is_zendesk/is_noc exclusion filters. */
export const applyExclusionFilters = (match, { excludeZendesk, excludeNOC } = {}) => {
  if (excludeZendesk === "true") match.is_zendesk = { $ne: true };
  if (excludeNOC === "true") match.is_noc = { $ne: true };
};

/**
 * Mutates `match` to add cohort filter with C4S default handling.
 * C4S tickets include those with null/empty account_cohort.
 *
 * @param {Object} match - The match conditions object to mutate
 * @param {string|null} cohortFilter - Comma-separated cohort names (e.g. "C4S,Key")
 */
export const applyCohortFilter = (match, cohortFilter) => {
  if (!cohortFilter) return;
  const cohortList = cohortFilter.split(",").map((c) => c.trim());
  const hasC4S = cohortList.some((c) => c.toLowerCase() === "c4s");
  const regexFilters = cohortList.map((c) => new RegExp(escapeRegex(c), "i"));

  if (hasC4S) {
    match.$or = [
      { account_cohort: { $in: regexFilters } },
      { account_cohort: null },
      { account_cohort: "" },
      { account_cohort: { $exists: false } },
    ];
  } else if (cohortList.length === 1) {
    match.account_cohort = { $regex: escapeRegex(cohortList[0]), $options: "i" };
  } else {
    match.account_cohort = { $in: regexFilters };
  }
};

/** Adds backlog filter ($expr for tickets older than 15 days). */
export const applyBacklogFilter = (match, metric) => {
  if (metric === "backlog") {
    match.$expr = { $gt: [{ $subtract: ["$closed_date", "$created_date"] }, 15 * 86400000] };
  }
};

/**
 * Mutates `match` to apply the dashboard-wide "Resolved By" filter.
 * Accepts a comma-separated list: "engineer", "agent", or both. Both checked
 * (or empty / unspecified) = no filter applied. This mirrors the frontend
 * checkbox UX where both ticked === "show everything".
 *
 * Why we filter on the stored `resolved_by` field rather than re-deriving from
 * `agent_resolved` + `owner` at query time: classification was already done at
 * sync time and indexed via { closed_date, resolved_by }. Re-deriving would
 * defeat the index.
 */
export const applyResolvedByFilter = (match, resolvedBy) => {
  if (!resolvedBy) return;
  const list = String(resolvedBy).split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0 || list.length >= 2) return; // both or none → no filter
  match.resolved_by = list[0];
};
