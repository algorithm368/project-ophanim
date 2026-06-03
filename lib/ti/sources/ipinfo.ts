import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout, postJson } from "../http";

export interface IpInfoResponse {
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string;
  hostname?: string;
  bogon?: boolean;
}

export function ipInfoToGeo(data: IpInfoResponse): GeoContext {
  const geo: GeoContext = {};
  if (data.city) geo.city = data.city;
  if (data.region) geo.region = data.region;
  if (data.country) geo.countryCode = data.country;
  if (data.hostname) geo.reverse = data.hostname;
  if (data.loc) {
    const [lat, lon] = data.loc.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      geo.lat = lat;
      geo.lon = lon;
    }
  }
  if (data.org) {
    const m = data.org.match(/^(AS\d+)\s+(.*)$/);
    if (m) {
      geo.asn = m[1];
      geo.asnOrg = m[2];
    } else {
      geo.asnOrg = data.org;
    }
  }
  return geo;
}

/** Pure: shape an ipinfo /batch response (ip -> entry) into ip -> GeoContext.
 *  Non-object entries (string echoes), bogons, and missing IPs are omitted. */
export function mapIpInfoBatch(
  ips: string[],
  data: Record<string, IpInfoResponse | string>,
): Map<string, GeoContext> {
  const out = new Map<string, GeoContext>();
  for (const ip of ips) {
    const entry = data[ip];
    if (entry && typeof entry === "object" && !entry.bogon) {
      out.set(ip, ipInfoToGeo(entry));
    }
  }
  return out;
}

/** Geolocate many IPs in one ipinfo /batch call. Empty map when no token or on
 *  any failure — the caller treats that as "ipinfo did not vote". */
export async function bulkIpInfo(
  ips: string[],
  signal: AbortSignal,
): Promise<Map<string, GeoContext>> {
  const token = process.env.IPINFO_TOKEN;
  // ipinfo /batch accepts up to 1,000 IPs; callers are responsible for chunking.
  if (!token || ips.length === 0) return new Map();
  try {
    const { ok, data } = await postJson<Record<string, IpInfoResponse | string>>(
      `https://ipinfo.io/batch?token=${token}`,
      signal,
      ips,
    );
    if (!ok || !data) return new Map();
    return mapIpInfoBatch(ips, data);
  } catch (err) {
    if (isTimeout(err)) throw err; // propagate abort/timeout; degrade on real errors
    return new Map();
  }
}

/** ipinfo.io: strong ASN/company + geo (free token via IPINFO_TOKEN). Context only. */
export const ipInfoSource: TiSource = {
  meta: {
    id: "ipinfo",
    name: "ipinfo.io",
    url: "https://ipinfo.io",
    category: "context",
    requiresKey: true,
    weight: 0,
    keyEnv: "IPINFO_TOKEN",
  },
  isEnabled: () => Boolean(process.env.IPINFO_TOKEN),
  async check(ip, signal): Promise<SourceFinding> {
    const token = process.env.IPINFO_TOKEN;
    if (!token) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<IpInfoResponse>(
        `https://ipinfo.io/${ip}/json?token=${token}`,
        signal,
      );
      if (!ok || !data || data.bogon) {
        return { status: "error", error: `HTTP ${status}` };
      }
      const geo = ipInfoToGeo(data);
      return {
        status: "ok",
        summary: [data.city, data.region, data.country].filter(Boolean).join(", "),
        geo,
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
