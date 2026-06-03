import type { FcrdnsResult } from "../types";

/** Build the reverse-DNS PTR name for an IPv4 address. */
export function reversePointer(ip: string): string {
  return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
}

/** A minimal name->records resolver, injected so this stays pure/testable. */
export type ResolveFn = (name: string, type: "PTR" | "A") => Promise<string[]>;

/**
 * Forward-confirmed reverse DNS: PTR the IP, forward-resolve the hostname, and
 * confirm it points back. Returns null when the IP has no PTR.
 */
export async function verifyFcrdns(
  ip: string,
  resolve: ResolveFn,
): Promise<FcrdnsResult | null> {
  const ptr = await resolve(reversePointer(ip), "PTR");
  const hostname = ptr[0];
  if (!hostname) return null;
  const forward = await resolve(hostname, "A");
  return { hostname, verified: forward.includes(ip) };
}
