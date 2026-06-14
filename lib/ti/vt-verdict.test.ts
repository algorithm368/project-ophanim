import { describe, expect, it } from "vitest";
import { vtDefinitive } from "./vt-verdict";

describe("vtDefinitive", () => {
  it("treats a small engine minority as non-definitive (FP territory)", () => {
    // The observed false positive: 3/69 engines on a legitimate corporate
    // binary must not floor the aggregate at 75.
    expect(vtDefinitive(3, 69)).toBe(false);
    expect(vtDefinitive(4, 91)).toBe(false);
    expect(vtDefinitive(0, 70)).toBe(false);
  });

  it("requires both the absolute count and the panel share", () => {
    expect(vtDefinitive(5, 69)).toBe(true); // 7.2% of the panel
    expect(vtDefinitive(5, 91)).toBe(true); // 5.5%
    expect(vtDefinitive(5, 100)).toBe(true); // exactly 5% — boundary is inclusive
    expect(vtDefinitive(5, 101)).toBe(false); // 4.95% — share too small
    expect(vtDefinitive(4, 10)).toBe(false); // high share, count too small
  });

  it("is definitive for a broad consensus", () => {
    expect(vtDefinitive(63, 66)).toBe(true); // EICAR
  });

  it("never divides by zero on an empty panel", () => {
    expect(vtDefinitive(0, 0)).toBe(false);
  });
});
