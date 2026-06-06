import { describe, expect, it } from "vitest";
import { otxDomainScore } from "./otx";

describe("otxDomainScore", () => {
  it("is a low, capped nudge (2 per pulse, max 35)", () => {
    expect(otxDomainScore(0)).toBe(0);
    expect(otxDomainScore(1)).toBe(2);
    expect(otxDomainScore(10)).toBe(20);
    expect(otxDomainScore(100)).toBe(35);
  });
});
