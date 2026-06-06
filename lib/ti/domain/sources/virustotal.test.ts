import { describe, expect, it } from "vitest";
import { normalizeCategories, vtScore } from "./virustotal";

describe("vtScore (domain)", () => {
  it("weights malicious 10x and suspicious 3x, capped at 100", () => {
    expect(vtScore(0, 0)).toBe(0);
    expect(vtScore(2, 1)).toBe(23);
    expect(vtScore(20, 0)).toBe(100);
  });
});

describe("normalizeCategories", () => {
  it("aliases vendor labels and orders by descriptive priority", () => {
    expect(
      normalizeCategories({
        a: "searchengines",
        b: "Information Technology (alphaMountain.ai)",
      }),
    ).toEqual(["Search engines", "Information technology"]);
  });

  it("merges near-identical labels into one chip", () => {
    expect(
      normalizeCategories({ a: "searchengines", b: "Search Engines and Portals" }),
    ).toEqual(["Search engines"]);
  });

  it("capitalizes unknown labels and drops blanks", () => {
    expect(normalizeCategories({ a: "weather" })).toEqual(["Weather"]);
    expect(normalizeCategories({ a: "", b: "  " })).toEqual([]);
    expect(normalizeCategories({})).toEqual([]);
  });
});
