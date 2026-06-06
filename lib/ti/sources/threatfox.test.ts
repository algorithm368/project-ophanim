import { describe, expect, it } from "vitest";
import { threatFoxScore } from "./threatfox";

describe("threatFoxScore", () => {
  it("floors any IOC hit at 60 and caps at 100", () => {
    expect(threatFoxScore(0)).toBe(60);
    expect(threatFoxScore(50)).toBe(60);
    expect(threatFoxScore(75)).toBe(75);
    expect(threatFoxScore(100)).toBe(100);
    expect(threatFoxScore(150)).toBe(100);
  });
});
