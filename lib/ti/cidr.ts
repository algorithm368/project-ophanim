import { ipv6Groups, parseIPv4 } from "../ip";

/**
 * IPv4 dotted-quad -> 32-bit integer, or null for anything that isn't a valid
 * IPv4 address. Uses arithmetic (not bitwise <<) so 255.255.255.255 stays a
 * positive safe integer rather than overflowing JS's 32-bit signed bit ops.
 */
export function ipv4ToLong(ip: string): number | null {
  const parsed = parseIPv4(ip);
  if (!parsed) return null;
  const [a, b, c, d] = parsed.octets;
  return a * 16_777_216 + b * 65_536 + c * 256 + d;
}

/**
 * IPv6 address -> 128-bit BigInt, or null for anything that isn't a valid IPv6
 * address. BigInt because 128 bits does not fit in a JS double, and because
 * CIDR containment is bitwise masking rather than string comparison.
 *
 * Built with BigInt() calls rather than `0n` literals: those need a compile
 * target of ES2020 and this project targets ES2017.
 */
export function ipv6ToBigInt(ip: string): bigint | null {
  const groups = ipv6Groups(ip);
  if (!groups) return null;
  let value = BigInt(0);
  for (const group of groups) {
    value = (value << BigInt(16)) | BigInt(group);
  }
  return value;
}

/**
 * Whether `ip` falls inside `cidr`, for either IP family (e.g. "1.19.0.0/16"
 * or "2001:678:254::/48"). Returns false for malformed CIDRs and for
 * mixed-family comparisons, so an address checked against a feed of the other
 * family simply misses rather than throwing.
 */
export function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.indexOf("/");
  if (slash < 0) return false;
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0) return false;
  const base = cidr.slice(0, slash);

  // Either side looking like IPv6 forces the v6 path; a v4 operand then fails
  // to parse and the comparison correctly misses.
  if (base.includes(":") || ip.includes(":")) {
    if (prefix > 128) return false;
    const ipValue = ipv6ToBigInt(ip);
    const baseValue = ipv6ToBigInt(base);
    if (ipValue === null || baseValue === null) return false;
    // Masking both sides also normalizes an unaligned base to its block start.
    const mask =
      ((BigInt(1) << BigInt(prefix)) - BigInt(1)) << BigInt(128 - prefix);
    return (ipValue & mask) === (baseValue & mask);
  }

  if (prefix > 32) return false;
  const long = ipv4ToLong(ip);
  if (long === null) return false;
  const baseLong = ipv4ToLong(base);
  if (baseLong === null) return false;

  const size = 2 ** (32 - prefix);
  const start = Math.floor(baseLong / size) * size; // normalize unaligned base
  return long >= start && long < start + size;
}
