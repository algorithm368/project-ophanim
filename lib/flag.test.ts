import { describe, expect, it } from "vitest";
import { flagUrl } from "@/lib/flag";

describe("flagUrl", () => {
  it("builds a CDN URL from a two-letter country code", () => {
    expect(flagUrl("TH")).toBe("https://flagcdn.com/th.svg");
  });

  // The codes arrive from geo sources in whatever case that source uses, but
  // flagcdn only serves the lowercase path.
  it("lowercases the code regardless of how it arrived", () => {
    expect(flagUrl("us")).toBe("https://flagcdn.com/us.svg");
    expect(flagUrl("Us")).toBe("https://flagcdn.com/us.svg");
  });

  // A missing country is the normal case for a private or unrouted address,
  // so it returns undefined rather than a broken image URL.
  it("returns undefined when there is no code", () => {
    expect(flagUrl()).toBeUndefined();
    expect(flagUrl(undefined)).toBeUndefined();
    expect(flagUrl("")).toBeUndefined();
  });

  // Anything that is not exactly two letters would produce a 404 image, so it
  // is rejected up front.
  it.each([
    ["one letter", "T"],
    ["three letters", "THA"],
    ["digits", "12"],
    ["mixed", "T1"],
    ["punctuation", "t-"],
    ["whitespace padding", " th"],
  ])("rejects %s", (_label, code) => {
    expect(flagUrl(code)).toBeUndefined();
  });
});
