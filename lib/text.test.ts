import { describe, expect, it } from "vitest";
import { count, pluralize } from "@/lib/text";

describe("pluralize", () => {
  it("keeps the singular for exactly one", () => {
    expect(pluralize(1, "domain")).toBe("domain");
  });

  it("adds an s for anything else, including zero", () => {
    expect(pluralize(0, "domain")).toBe("domains");
    expect(pluralize(2, "domain")).toBe("domains");
  });

  it("takes an irregular plural rather than guessing", () => {
    expect(pluralize(2, "country", "countries")).toBe("countries");
    expect(pluralize(1, "country", "countries")).toBe("country");
  });
});

describe("count", () => {
  it("puts the number in front of the agreeing noun", () => {
    expect(count(1, "certificate")).toBe("1 certificate");
    expect(count(3, "certificate")).toBe("3 certificates");
    expect(count(0, "certificate")).toBe("0 certificates");
  });

  it("carries the irregular plural through", () => {
    expect(count(2, "country", "countries")).toBe("2 countries");
  });
});
