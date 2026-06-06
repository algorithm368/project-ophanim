import { describe, expect, it } from "vitest";
import { exposureScore, maliciousTags } from "./shodan-internetdb";

describe("maliciousTags", () => {
  it("keeps only known-bad tags, case-insensitively", () => {
    expect(maliciousTags(["self-signed", "C2", "Malware", "cdn"])).toEqual([
      "C2",
      "Malware",
    ]);
  });

  it("returns nothing for an all-benign tag set", () => {
    expect(maliciousTags(["cloud", "cdn"])).toEqual([]);
  });
});

describe("exposureScore", () => {
  it("scores CVEs on a ramp capped at 50", () => {
    expect(exposureScore(0, false)).toBe(0);
    expect(exposureScore(1, false)).toBe(15);
    expect(exposureScore(20, false)).toBe(50);
  });

  it("adds 50 for malicious tags and caps the total at 100", () => {
    expect(exposureScore(0, true)).toBe(50);
    expect(exposureScore(20, true)).toBe(100);
  });
});
