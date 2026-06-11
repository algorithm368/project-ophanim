import { describe, expect, it } from "vitest";
import { pdIso, riskToScore } from "@/lib/ti/hash/sources/pulsedive";

describe("pdIso", () => {
  it("normalizes a 'YYYY-MM-DD HH:MM:SS' UTC stamp to ISO", () => {
    expect(pdIso("2017-10-18 04:03:08")).toBe("2017-10-18T04:03:08.000Z");
  });

  it("returns undefined for missing or unparseable stamps", () => {
    expect(pdIso(undefined)).toBeUndefined();
    expect(pdIso("")).toBeUndefined();
    expect(pdIso("not a date")).toBeUndefined();
  });
});

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
