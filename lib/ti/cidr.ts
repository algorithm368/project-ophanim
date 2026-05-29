import { parseIPv4 } from "../ip";

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
 * Whether `ip` falls inside the IPv4 `cidr` block (e.g. "1.19.0.0/16").
 * Returns false for malformed CIDRs and non-IPv4 IPs (so IPv6 lookups against
 * an IPv4-only feed like Spamhaus DROP simply miss rather than throw).
 */
export function cidrContains(cidr: string, ip: string): boolean {
  const long = ipv4ToLong(ip);
  if (long === null) return false;

  const slash = cidr.indexOf("/");
  if (slash < 0) return false;
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;

  const baseLong = ipv4ToLong(cidr.slice(0, slash));
  if (baseLong === null) return false;

  const size = 2 ** (32 - prefix);
  const start = Math.floor(baseLong / size) * size; // normalize unaligned base
  return long >= start && long < start + size;
}
