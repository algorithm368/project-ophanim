import type { GeoContext } from "../types";
import { getJson, isTimeout } from "../http";
import { type RdapIpResponse, rdapIpToGeo } from "../sources/rdap-ip";
import { type FreeIpApiResponse, freeIpApiToGeo } from "../sources/freeipapi";
import { countryKeyIndex, countryVoteKey } from "./geokit";
import type { GeoInput } from "./reconcile";

/** A provider's geo answers keyed by IP, ready to transpose. */
export interface ProviderContexts {
  id: string;
  byIp: Map<string, GeoContext>;
}

/** Build per-IP reconciliation inputs from each provider's answers. Every
 *  requested IP gets an entry (an empty array when no provider knew it). */
export function transposeByIp(
  ips: string[],
  providers: ProviderContexts[],
): Map<string, GeoInput[]> {
  const perIp = new Map<string, GeoInput[]>();
  for (const ip of ips) {
    const inputs: GeoInput[] = [];
    for (const p of providers) {
      const geo = p.byIp.get(ip);
      if (geo) inputs.push({ id: p.id, geo });
    }
    perIp.set(ip, inputs);
  }
  return perIp;
}

/** IPs whose country is uncertain: fewer than 2 reporting voters, or voters
 *  disagree on the code. Disagreements are prioritized, then capped to `max`. */
export function selectUncertainIps(
  perIp: Map<string, GeoInput[]>,
  max: number,
): string[] {
  const disagree: string[] = [];
  const single: string[] = [];
  for (const [ip, inputs] of perIp) {
    let reporting = 0;
    const codes = new Set<string>();
    // Per-IP index, so a name-only vote resolves onto a coded vote for the same
    // country rather than reading as a disagreement (and burning an RDAP call).
    const index = countryKeyIndex(
      inputs.map(({ geo }) => ({ code: geo.countryCode, name: geo.country })),
    );
    for (const inp of inputs) {
      const key = countryVoteKey(inp.geo, index);
      if (key) {
        reporting++;
        codes.add(key);
      }
    }
    if (codes.size > 1) disagree.push(ip);
    else if (reporting < 2) single.push(ip);
  }
  return [...disagree, ...single].slice(0, Math.max(0, max));
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
}

/** Fetch authoritative allocation country per IP via RDAP, concurrency-capped.
 *  Only IPs with a country are included; failures drop out silently. */
export async function fetchRdapCountries(
  ips: string[],
  signal: AbortSignal,
  concurrency: number,
): Promise<Map<string, GeoContext>> {
  const out = new Map<string, GeoContext>();
  if (ips.length === 0) return out;
  await mapLimit(ips, concurrency, async (ip) => {
    try {
      const { ok, data } = await getJson<RdapIpResponse>(
        `https://rdap.org/ip/${ip}`,
        signal,
      );
      if (ok && data) {
        const geo = rdapIpToGeo(data);
        if (geo.countryCode) out.set(ip, geo);
      }
    } catch (err) {
      if (isTimeout(err)) throw err; // propagate abort/cancel; degrade on real errors
      // else: drop this IP's authority boost
    }
  });
  return out;
}

/** Fetch freeipapi geo per IP, concurrency-capped. A third city/coords voter
 *  for the bulk path. Failures drop out silently; aborts propagate. */
export async function fetchFreeIpApiGeo(
  ips: string[],
  signal: AbortSignal,
  concurrency: number,
): Promise<Map<string, GeoContext>> {
  const out = new Map<string, GeoContext>();
  if (ips.length === 0) return out;
  await mapLimit(ips, concurrency, async (ip) => {
    try {
      const { ok, data } = await getJson<FreeIpApiResponse>(
        `https://freeipapi.com/api/json/${ip}`,
        signal,
      );
      if (ok && data && (data.countryCode || data.countryName)) {
        out.set(ip, freeIpApiToGeo(data));
      }
    } catch (err) {
      if (isTimeout(err)) throw err; // propagate abort/cancel; degrade on real errors
      // else: drop this IP's freeipapi corroboration
    }
  });
  return out;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Hard ceiling on per-request RDAP lookups (latency guard). */
export const bulkRdapMax = (): number => intEnv("BULK_RDAP_MAX", 25);
/** Max concurrent RDAP requests. */
export const bulkRdapConcurrency = (): number =>
  intEnv("BULK_RDAP_CONCURRENCY", 8);

/** Hard ceiling on per-request freeipapi fan-out lookups (latency guard). */
export const bulkGeoFanoutMax = (): number => intEnv("BULK_GEO_FANOUT_MAX", 15);
/** Max concurrent freeipapi fan-out requests. */
export const bulkGeoFanoutConcurrency = (): number =>
  intEnv("BULK_GEO_FANOUT_CONCURRENCY", 8);
