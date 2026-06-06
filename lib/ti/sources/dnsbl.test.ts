import { describe, expect, it } from "vitest";
import { dnsblScore, isBlockedCode } from "./dnsbl";

describe("isBlockedCode", () => {
  it("recognizes the 127.255.255.x rate-limit sentinel", () => {
    expect(isBlockedCode("127.255.255.254")).toBe(true);
    expect(isBlockedCode("127.0.0.2")).toBe(false);
  });
});

describe("dnsblScore", () => {
  it("is 0 when unlisted and ramps with multi-zone consensus", () => {
    expect(dnsblScore(0)).toBe(0);
    expect(dnsblScore(1)).toBe(20);
    expect(dnsblScore(2)).toBe(38);
  });

  it("caps at 90", () => {
    expect(dnsblScore(10)).toBe(90);
  });
});
