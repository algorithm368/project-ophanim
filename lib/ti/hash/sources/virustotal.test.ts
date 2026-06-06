import { describe, expect, it } from "vitest";
import { isoFromEpoch, vtFileScore } from "./virustotal";

describe("vtFileScore (hash)", () => {
  it("weights malicious 8x and suspicious 3x, capped at 100", () => {
    expect(vtFileScore(0, 0)).toBe(0);
    expect(vtFileScore(3, 2)).toBe(30);
    expect(vtFileScore(20, 0)).toBe(100);
  });
});

describe("isoFromEpoch", () => {
  it("converts unix seconds to an ISO string", () => {
    expect(isoFromEpoch(1700000000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("returns undefined for 0 / missing timestamps", () => {
    expect(isoFromEpoch(0)).toBeUndefined();
    expect(isoFromEpoch(undefined)).toBeUndefined();
  });
});
