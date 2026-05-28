import { describe, expect, it } from "vitest";
import { parseIPv4, reverseOctets } from "@/lib/ip";

describe("parseIPv4", () => {
  it("parses a routable public address", () => {
    const r = parseIPv4("8.8.8.8");
    expect(r).not.toBeNull();
    expect(r?.ip).toBe("8.8.8.8");
    expect(r?.octets).toEqual([8, 8, 8, 8]);
    expect(r?.isPrivate).toBe(false);
    expect(r?.isReserved).toBe(false);
    expect(r?.scopeNote).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(parseIPv4("  1.1.1.1  ")?.ip).toBe("1.1.1.1");
  });

  it("strips leading zeros when normalizing octets", () => {
    expect(parseIPv4("08.008.8.8")?.ip).toBe("8.8.8.8");
  });

  it.each([
    ["256.1.1.1"],
    ["1.2.3"],
    ["1.2.3.4.5"],
    ["abc"],
    [""],
    ["1.2.3.-1"],
  ])("rejects malformed input %s", (input) => {
    expect(parseIPv4(input)).toBeNull();
  });

  it.each([
    ["10.0.0.1"],
    ["172.16.5.4"],
    ["172.31.255.255"],
    ["192.168.1.1"],
  ])("flags %s as RFC 1918 private", (ip) => {
    const r = parseIPv4(ip);
    expect(r?.isPrivate).toBe(true);
    expect(r?.scopeNote).toMatch(/RFC 1918/);
  });

  it("treats 172.15 and 172.32 as public, not private", () => {
    expect(parseIPv4("172.15.0.1")?.isPrivate).toBe(false);
    expect(parseIPv4("172.32.0.1")?.isPrivate).toBe(false);
  });

  it.each([
    ["127.0.0.1", /Loopback/],
    ["169.254.1.1", /Link-local/],
    ["100.64.0.1", /Carrier-grade NAT/],
    ["0.0.0.0", /This network/],
    ["224.0.0.1", /Multicast/],
    ["240.0.0.1", /Reserved/],
  ])("flags %s as reserved", (ip, note) => {
    const r = parseIPv4(ip);
    expect(r?.isReserved).toBe(true);
    expect(r?.scopeNote).toMatch(note);
  });
});

describe("reverseOctets", () => {
  it("reverses octet order for DNSBL queries", () => {
    expect(reverseOctets("1.2.3.4")).toBe("4.3.2.1");
  });
});
