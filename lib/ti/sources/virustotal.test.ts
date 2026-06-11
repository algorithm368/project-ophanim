import { describe, expect, it } from "vitest";
import { ipRelationsFromVt, vtScore } from "./virustotal";
import type { VtRelationships } from "../vt-relationships";

describe("vtScore (IP)", () => {
  it("weights malicious 10x and suspicious 3x, capped at 100", () => {
    expect(vtScore(0, 0)).toBe(0);
    expect(vtScore(2, 1)).toBe(23);
    expect(vtScore(20, 0)).toBe(100);
  });
});

describe("ipRelationsFromVt", () => {
  it("recovers hosted domains from resolution ids + adds communicating samples", () => {
    const rels: VtRelationships = {
      resolutions: {
        data: [
          { type: "resolution", id: "8.8.8.8dns.google" },
          { type: "resolution", id: "8.8.8.8google-public-dns-a.google.com" },
        ],
      },
      communicating_files: { data: [{ type: "file", id: "abc123" }] },
    };
    expect(ipRelationsFromVt("8.8.8.8", rels)).toEqual([
      { value: "dns.google", type: "domain", relation: "hosted" },
      {
        value: "google-public-dns-a.google.com",
        type: "domain",
        relation: "hosted",
      },
      { value: "abc123", type: "hash", relation: "communicating" },
    ]);
  });

  it("is empty when there are no relationships", () => {
    expect(ipRelationsFromVt("8.8.8.8", undefined)).toEqual([]);
  });
});
