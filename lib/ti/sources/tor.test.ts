import { describe, expect, it } from "vitest";
import { hostMatches } from "./tor";

describe("hostMatches", () => {
  it("matches a bare IP exactly, not by prefix", () => {
    expect(hostMatches(["1.2.3.4"], "1.2.3.4")).toBe(true);
    // Onionoo search is a prefix match upstream, so 1.2.3.40 must not match 1.2.3.4.
    expect(hostMatches(["1.2.3.40"], "1.2.3.4")).toBe(false);
  });

  it("strips an IPv4 :port before comparing", () => {
    expect(hostMatches(["1.2.3.4:9001"], "1.2.3.4")).toBe(true);
  });

  it("ignores bracketed IPv6 entries", () => {
    expect(hostMatches(["[2001:db8::1]:443"], "2001:db8::1")).toBe(false);
  });

  it("scans the whole list", () => {
    expect(hostMatches(["9.9.9.9:443", "1.2.3.4:80"], "1.2.3.4")).toBe(true);
  });

  it("returns false for an undefined or empty list", () => {
    expect(hostMatches(undefined, "1.2.3.4")).toBe(false);
    expect(hostMatches([], "1.2.3.4")).toBe(false);
  });
});
