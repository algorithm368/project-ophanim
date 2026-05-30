import { describe, expect, it } from "vitest";
import { riskToScore } from "@/lib/ti/hash/sources/pulsedive";

describe("riskToScore", () => {
  it("maps Pulsedive risk levels to 0-100", () => {
    expect(riskToScore("critical")).toBe(90);
    expect(riskToScore("high")).toBe(75);
    expect(riskToScore("medium")).toBe(45);
    expect(riskToScore("low")).toBe(20);
    expect(riskToScore("none")).toBe(0);
    expect(riskToScore("unknown")).toBeUndefined();
    expect(riskToScore(undefined)).toBeUndefined();
  });
});
