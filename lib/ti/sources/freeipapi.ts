import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface FreeIpApiResponse {
  ipVersion?: number;
  ipAddress?: string;
  latitude?: number;
  longitude?: number;
  countryName?: string;
  countryCode?: string;
  regionName?: string;
  cityName?: string;
  asn?: string;
  asnOrganization?: string;
  isProxy?: boolean;
}

export function freeIpApiToGeo(data: FreeIpApiResponse): GeoContext {
  const asn = data.asn?.trim();
  const hasCoord =
    typeof data.latitude === "number" &&
    typeof data.longitude === "number" &&
    !(data.latitude === 0 && data.longitude === 0);
  return {
    country: data.countryName || undefined,
    countryCode: data.countryCode || undefined,
    region: data.regionName || undefined,
    city: data.cityName || undefined,
    lat: hasCoord ? data.latitude : undefined,
    lon: hasCoord ? data.longitude : undefined,
    asn: asn ? `AS${asn.replace(/^AS/i, "")}` : undefined,
    asnOrg: data.asnOrganization || undefined,
    isProxy: data.isProxy === true ? true : undefined,
  };
}

/** freeipapi.com: free geolocation/ASN context (no key). Context only, no risk
 *  score. Uses the default fetch mode (it issues a redirect, which undici
 *  follows; no-cors would hang on the redirect, see lib/ti/http.ts). */
export const freeIpApiSource: TiSource = {
  meta: {
    id: "freeipapi",
    name: "freeipapi.com",
    url: "https://freeipapi.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, data } = await getJson<FreeIpApiResponse>(
        `https://freeipapi.com/api/json/${ip}`,
        signal,
      );
      if (!ok || !data || (!data.countryCode && !data.countryName)) {
        return { status: "error", error: "Lookup failed" };
      }
      const geo = freeIpApiToGeo(data);
      return {
        status: "ok",
        summary:
          [data.cityName, data.regionName, data.countryName]
            .filter(Boolean)
            .join(", ") || undefined,
        geo,
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
