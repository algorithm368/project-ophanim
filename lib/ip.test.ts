import { describe, expect, it } from "vitest";
import { parseIPv4, reverseOctets } from "@/lib/ip";
import { parseIPv6, parseIP } from "@/lib/ip";

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

describe("parseIPv6", () => {
  it("canonicalizes to RFC 5952 (lowercase, zero-compressed)", () => {
    expect(parseIPv6("2001:0DB8:0000:0000:0000:0000:0000:0001")?.ip).toBe(
      "2001:db8::1",
    );
    expect(parseIPv6("FE80::1")?.ip).toBe("fe80::1");
    expect(parseIPv6("::")?.ip).toBe("::");
    expect(parseIPv6("::1")?.ip).toBe("::1");
  });

  it("compresses the leftmost-longest run of zero groups", () => {
    // Two equal-length runs -> the leftmost is compressed.
    expect(parseIPv6("2001:0:0:1:0:0:0:1")?.ip).toBe("2001:0:0:1::1");
  });

  it("parses an embedded IPv4 tail into hextets", () => {
    const r = parseIPv6("::ffff:192.168.0.1");
    expect(r?.ip).toBe("::ffff:c0a8:1");
    expect(r?.version).toBe(6);
  });

  it("reports a routable address as public", () => {
    const r = parseIPv6("2606:4700:4700::1111");
    expect(r).not.toBeNull();
    expect(r?.isPrivate).toBe(false);
    expect(r?.isReserved).toBe(false);
    expect(r?.scopeNote).toBeUndefined();
    expect(r?.version).toBe(6);
  });

  it.each([
    ["::1", /Loopback/, "reserved"],
    ["::", /Unspecified/, "reserved"],
    ["fe80::1", /Link-local/, "reserved"],
    ["ff02::1", /Multicast/, "reserved"],
    ["2001:db8::1", /Documentation/, "reserved"],
    ["::ffff:1.2.3.4", /IPv4-mapped/, "reserved"],
  ])("flags %s as %s", (ip, note, kind) => {
    const r = parseIPv6(ip);
    expect(r?.scopeNote).toMatch(note);
    expect(r?.isReserved).toBe(kind === "reserved");
  });

  it("flags fc00::/7 unique-local as private", () => {
    const r = parseIPv6("fd00::1");
    expect(r?.isPrivate).toBe(true);
    expect(r?.scopeNote).toMatch(/Unique local/);
  });

  it.each([
    ["1:2:3:4:5:6:7:8:9"],
    ["1::2::3"],
    ["gggg::1"],
    ["12345::1"],
    ["::1::"],
    ["1.2.3.4"],
    [""],
  ])("rejects malformed input %s", (input) => {
    expect(parseIPv6(input)).toBeNull();
  });
});

describe("parseIP", () => {
  it("dispatches to v4 then v6", () => {
    expect(parseIP("8.8.8.8")?.version).toBe(4);
    expect(parseIP("2606:4700:4700::1111")?.version).toBe(6);
    expect(parseIP("not-an-ip")).toBeNull();
  });
});
