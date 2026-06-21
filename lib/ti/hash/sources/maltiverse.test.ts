import { describe, expect, it } from "vitest";
import { classificationScore } from "./maltiverse";

describe("classificationScore", () => {
  it("scores known classifications", () => {
    expect(classificationScore("malicious")).toEqual({
      score: 85,
      malicious: true,
      allowlisted: false,
    });
    expect(classificationScore("suspicious")).toEqual({
      score: 50,
      malicious: false,
      allowlisted: false,
    });
    expect(classificationScore("whitelist")).toEqual({
      score: 0,
      malicious: false,
      allowlisted: true,
    });
  });

  it("returns undefined score for neutral/unknown (absence is not clean)", () => {
    expect(classificationScore("neutral")).toEqual({
      score: undefined,
      malicious: false,
      allowlisted: false,
    });
    expect(classificationScore(undefined)).toEqual({
      score: undefined,
      malicious: false,
      allowlisted: false,
    });
  });
});
