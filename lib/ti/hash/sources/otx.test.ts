import { describe, expect, it } from "vitest";
import { otxHashScore } from "./otx";

describe("otxHashScore", () => {
  it("is 0 with no pulses, ramps 20 base + 4 per pulse, capped at 60", () => {
    expect(otxHashScore(0)).toBe(0);
    expect(otxHashScore(1)).toBe(24);
    expect(otxHashScore(10)).toBe(60);
    expect(otxHashScore(100)).toBe(60);
  });
});
