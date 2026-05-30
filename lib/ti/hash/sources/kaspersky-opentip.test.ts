import { describe, expect, it } from "vitest";
import { zoneToScore } from "@/lib/ti/hash/sources/kaspersky-opentip";

describe("zoneToScore", () => {
  it("maps Kaspersky zones to score + malicious", () => {
    expect(zoneToScore("Red")).toEqual({ score: 90, malicious: true });
    expect(zoneToScore("Yellow")).toEqual({ score: 45, malicious: false });
    expect(zoneToScore("Green")).toEqual({ score: 0, malicious: false });
    // Grey = unknown: no score, not clean.
    expect(zoneToScore("Grey")).toEqual({ score: undefined, malicious: false });
    expect(zoneToScore(undefined)).toEqual({
      score: undefined,
      malicious: false,
    });
  });
});
