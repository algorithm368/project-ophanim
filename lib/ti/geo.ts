import type { GeoContext, GeoResolution } from "./types";
import type { ParsedIP } from "@/lib/ip";
import { postJson } from "./http";
import { IP_API_FIELDS, ipApiToGeo, type IpApiResponse } from "./sources/ipapi";
import { bulkIpInfo } from "./sources/ipinfo";
import { overlayResolution, reconcileGeoInputs } from "./geo/reconcile";
import {
  bulkRdapConcurrency,
  bulkRdapMax,
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
    if (!entry || entry.status !== "success") {
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
    if (row.status === "ok" && row.geo) ipApiByIp.set(row.ip, row.geo);
  }

  // 3. Transpose into per-IP reconciliation inputs.
  const perIp = transposeByIp(addresses, [
    { id: "ip-api", byIp: ipApiByIp },
    { id: "ipinfo", byIp: ipinfoByIp },
  ]);

  // 4. Adaptive RDAP country authority for uncertain IPs (capped + logged).
  const qualifying = selectUncertainIps(perIp, Number.POSITIVE_INFINITY);
  const cap = bulkRdapMax();
  if (qualifying.length > cap) {
    console.warn(
      `bulkGeolocate: ${qualifying.length - cap} uncertain IP(s) skipped RDAP (cap ${cap})`,
    );
  }
  const uncertain = qualifying.slice(0, cap);
  const rdapByIp = await fetchRdapCountries(
    uncertain,
    signal,
    bulkRdapConcurrency(),
  );
  for (const [ip, geo] of rdapByIp) {
    perIp.get(ip)?.push({ id: "rdap-ip", geo });
  }

  // 5. Reconcile per IP; keep the error row when nothing resolved.
  return ips.map((parsed) => {
    // Safe: mapBatchResults(ips, …) yields one row per ips[i].ip; caller dedupes.
    const base = byIpRow.get(parsed.ip)!;
    const resolution = reconcileGeoInputs(perIp.get(parsed.ip) ?? []);
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
