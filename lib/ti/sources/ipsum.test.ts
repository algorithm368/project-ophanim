import { describe, expect, it } from "vitest";
import { ipsumMalicious, ipsumScore, parseIpsum } from "./ipsum";

describe("parseIpsum", () => {
  it("maps ip -> blocklist count and skips comments/blanks", () => {
    const feed = [
      "# IPsum Threat Intelligence Feed",
      "# Last update: ...",
      "",
      "213.209.159.56\t10",
      "1.2.3.4\t3",
    ].join("\n");
    const m = parseIpsum(feed);
    expect(m.size).toBe(2);
    expect(m.get("213.209.159.56")).toBe(10);
    expect(m.get("1.2.3.4")).toBe(3);
  });

  it("ignores malformed lines without a numeric count", () => {
    const m = parseIpsum("not-an-ip\nfoo\tbar\n9.9.9.9\t2");
    expect(m.size).toBe(1);
    expect(m.get("9.9.9.9")).toBe(2);
  });
});

describe("ipsumScore", () => {
  it("scales with list count and caps at 100", () => {
    expect(ipsumScore(1)).toBe(10);
    expect(ipsumScore(5)).toBe(50);
    expect(ipsumScore(20)).toBe(100);
  });
});

describe("ipsumMalicious", () => {
  it("flags only at three or more independent lists", () => {
    expect(ipsumMalicious(1)).toBe(false);
    expect(ipsumMalicious(2)).toBe(false);
    expect(ipsumMalicious(3)).toBe(true);
  });
});
