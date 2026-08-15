import type { FcrdnsResult } from "../types";
import { ipv6Groups, parseIPv6 } from "../../ip";

/**
 * Build the reverse-DNS PTR name for an IP: `ip6.arpa` nibble format for IPv6,
 * `in-addr.arpa` reversed octets for IPv4.
 */
export function reversePointer(ip: string): string {
  const groups = ipv6Groups(ip);
  if (groups) {
    const nibbles = groups
      .map((group) => group.toString(16).padStart(4, "0"))
      .join("");
    return `${[...nibbles].reverse().join(".")}.ip6.arpa`;
  }
  return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
}

/** A minimal name->records resolver, injected so this stays pure/testable. */
export type ResolveFn = (
  name: string,
  type: "PTR" | "A" | "AAAA",
) => Promise<string[]>;

/**
 * Forward-confirmed reverse DNS: PTR the IP, forward-resolve the hostname, and
 * confirm it points back. Returns null when the IP has no PTR.
 *
 * IPv6 answers are compared in canonical form, not as raw strings: a resolver
 * may return an uncompressed spelling of the very address we asked about, and
 * a string compare would report a confirmed record as unconfirmed.
 */
export async function verifyFcrdns(
  ip: string,
  resolve: ResolveFn,
): Promise<FcrdnsResult | null> {
  const ptr = await resolve(reversePointer(ip), "PTR");
  const hostname = ptr[0];
  if (!hostname) return null;

  const asV6 = parseIPv6(ip);
  const forward = await resolve(hostname, asV6 ? "AAAA" : "A");
  const verified = asV6
    ? forward.some((answer) => parseIPv6(answer)?.ip === asV6.ip)
    : forward.includes(ip);
  return { hostname, verified };
}
