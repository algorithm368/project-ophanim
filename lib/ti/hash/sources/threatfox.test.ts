import { describe, expect, it } from "vitest";
import { threatFoxScore } from "./threatfox";

describe("threatFoxScore", () => {
  it("floors any hit at 60 and caps at 100", () => {
    expect(threatFoxScore(0)).toBe(60);
    expect(threatFoxScore(80)).toBe(80);
    expect(threatFoxScore(150)).toBe(100);
  });
});
