import { describe, expect, it } from "vitest";
import { cidrContains, ipv4ToLong } from "./cidr";

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
    expect(cidrContains("not-a-cidr", "1.2.3.4")).toBe(false);
    expect(cidrContains("1.0.0.0/8", "2001:db8::1")).toBe(false); // IPv6 IP
  });
});
