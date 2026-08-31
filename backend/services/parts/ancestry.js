/**
 * parts/ancestry — THE RESOLVER — walking is_part_of links up to the product. Pure, DI'd for tests.
 *
 * Extracted from the 726-line partsService.js; logic unchanged.
 * See parts/index.js for how the resolver, the sync and the read side relate.
 */

import logger from "../../config/logger.js";

// ─────────────────────────────────────────────────────────────────────────
// 1. THE RESOLVER (pure, dependency-injected — unit tested)
// ─────────────────────────────────────────────────────────────────────────

/**
 * pickParentDon — given the links.list result for a part, return the DON of the
 * part it is_part_of (its immediate parent), or null at the root.
 *
 * Link shape: { link_type: "is_part_of", source: {id}, target: {id, type, ...} }.
 * For a child part, the is_part_of link has source = this part, target = parent.
 * We prefer the link whose source is the current part; failing that (some payloads
 * omit a clear source), we take the first is_part_of target that isn't ourselves.
 */
export const pickParentDon = (links, currentDon) => {
  const isPartOf = (links || []).filter((l) => l?.link_type === "is_part_of");
  for (const l of isPartOf) {
    const srcId = l.source?.id || l.source?.don;
    const tgtId = l.target?.id || l.target?.don;
    if (srcId === currentDon && tgtId && tgtId !== currentDon) return tgtId;
  }
  for (const l of isPartOf) {
    const tgtId = l.target?.id || l.target?.don;
    if (tgtId && tgtId !== currentDon) return tgtId;
  }
  return null;
};

/**
 * resolvePartAncestry — walk the is_part_of chain UP from a leaf part to its product.
 *
 * @param {string} leafPartDon  Full DON id of the part a ticket applies to.
 * @param {object} deps
 *   @param {(don:string)=>Promise<Array>} deps.fetchObjectLinks  links.list wrapper.
 *   @param {(id:string)=>Promise<object|null>} deps.fetchPart     parts.get wrapper.
 *   @param {Map<string,object>} [deps.partMetaCache]  memoizes parts.get within a run.
 * @returns {Promise<Array<{id,display_id,type,name}>>}  chain ordered ROOT→LEAF.
 *
 * The chain INCLUDES the leaf as its last element, so a feature's chain looks like
 * [product, capability, feature]. Stops when it reaches a part of type "product",
 * when no parent link exists, or at a safety depth (guards against cyclic links).
 */
export const resolvePartAncestry = async (leafPartDon, deps) => {
  const { fetchObjectLinks, fetchPart, partMetaCache } = deps;
  const chainLeafFirst = [];
  const seen = new Set();
  let currentDon = leafPartDon;
  let safety = 0;

  while (currentDon && !seen.has(currentDon) && safety < 25) {
    seen.add(currentDon);
    safety++;

    // Resolve this part's own metadata (name + level). Memoized per run.
    let meta = partMetaCache?.get(currentDon) || null;
    if (!meta) {
      let part = null;
      try {
        part = await fetchPart(currentDon);
      } catch (err) {
        logger.warn({ part: currentDon, err: err?.message }, "[parts] parts.get failed");
      }
      meta = {
        id: part?.id || currentDon,
        display_id: part?.display_id || null,
        type: (part?.type || "").toLowerCase() || null,
        name: part?.name || null,
      };
      partMetaCache?.set(currentDon, meta);
    }
    chainLeafFirst.push(meta);

    if (meta.type === "product") break; // reached the root product

    // Walk one level up via the is_part_of link.
    let links = [];
    try {
      links = await fetchObjectLinks(currentDon);
    } catch (err) {
      logger.warn({ part: currentDon, err: err?.message }, "[parts] links.list failed");
      break;
    }
    const parentDon = pickParentDon(links, currentDon);
    if (!parentDon) break; // no higher parent found
    currentDon = parentDon;
  }

  return chainLeafFirst.reverse(); // ROOT → LEAF
};
