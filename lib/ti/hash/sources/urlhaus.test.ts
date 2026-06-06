import { describe, expect, it } from "vitest";
import { toNumber } from "./urlhaus";

describe("toNumber", () => {
  it("coerces numeric strings and passes through numbers", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber("42")).toBe(42);
  });

  it("returns undefined for absent or non-numeric values", () => {
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber("not-a-number")).toBeUndefined();
  });
});
