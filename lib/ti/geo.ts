import type { GeoContext } from "./types";
import type { ParsedIP } from "@/lib/ip";
import { postJson } from "./http";
import { IP_API_FIELDS, ipApiToGeo, type IpApiResponse } from "./sources/ipapi";

/** One row in a bulk-geolocation response. */
export interface GeoRow {
  /** Canonical IP (RFC 5952 for v6). */
  ip: string;
  version: 4 | 6;
  status: "ok" | "error";
  geo?: GeoContext;
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
  const { data } = await postJson<IpApiBatchEntry[]>(
    `http://ip-api.com/batch?fields=${IP_API_FIELDS}`,
    signal,
    ips.map((p) => p.ip),
  );
  return mapBatchResults(ips, data ?? []);
}
