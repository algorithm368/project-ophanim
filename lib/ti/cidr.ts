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

/** A CIDR as the inclusive range of addresses it covers, in its own family. */
export type CidrRange =
  | { family: 4; start: number; end: number }
  | { family: 6; start: bigint; end: bigint };

/**
 * Parse a CIDR (e.g. "1.19.0.0/16" or "2001:678:254::/48") into the inclusive
 * address range it covers, or null when it is malformed. An unaligned base is
 * normalized to its block start, so "1.2.3.4/24" covers 1.2.3.0-1.2.3.255.
 */
export function parseCidr(cidr: string): CidrRange | null {
  const slash = cidr.indexOf("/");
  if (slash < 0) return null;
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0) return null;
  const base = cidr.slice(0, slash);

  if (base.includes(":")) {
    if (prefix > 128) return null;
    const baseValue = ipv6ToBigInt(base);
    if (baseValue === null) return null;
    const hostBits = BigInt(1) << BigInt(128 - prefix);
    // Masking off the host bits normalizes an unaligned base to its block start.
    const start = (baseValue / hostBits) * hostBits;
    return { family: 6, start, end: start + hostBits - BigInt(1) };
  }

  if (prefix > 32) return null;
  const baseLong = ipv4ToLong(base);
  if (baseLong === null) return null;
  const size = 2 ** (32 - prefix);
  const start = Math.floor(baseLong / size) * size;
  return { family: 4, start, end: start + size - 1 };
}

/** An IP address as a number in its family's range, or null when it is invalid. */
export function ipValue(
  ip: string,
): { family: 4; value: number } | { family: 6; value: bigint } | null {
  if (ip.includes(":")) {
    const value = ipv6ToBigInt(ip);
    return value === null ? null : { family: 6, value };
  }
  const value = ipv4ToLong(ip);
  return value === null ? null : { family: 4, value };
}

/**
 * Whether `ip` falls inside `cidr`, for either IP family (e.g. "1.19.0.0/16"
 * or "2001:678:254::/48"). Returns false for malformed CIDRs and for
 * mixed-family comparisons, so an address checked against a feed of the other
 * family simply misses rather than throwing.
 */
export function cidrContains(cidr: string, ip: string): boolean {
  const range = parseCidr(cidr);
  const addr = ipValue(ip);
  if (!range || !addr || range.family !== addr.family) return false;
  return addr.value >= range.start && addr.value <= range.end;
}
