import { describe, expect, it } from "vitest";
import { crossApexSans } from "./san-pivots";

describe("crossApexSans", () => {
  it("returns distinct registrable domains other than the queried apex", () => {
    expect(
      crossApexSans(
        [
          "example.com",
          "www.example.com",
          "*.example.com",
          "shop.other-site.com",
          "other-site.com",
          "third.co.uk",
        ],
        "example.com",
      ).sort(),
    ).toEqual(["other-site.com", "third.co.uk"]);
  });

  it("de-stars wildcards and ignores blanks / non-strings", () => {
    expect(
      crossApexSans(["*.evil.net", "", undefined as unknown as string], "good.com"),
    ).toEqual(["evil.net"]);
  });

  it("caps the result and tolerates an empty list", () => {
    const many = Array.from({ length: 20 }, (_, i) => `site${i}.com`);
    expect(crossApexSans(many, "apex.com", 5)).toHaveLength(5);
    expect(crossApexSans(undefined, "apex.com")).toEqual([]);
  });
});
