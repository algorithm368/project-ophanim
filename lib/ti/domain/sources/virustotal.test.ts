import { describe, expect, it } from "vitest";
import { domainRelationsFromVt, normalizeCategories, vtScore } from "./virustotal";
import type { VtRelationships } from "../../vt-relationships";

describe("vtScore (domain)", () => {
  it("weights malicious 10x and suspicious 3x, capped at 100", () => {
    expect(vtScore(0, 0)).toBe(0);
    expect(vtScore(2, 1)).toBe(23);
    expect(vtScore(20, 0)).toBe(100);
  });
});

describe("domainRelationsFromVt", () => {
  it("recovers resolved IPs from resolution ids + adds communicating samples", () => {
    const rels: VtRelationships = {
      resolutions: {
        data: [{ type: "resolution", id: "93.184.216.34example.com" }],
      },
      communicating_files: { data: [{ type: "file", id: "def456" }] },
    };
    expect(domainRelationsFromVt("example.com", rels)).toEqual([
      { value: "93.184.216.34", type: "ip", relation: "resolved" },
      { value: "def456", type: "hash", relation: "communicating" },
    ]);
  });

  it("is empty when there are no relationships", () => {
    expect(domainRelationsFromVt("example.com", undefined)).toEqual([]);
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
