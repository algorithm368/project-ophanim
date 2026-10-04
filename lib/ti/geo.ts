import type { GeoContext, GeoResolution } from "./types";
import type { ParsedIP } from "@/lib/ip";
import { postJson } from "./http";
import { IP_API_FIELDS, ipApiToGeo, type IpApiResponse } from "./sources/ipapi";
import { bulkIpInfo } from "./sources/ipinfo";
import { overlayResolution, reconcileGeoInputs } from "./geo/reconcile";
import {
  bulkGeoFanoutConcurrency,
  bulkGeoFanoutMax,
  bulkRdapConcurrency,
  bulkRdapMax,
  fetchFreeIpApiGeo,
  fetchRdapCountries,
  selectUncertainIps,
  transposeByIp,
} from "./geo/bulk";

/** One row in a bulk-geolocation response. */
export interface GeoRow {
  /** Canonical IP (RFC 5952 for v6). */
  ip: string;
  version: 4 | 6;
  status: "ok" | "error";
  geo?: GeoContext;
  /** Multi-provider reconciliation with per-field confidence (when available). */
  resolution?: GeoResolution;
  error?: string;
}

/** A single entry in an ip-api `/batch` response — a single-lookup payload
 *  whose `query` echoes the requested IP (`query` lives on IpApiResponse). */
export type IpApiBatchEntry = IpApiResponse;

/**
 * Zip the requested IPs against the batch response. ip-api preserves request
 * order, so positions line up; a non-success entry (or a missing one) becomes
 * an error row that still renders.
 */
export function mapBatchResults(
  ips: ParsedIP[],
  entries: IpApiBatchEntry[],
): GeoRow[] {
  return ips.map((parsed, i) => {
    const entry = entries[i];
    if (entry?.status !== "success") {
      return {
        ip: parsed.ip,
        version: parsed.version,
        status: "error",
        error: entry?.message ?? "Lookup failed",
      };
    }
    return {
      ip: parsed.ip,
      version: parsed.version,
      status: "ok",
      geo: ipApiToGeo(entry),
    };
  });
}

/**
 * Geolocate up to 100 IPs in a single ip-api batch request. Geo-only — no
 * threat-intel scoring. The caller is responsible for validating/deduping
 * (see extractIps). Throws if given more than 100 IPs.
 */
export async function bulkGeolocate(
  ips: ParsedIP[],
  signal: AbortSignal,
): Promise<GeoRow[]> {
  if (ips.length === 0) return [];
  if (ips.length > 100) {
    throw new RangeError(
      `bulkGeolocate: ip-api batch limit is 100 IPs, got ${ips.length}`,
    );
  }
  const addresses = ips.map((p) => p.ip);

  // 1+2. Fan out the two batch providers concurrently (independent calls).
  const [ipapiResponse, ipinfoByIp] = await Promise.all([
    postJson<IpApiBatchEntry[]>(
      `http://ip-api.com/batch?fields=${IP_API_FIELDS}`,
      signal,
      addresses,
    ),
    bulkIpInfo(addresses, signal),
  ]);
  const ipapiRows = mapBatchResults(ips, ipapiResponse.data ?? []);
  const byIpRow = new Map(ipapiRows.map((row) => [row.ip, row]));
  const ipApiByIp = new Map<string, GeoContext>();
  for (const row of ipapiRows) {
    // Only an ok row carries geo.
    if (row.geo) ipApiByIp.set(row.ip, row.geo);
  }

  // 3. Transpose into per-IP reconciliation inputs.
  const perIp = transposeByIp(addresses, [
    { id: "ip-api", byIp: ipApiByIp },
    { id: "ipinfo", byIp: ipinfoByIp },
  ]);

  // 4. Adaptive authority + corroboration for uncertain IPs. RDAP gives an
  //    allocation country; freeipapi adds a third city/coords voter. Both are
  //    capped (latency guard) and run concurrently; over-cap IPs are logged.
  const qualifying = selectUncertainIps(perIp, Number.POSITIVE_INFINITY);
  const rdapCap = bulkRdapMax();
  const fanoutCap = bulkGeoFanoutMax();
  if (qualifying.length > rdapCap) {
    console.warn(
      `bulkGeolocate: ${qualifying.length - rdapCap} uncertain IP(s) skipped RDAP (cap ${rdapCap})`,
    );
  }
  if (qualifying.length > fanoutCap) {
    console.warn(
      `bulkGeolocate: ${qualifying.length - fanoutCap} uncertain IP(s) skipped freeipapi fan-out (cap ${fanoutCap})`,
    );
  }
  const [rdapByIp, freeIpByIp] = await Promise.all([
    fetchRdapCountries(qualifying.slice(0, rdapCap), signal, bulkRdapConcurrency()),
    fetchFreeIpApiGeo(qualifying.slice(0, fanoutCap), signal, bulkGeoFanoutConcurrency()),
  ]);
  for (const [ip, geo] of rdapByIp) {
    perIp.get(ip)?.push({ id: "rdap-ip", geo });
  }
  for (const [ip, geo] of freeIpByIp) {
    perIp.get(ip)?.push({ id: "freeipapi", geo });
  }

  // 5. Reconcile per IP; keep the error row when nothing resolved.
  return ips.map((parsed) => {
    // Safe: mapBatchResults(ips, …) yields one row per ips[i].ip; caller dedupes.
    const base = byIpRow.get(parsed.ip)!;
    // Safe for the same reason: transposeByIp keys every address it was given.
    const resolution = reconcileGeoInputs(perIp.get(parsed.ip)!);
    if (!resolution) return base;
    return {
      ip: base.ip,
      version: base.version,
      status: "ok" as const,
      geo: overlayResolution(resolution, base.geo),
      resolution,
    };
  });
}
