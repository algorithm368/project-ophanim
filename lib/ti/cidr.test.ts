import { describe, expect, it } from "vitest";
import { cidrContains, ipValue, ipv4ToLong, ipv6ToBigInt, parseCidr } from "./cidr";

describe("ipv4ToLong", () => {
  it("converts dotted-quad to a 32-bit integer", () => {
    expect(ipv4ToLong("0.0.0.0")).toBe(0);
    expect(ipv4ToLong("1.19.0.0")).toBe(18_022_400);
    // Must not overflow 32-bit signed (no bitwise tricks).
    expect(ipv4ToLong("255.255.255.255")).toBe(4_294_967_295);
  });

  it("returns null for non-IPv4 input", () => {
    expect(ipv4ToLong("not-an-ip")).toBeNull();
    expect(ipv4ToLong("2001:db8::1")).toBeNull();
    expect(ipv4ToLong("1.2.3.999")).toBeNull();
  });
});

describe("cidrContains", () => {
  it("matches an IP inside the block", () => {
    expect(cidrContains("1.19.0.0/16", "1.19.5.5")).toBe(true);
    expect(cidrContains("1.19.0.0/16", "1.20.0.1")).toBe(false);
  });

  it("handles /32 (single host) and /0 (everything)", () => {
    expect(cidrContains("8.8.8.8/32", "8.8.8.8")).toBe(true);
    expect(cidrContains("8.8.8.8/32", "8.8.8.9")).toBe(false);
    expect(cidrContains("0.0.0.0/0", "123.45.67.89")).toBe(true);
  });

  it("respects block boundaries", () => {
    expect(cidrContains("10.0.0.0/24", "10.0.0.0")).toBe(true);
    expect(cidrContains("10.0.0.0/24", "10.0.0.255")).toBe(true);
    expect(cidrContains("10.0.0.0/24", "10.0.1.0")).toBe(false);
  });

  it("normalizes an unaligned base to its block start", () => {
    // 1.2.3.4/24 really means the 1.2.3.0/24 block.
    expect(cidrContains("1.2.3.4/24", "1.2.3.200")).toBe(true);
  });

  it("returns false for malformed CIDR or non-IPv4 IPs", () => {
    expect(cidrContains("1.2.3.0", "1.2.3.4")).toBe(false); // no prefix
    expect(cidrContains("1.2.3.0/33", "1.2.3.4")).toBe(false); // prefix > 32
    expect(cidrContains("1.2.3.0/-1", "1.2.3.4")).toBe(false); // negative prefix
    expect(cidrContains("not-a-cidr", "1.2.3.4")).toBe(false);
    expect(cidrContains("1.0.0.0/8", "2001:db8::1")).toBe(false); // IPv6 IP
    expect(cidrContains("1.0.0.0/8", "not-an-ip")).toBe(false); // unparseable IP
    expect(cidrContains("not-an-ip/8", "1.2.3.4")).toBe(false); // unparseable base
  });
});

describe("ipv6ToBigInt", () => {
  // BigInt literals (0n) need target >= ES2020 and this project targets ES2017,
  // so construct them with BigInt() instead.
  it("converts an IPv6 address to its 128-bit integer", () => {
    expect(ipv6ToBigInt("::")).toBe(BigInt(0));
    expect(ipv6ToBigInt("::1")).toBe(BigInt(1));
    expect(ipv6ToBigInt("2001:db8::1")).toBe(
      BigInt("0x20010db8000000000000000000000001"),
    );
  });

  it("accepts any spelling of the same address", () => {
    // Compressed, expanded, and mixed case must all agree.
    const expanded = ipv6ToBigInt("2001:0db8:0000:0000:0000:0000:0000:0001");
    expect(ipv6ToBigInt("2001:DB8::1")).toBe(expanded);
  });

  it("returns null for non-IPv6 input", () => {
    expect(ipv6ToBigInt("8.8.8.8")).toBeNull();
    expect(ipv6ToBigInt("not-an-ip")).toBeNull();
    // Zone IDs are rejected by the parser.
    expect(ipv6ToBigInt("fe80::1%eth0")).toBeNull();
  });
});

describe("cidrContains — IPv6", () => {
  it("matches an address inside a /48 block", () => {
    // The shape Spamhaus drop_v6.json uses.
    expect(cidrContains("2001:678:254::/48", "2001:678:254::1")).toBe(true);
    expect(cidrContains("2001:678:254::/48", "2001:678:255::1")).toBe(false);
  });

  it("respects /64 boundaries", () => {
    expect(
      cidrContains("2001:db8:0:1::/64", "2001:db8:0:1:ffff:ffff:ffff:ffff"),
    ).toBe(true);
    expect(cidrContains("2001:db8:0:1::/64", "2001:db8:0:2::")).toBe(false);
  });

  it("handles /128 (single host) and /0 (everything)", () => {
    expect(cidrContains("2001:db8::1/128", "2001:db8::1")).toBe(true);
    expect(cidrContains("2001:db8::1/128", "2001:db8::2")).toBe(false);
    expect(cidrContains("::/0", "2001:db8::1")).toBe(true);
  });

  it("normalizes an unaligned base to its block start", () => {
    // 2001:db8::5/64 really means the 2001:db8::/64 block.
    expect(cidrContains("2001:db8::5/64", "2001:db8::abcd")).toBe(true);
  });

  it("matches regardless of how either side is spelled", () => {
    expect(cidrContains("2001:0DB8:0000::/48", "2001:db8::1")).toBe(true);
  });

  it("returns false for a mixed-family comparison", () => {
    expect(cidrContains("2001:db8::/32", "8.8.8.8")).toBe(false);
    expect(cidrContains("1.0.0.0/8", "2001:db8::1")).toBe(false);
  });

  it("returns false for an out-of-range IPv6 prefix", () => {
    expect(cidrContains("2001:db8::/129", "2001:db8::1")).toBe(false);
  });
});

describe("parseCidr", () => {
  it("returns the inclusive v4 range, normalizing an unaligned base", () => {
    expect(parseCidr("1.2.3.4/24")).toEqual({ family: 4, start: 16_909_056, end: 16_909_311 });
    expect(parseCidr("0.0.0.0/0")).toEqual({ family: 4, start: 0, end: 4_294_967_295 });
  });

  it("returns the inclusive v6 range as bigints", () => {
    const r = parseCidr("2001:db8::5/127");
    expect(r?.family).toBe(6);
    expect(r?.start).toBe(ipv6ToBigInt("2001:db8::4"));
    expect(r?.end).toBe(ipv6ToBigInt("2001:db8::5"));
  });

  it("returns null for malformed CIDRs", () => {
    expect(parseCidr("1.2.3.0")).toBeNull();
    expect(parseCidr("1.2.3.0/x")).toBeNull();
    expect(parseCidr("1.2.3.0/33")).toBeNull();
    expect(parseCidr("2001:db8::/129")).toBeNull();
    expect(parseCidr("gggg::/48")).toBeNull();
  });
});

describe("ipValue", () => {
  it("parses either family and rejects junk", () => {
    expect(ipValue("1.19.0.0")).toEqual({ family: 4, value: 18_022_400 });
    expect(ipValue("::1")).toEqual({ family: 6, value: BigInt(1) });
    expect(ipValue("not-an-ip")).toBeNull();
    expect(ipValue("::zz")).toBeNull();
  });
});
