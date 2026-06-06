import { describe, expect, it } from "vitest";
import { toNumber } from "./hashlookup";

describe("toNumber", () => {
  it("coerces numeric strings and passes through numbers", () => {
    expect(toNumber(1234)).toBe(1234);
    expect(toNumber("1234")).toBe(1234);
  });

  it("returns undefined for absent or non-numeric values", () => {
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber("not-a-number")).toBeUndefined();
  });
});
