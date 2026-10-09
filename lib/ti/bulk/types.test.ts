import { describe, expect, it } from "vitest";
import { depthOf, type RowSummary } from "./types";

const row = (over: Partial<RowSummary>): RowSummary => ({
  id: 0, indicator: "x", kind: "ip", state: "pending", pending: [], missing: [], ...over,
});

describe("depthOf", () => {
  it.each([
    [row({ state: "internal" }), "none"],
    [row({ state: "pending" }), "none"],
    [row({ state: "feed-only" }), "feed"],
    [row({ state: "cached" }), "full"],
    [row({ state: "full", bucket: "B" }), "full"],
    [row({ state: "full", bucket: "D" }), "free"],
    [row({ state: "partial", bucket: "C" }), "free"],
    [row({ state: "pass1", bucket: "C" }), "free"],
  ])("%o is %s", (r, depth) => expect(depthOf(r)).toBe(depth));
});
