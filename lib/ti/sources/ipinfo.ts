import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

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
