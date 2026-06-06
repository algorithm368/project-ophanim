import { describe, expect, it } from "vitest";
import { LEVEL, criminalIpScore } from "./criminalip";

describe("criminalIpScore", () => {
  it("takes the stronger of the inbound/outbound bands", () => {
    expect(criminalIpScore("safe", "critical")).toBe(90);
    expect(criminalIpScore("moderate", "low")).toBe(40);
  });

  it("is case-insensitive and treats unknown bands as 0", () => {
    expect(criminalIpScore("DANGEROUS", undefined)).toBe(70);
    expect(criminalIpScore("???", "")).toBe(0);
  });

  it("exposes the band table", () => {
    expect(LEVEL.critical).toBe(90);
    expect(LEVEL.safe).toBe(0);
  });
});
