import { describe, it, expect } from "vitest";
import { parseAccountList, applyAccountFilter, accountCacheKey } from "../utils/queryBuilders.js";

describe("account filter builders", () => {
  it("treats a single string as one account, keeping embedded commas", () => {
    expect(parseAccountList("Acme, Inc.")).toEqual(["Acme, Inc."]);
  });

  it("trims, de-duplicates and sorts a repeated param", () => {
    expect(parseAccountList([" Zeta ", "Acme", "Zeta", ""])).toEqual(["Acme", "Zeta"]);
  });

  it("returns an empty list for missing input", () => {
    expect(parseAccountList(undefined)).toEqual([]);
    expect(parseAccountList([])).toEqual([]);
  });

  it("adds an exact $in match on account_name", () => {
    const match = {};
    applyAccountFilter(match, ["Zeta", "Acme"]);
    expect(match).toEqual({ account_name: { $in: ["Acme", "Zeta"] } });
  });

  it("leaves the match untouched when no account is selected", () => {
    const match = { closed_date: 1 };
    applyAccountFilter(match, undefined);
    expect(match).toEqual({ closed_date: 1 });
  });

  it("gives the same cache key for the same set in any order", () => {
    const a = accountCacheKey(parseAccountList(["B", "A"]));
    const b = accountCacheKey(parseAccountList(["A", "B"]));
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(accountCacheKey([])).toBe("none");
  });
});
