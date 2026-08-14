import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface IpWhoIsResponse {
  success: boolean;
  message?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  connection?: { asn?: number; org?: string; isp?: string };
}

export function ipWhoIsToGeo(data: IpWhoIsResponse): GeoContext {
  return {
    country: data.country,
    countryCode: data.country_code,
    region: data.region,
    city: data.city,
    lat: data.latitude,
    lon: data.longitude,
    asn: data.connection?.asn ? `AS${data.connection.asn}` : undefined,
    asnOrg: data.connection?.org,
    isp: data.connection?.isp,
  };
}

/** ipwho.is: free geolocation/ASN context (no key). Context only, no risk score. */
export const ipWhoIsSource: TiSource = {
  meta: {
    id: "ipwhois",
    name: "ipwho.is",
    url: "https://ipwho.is",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      // ipwho.is free tier rejects the default `Sec-Fetch-Mode: cors`, so opt
      // into no-cors. Safe here because ipwho.is doesn't redirect (no-cors hangs
      // undici on cross-origin redirects — see lib/ti/http.ts).
      const { data } = await getJson<IpWhoIsResponse>(
        `https://ipwho.is/${ip}`,
        signal,
        {},
        "no-cors",
      );
      if (!data?.success) {
        return { status: "error", error: data?.message ?? "Lookup failed" };
      }
      const geo = ipWhoIsToGeo(data);
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
