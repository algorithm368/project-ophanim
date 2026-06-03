import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface IpGeolocationResponse {
  message?: string;
  country_name?: string;
  country_code2?: string;
  state_prov?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
  isp?: string;
  organization?: string;
  asn?: string;
}

export function ipGeolocationToGeo(data: IpGeolocationResponse): GeoContext {
  const geo: GeoContext = {};
  if (data.country_name) geo.country = data.country_name;
  if (data.country_code2) geo.countryCode = data.country_code2;
  if (data.state_prov) geo.region = data.state_prov;
  if (data.city) geo.city = data.city;
  if (data.isp) geo.isp = data.isp;
  if (data.organization) geo.asnOrg = data.organization;
  if (data.asn) geo.asn = data.asn;
  const lat = Number(data.latitude);
  const lon = Number(data.longitude);
  if (Number.isFinite(lat) && data.latitude) geo.lat = lat;
  if (Number.isFinite(lon) && data.longitude) geo.lon = lon;
  return geo;
}

/** ipgeolocation.io: extra geo + ASN vote (key via IPGEOLOCATION_API_KEY). Context only. */
export const ipGeolocationSource: TiSource = {
  meta: {
    id: "ipgeolocation",
    name: "ipgeolocation.io",
    url: "https://ipgeolocation.io",
    category: "context",
    requiresKey: true,
    weight: 0,
    keyEnv: "IPGEOLOCATION_API_KEY",
  },
  isEnabled: () => Boolean(process.env.IPGEOLOCATION_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.IPGEOLOCATION_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<IpGeolocationResponse>(
        `https://api.ipgeolocation.io/ipgeo?apiKey=${key}&ip=${ip}`,
        signal,
      );
      if (!ok || !data || data.message) {
        return { status: "error", error: data?.message ?? `HTTP ${status}` };
      }
      const geo = ipGeolocationToGeo(data);
      return {
        status: "ok",
        summary: [data.city, data.state_prov, data.country_name].filter(Boolean).join(", "),
        geo,
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
