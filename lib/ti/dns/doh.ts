import { getJson } from "../http";

export interface DohAnswer {
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

/** Flatten answer `data` values, stripping the trailing dot. */
export function answers(res: DohResponse | null): string[] {
  return (res?.Answer ?? [])
    .map((a) => a.data?.replace(/\.$/, ""))
    .filter((d): d is string => Boolean(d));
}
