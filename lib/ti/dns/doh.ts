import { getJson } from "../http";

interface DohAnswer {
  name?: string;
  type?: number;
  data?: string;
}

export interface DohResponse {
  Status?: number;
  /** Authenticated Data — set when the resolver validated DNSSEC. */
  AD?: boolean;
  Answer?: DohAnswer[];
}

export type RecordType =
  | "A"
  | "AAAA"
  | "MX"
  | "NS"
  | "TXT"
  | "SOA"
  | "CNAME"
  | "CAA"
  | "PTR";

/** DoH JSON (application/dns-json) resolvers, by id. Both reliably support
 *  GET-with-JSON; Quad9's JSON endpoint is omitted because it is not reachable
 *  for server-side JSON DoH (the :5053 endpoint hangs). Two resolvers are still
 *  enough to detect GeoDNS / split-horizon / poisoning disagreement. */
export const RESOLVERS: Record<string, string> = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve",
};

/**
 * Unfiltered JSON-DoH resolvers for A-record consensus. These do NOT run a
 * malicious-domain blocklist, so disagreement here means GeoDNS / CDN rotation
 * / split-horizon / poisoning, not "a security resolver refused to answer."
 * Membership is verified server-side (must return valid application/dns-json,
 * not hang, and not sinkhole a live malware-test domain); endpoints that fail
 * verification are dropped with a note.
 *
 * Verified 2026-07-06 (server-side probe, GET ?name=…&type=A):
 * - cloudflare, google, adguard(unfiltered): return application/dns-json.
 * - dns0.eu: dropped — no JSON endpoint at the apex (wireformat only), request
 *   hangs to timeout.
 * - quad9 unsecured (9.9.9.10:5053): dropped — JSON endpoint hangs, same as the
 *   secured :5053 note above.
 *
 * Verified 2026-09-06 (same probe, plus resolving internetbadguys.com — a live
 * malware-test domain most security resolvers sinkhole — to confirm each
 * candidate is genuinely unfiltered rather than just JSON-capable):
 * - rethinkdns (basic.rethinkdns.com), dns.sb (doh.dns.sb): both return
 *   application/dns-json, resolve internetbadguys.com to its real IP (not
 *   sinkholed), respond in well under a second, and return Status 3 for a
 *   name that does not exist.
 * - tiarap.org (doh.tiarap.org): dropped — returns application/dns-json and
 *   is fast, but sinkholes internetbadguys.com to 0.0.0.0. It filters, so it
 *   would read a blocked malicious domain as "GeoDNS disagreement," exactly
 *   the failure mode this pool exists to avoid.
 * - dns.nextdns.io (bare anycast, no profile id): resolved
 *   internetbadguys.com untouched in this probe, but NextDNS's whole product
 *   is configurable filtering — trusting an unauthenticated default profile
 *   to stay unfiltered indefinitely is a weaker guarantee than the other four
 *   resolvers here provide by design. Left out.
 */
export const UNFILTERED_RESOLVERS: Record<string, string> = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve",
  adguard: "https://dns-unfiltered.adguard.com/resolve",
  rethinkdns: "https://basic.rethinkdns.com/dns-query",
  "dns.sb": "https://doh.dns.sb/dns-query",
};

/** Query one resolver. `dnssec: true` sets the DO bit so the AD flag is meaningful. */
export async function dohQuery(
  resolver: string,
  name: string,
  type: RecordType,
  signal: AbortSignal,
  dnssec = false,
): Promise<DohResponse | null> {
  const url =
    `${resolver}?name=${encodeURIComponent(name)}&type=${type}` +
    (dnssec ? "&do=1" : "");
  const { data } = await getJson<DohResponse>(url, signal, {
    Accept: "application/dns-json",
  });
  return data;
}

// DNSSEC meta records (DS, RRSIG, NSEC, DNSKEY, NSEC3) ride along in the answer
// set when the DO bit is set (`dnssec: true`). They are signatures/proofs, never
// answer *values*, so an A query with do=1 would otherwise leak an RRSIG blob
// into resolvedIps (and break resolver-agreement). Drop them.
const DNSSEC_META_TYPES = new Set([43, 46, 47, 48, 50]);

/** Flatten answer `data` values, stripping the trailing dot and DNSSEC meta records. */
export function answers(res: DohResponse | null): string[] {
  return (res?.Answer ?? [])
    .filter((a) => !DNSSEC_META_TYPES.has(a.type ?? 0))
    .map((a) => a.data?.replace(/\.$/, ""))
    .filter((d): d is string => Boolean(d));
}
