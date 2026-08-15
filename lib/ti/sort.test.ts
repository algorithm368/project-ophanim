import { describe, expect, it } from "vitest";
import { byCodeUnit } from "@/lib/ti/sort";

describe("byCodeUnit", () => {
  it("orders strings the way a bare sort() does", () => {
    const input = ["b.example.com", "a.example.com", "c.example.com"];
    expect([...input].sort(byCodeUnit)).toEqual([...input].sort());
  });

  it("returns 0 for equal strings", () => {
    expect(byCodeUnit("same", "same")).toBe(0);
  });

  it("is antisymmetric", () => {
    expect(byCodeUnit("a", "b")).toBe(-1);
    expect(byCodeUnit("b", "a")).toBe(1);
  });

  // The threatfox adapters take the last element of a sorted timestamp list as
  // the most recent sighting. That is only correct if code-unit order matches
  // chronological order for the format ThreatFox returns.
  it("orders ISO-8601 timestamps chronologically", () => {
    const times = [
      "2026-08-14 19:38:23 UTC",
      "2026-07-30 13:50:42 UTC",
      "2026-08-14 02:37:58 UTC",
    ];
    expect([...times].sort(byCodeUnit).at(-1)).toBe("2026-08-14 19:38:23 UTC");
  });

  // Uppercase sorts before lowercase by code unit. Pinning it documents that
  // callers feeding mixed case get case-sensitive grouping, not dictionary
  // order, which is why deep.ts lowercases before it sorts.
  it("sorts uppercase ahead of lowercase", () => {
    expect(["b", "A"].sort(byCodeUnit)).toEqual(["A", "b"]);
  });
});
