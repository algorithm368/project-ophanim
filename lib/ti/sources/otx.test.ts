import { describe, expect, it } from "vitest";
import { otxScore } from "./otx";

describe("otxScore (IP)", () => {
  it("is 0 with no pulses, then ramps from a 25 base", () => {
    expect(otxScore(0)).toBe(0);
    expect(otxScore(1)).toBe(35);
    expect(otxScore(3)).toBe(55);
  });

  it("caps at 100", () => {
    expect(otxScore(100)).toBe(100);
  });
});
