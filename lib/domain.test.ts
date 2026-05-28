import { describe, expect, it } from "vitest";
import { parseDomain } from "@/lib/domain";

describe("parseDomain", () => {
  it("parses a plain registrable domain", () => {
    const r = parseDomain("google.com");
    expect(r?.domain).toBe("google.com");
    expect(r?.registrable).toBe("google.com");
    expect(r?.labels).toEqual(["google", "com"]);
    expect(r?.isReserved).toBe(false);
  });

  it("lowercases the hostname", () => {
    expect(parseDomain("GOOGLE.COM")?.domain).toBe("google.com");
  });

  it("extracts the hostname from a pasted URL", () => {
    const r = parseDomain("https://www.google.com/search?q=x");
    expect(r?.domain).toBe("www.google.com");
    expect(r?.registrable).toBe("google.com");
  });

  it("strips a trailing root dot and a port", () => {
    expect(parseDomain("google.com.")?.domain).toBe("google.com");
    expect(parseDomain("google.com:8080")?.domain).toBe("google.com");
  });

  it("keeps three labels for known multi-level public suffixes", () => {
    expect(parseDomain("bbc.co.uk")?.registrable).toBe("bbc.co.uk");
    expect(parseDomain("www.bbc.co.uk")?.registrable).toBe("bbc.co.uk");
  });

  it("reduces a subdomain to its registrable apex", () => {
    expect(parseDomain("mail.corp.google.com")?.registrable).toBe("google.com");
  });

  it("accepts punycode TLDs", () => {
    expect(parseDomain("example.xn--p1ai")).not.toBeNull();
  });

  it.each([
    ["1.2.3.4"], // IP literal belongs to the IP checker
    ["localhost"], // single label
    ["exa_mple.com"], // illegal label char
    ["-bad.com"], // leading hyphen
    ["google.123"], // numeric TLD
    [""],
  ])("rejects %s", (input) => {
    expect(parseDomain(input)).toBeNull();
  });

  it("marks reserved special-use names", () => {
    expect(parseDomain("foo.test")?.isReserved).toBe(true);
    expect(parseDomain("service.onion")?.isReserved).toBe(true);
    expect(parseDomain("example.com")?.isReserved).toBe(true);
  });
});
