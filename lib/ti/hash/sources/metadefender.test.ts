import { describe, expect, it } from "vitest";
import { VERDICT_FLOOR, metadefenderScore } from "./metadefender";

describe("metadefenderScore", () => {
  it("uses the multi-AV detection ratio when it dominates", () => {
    expect(metadefenderScore(5, 10, "no_threat")).toBe(50);
    expect(metadefenderScore(1, 40, "benign")).toBe(3);
  });

  it("applies the verdict floor when the AV ratio is weak or absent", () => {
    expect(metadefenderScore(0, 0, "malicious")).toBe(75);
    expect(metadefenderScore(0, 10, "suspicious")).toBe(45);
  });

  it("treats an unknown verdict as a 0 floor", () => {
    expect(metadefenderScore(10, 10, "unknown")).toBe(100);
    expect(VERDICT_FLOOR.malicious).toBe(75);
  });
});
