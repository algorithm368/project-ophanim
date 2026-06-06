import { describe, expect, it } from "vitest";
import { greyNoiseScore } from "./greynoise";

describe("greyNoiseScore", () => {
  it("maps classifications to a 0-100 contribution", () => {
    expect(greyNoiseScore("malicious")).toBe(80);
    expect(greyNoiseScore("benign")).toBe(0);
    expect(greyNoiseScore("unknown")).toBe(30);
  });

  it("treats an absent classification as unknown", () => {
    expect(greyNoiseScore(undefined)).toBe(30);
  });
});
