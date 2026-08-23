/**
 * Unit tests for the DevRev part-ancestry resolver (partsService).
 *
 * These exercise the PURE link-walking logic in isolation — no DB, no network.
 * The canonical chain from the spec is used as the primary fixture:
 *
 *   feature/269 ──is_part_of──▶ feature/263 ──is_part_of──▶ capability/30 ──is_part_of──▶ product/5
 *   (FEAT-269)                  (FEAT-263)                  (CAPL-30)                     (PROD-5 "API")
 *
 * resolvePartAncestry walks UP that chain and returns it ordered ROOT→LEAF.
 */
import { describe, it, expect, vi } from "vitest";
import { resolvePartAncestry, pickParentDon } from "../services/partsService.js";

const DON = {
  feat269: "don:core:dvrv-us-1:devo/1iVu4ClfVV:feature/269",
  feat263: "don:core:dvrv-us-1:devo/1iVu4ClfVV:feature/263",
  capl30: "don:core:dvrv-us-1:devo/1iVu4ClfVV:capability/30",
  prod5: "don:core:dvrv-us-1:devo/1iVu4ClfVV:product/5",
};

// Part metadata returned by the mocked parts.get.
const PART_META = {
  [DON.feat269]: { id: DON.feat269, display_id: "FEAT-269", type: "feature", name: "Target Users by their Identities" },
  [DON.feat263]: { id: DON.feat263, display_id: "FEAT-263", type: "feature", name: "Create Campaign" },
  [DON.capl30]: { id: DON.capl30, display_id: "CAPL-30", type: "capability", name: "Campaign APIs" },
  [DON.prod5]: { id: DON.prod5, display_id: "PROD-5", type: "product", name: "API" },
};

// is_part_of links returned by the mocked links.list — each child points UP to its parent.
const LINKS = {
  [DON.feat269]: [
    { link_type: "is_part_of", source: { id: DON.feat269 }, target: { id: DON.feat263, type: "feature" } },
  ],
  [DON.feat263]: [
    // throw in unrelated link types to prove the resolver ignores them
    { link_type: "related_to", source: { id: DON.feat263 }, target: { id: "don:...:issue/9" } },
    { link_type: "is_part_of", source: { id: DON.feat263 }, target: { id: DON.capl30, type: "capability" } },
  ],
  [DON.capl30]: [
    { link_type: "is_part_of", source: { id: DON.capl30 }, target: { id: DON.prod5, type: "product" } },
  ],
  [DON.prod5]: [], // root product — no parent
};

const makeDeps = () => ({
  fetchPart: vi.fn(async (id) => PART_META[id] || null),
  fetchObjectLinks: vi.fn(async (don) => LINKS[don] || []),
  partMetaCache: new Map(),
});

describe("pickParentDon", () => {
  it("returns the is_part_of target whose source is the current part", () => {
    expect(pickParentDon(LINKS[DON.feat263], DON.feat263)).toBe(DON.capl30);
  });

  it("ignores non-is_part_of links", () => {
    const links = [{ link_type: "related_to", source: { id: "x" }, target: { id: "y" } }];
    expect(pickParentDon(links, "x")).toBeNull();
  });

  it("returns null at the root (no links)", () => {
    expect(pickParentDon([], DON.prod5)).toBeNull();
  });

  it("falls back to the first is_part_of target when source isn't the current part", () => {
    const links = [{ link_type: "is_part_of", target: { id: DON.prod5 } }];
    expect(pickParentDon(links, DON.capl30)).toBe(DON.prod5);
  });
});

describe("resolvePartAncestry", () => {
  it("walks the full chain and returns it ordered root → leaf", async () => {
    const deps = makeDeps();
    const chain = await resolvePartAncestry(DON.feat269, deps);

    expect(chain.map((n) => n.id)).toEqual([DON.prod5, DON.capl30, DON.feat263, DON.feat269]);
    expect(chain.map((n) => n.display_id)).toEqual(["PROD-5", "CAPL-30", "FEAT-263", "FEAT-269"]);
    expect(chain.map((n) => n.type)).toEqual(["product", "capability", "feature", "feature"]);
    // The root is the product "API" (PROD-5) per the spec.
    expect(chain[0]).toMatchObject({ display_id: "PROD-5", type: "product", name: "API" });
    // The leaf is the part the ticket actually applies to.
    expect(chain[chain.length - 1].id).toBe(DON.feat269);
  });

  it("stops as soon as it reaches a product (doesn't over-walk)", async () => {
    const deps = makeDeps();
    await resolvePartAncestry(DON.feat269, deps);
    // links.list is called for feat269, feat263, capl30 — NOT for prod5 (we stop there).
    expect(deps.fetchObjectLinks).toHaveBeenCalledTimes(3);
    expect(deps.fetchObjectLinks).not.toHaveBeenCalledWith(DON.prod5);
  });

  it("resolving from a mid-level part yields just that subtree's chain", async () => {
    const deps = makeDeps();
    const chain = await resolvePartAncestry(DON.capl30, deps);
    expect(chain.map((n) => n.id)).toEqual([DON.prod5, DON.capl30]);
  });

  it("a product resolves to a single-node chain with no link walking", async () => {
    const deps = makeDeps();
    const chain = await resolvePartAncestry(DON.prod5, deps);
    expect(chain.map((n) => n.id)).toEqual([DON.prod5]);
    expect(deps.fetchObjectLinks).not.toHaveBeenCalled();
  });

  it("stops gracefully when a parent link is missing (returns partial chain)", async () => {
    const deps = makeDeps();
    // Break the chain: capability/30 has no parent link.
    deps.fetchObjectLinks = vi.fn(async (don) => (don === DON.capl30 ? [] : LINKS[don] || []));
    const chain = await resolvePartAncestry(DON.feat269, deps);
    // Walk halts at capability/30; partial chain still ordered root→leaf.
    expect(chain.map((n) => n.id)).toEqual([DON.capl30, DON.feat263, DON.feat269]);
  });

  it("is resilient to cyclic links via the safety guard", async () => {
    const deps = makeDeps();
    deps.fetchObjectLinks = vi.fn(async () => [
      { link_type: "is_part_of", source: { id: DON.feat269 }, target: { id: DON.feat263 } },
      { link_type: "is_part_of", source: { id: DON.feat263 }, target: { id: DON.feat269 } },
    ]);
    deps.fetchPart = vi.fn(async (id) => ({ id, display_id: "X", type: "feature", name: "x" }));
    const chain = await resolvePartAncestry(DON.feat269, deps);
    // No infinite loop; `seen` set stops re-visiting.
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.length).toBeLessThan(25);
  });

  it("memoizes parts.get within a run via partMetaCache", async () => {
    const deps = makeDeps();
    await resolvePartAncestry(DON.feat269, deps);
    // 4 distinct parts in the chain → 4 parts.get calls, none repeated.
    expect(deps.fetchPart).toHaveBeenCalledTimes(4);
  });
});
