import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface IpApiResponse {
  status: "success" | "fail";
  /** The IP echoed back by ip-api (notably in /batch responses). */
  query?: string;
  message?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  isp?: string;
  org?: string;
  as?: string;
  asname?: string;
  reverse?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
}

/** ip-api field selector, shared by the single source and the bulk batch call. */
export const IP_API_FIELDS =
  "status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,asname,reverse,mobile,proxy,hosting,query";

/** Map an ip-api success payload to the normalized GeoContext. */
export function ipApiToGeo(data: IpApiResponse): GeoContext {
  return {
    country: data.country,
    countryCode: data.countryCode,
    region: data.regionName,
    city: data.city,
    lat: data.lat,
    lon: data.lon,
    asn: data.as,
    asnOrg: data.asname,
    isp: data.isp,
    org: data.org,
    reverse: data.reverse,
    isHosting: data.hosting,
    isProxy: data.proxy,
    isMobile: data.mobile,
  };
}

/** ip-api.com: free geolocation/ASN context (no key). Context only, no risk score. */
export const ipApiSource: TiSource = {
  meta: {
    id: "ip-api",
    name: "ip-api.com",
    url: "https://ip-api.com",
    category: "context",
    requiresKey: false,
    weight: 0,
    families: [4, 6],
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { data } = await getJson<IpApiResponse>(
        `http://ip-api.com/json/${ip}?fields=${IP_API_FIELDS}`,
        signal,
      );
      if (data?.status !== "success") {
        return {
          status: "error",
          error: data?.message ?? "Lookup failed",
        };
      }

      const flags: string[] = [];
      if (data.proxy) flags.push("proxy/VPN/Tor");
      if (data.hosting) flags.push("hosting/datacenter");
      if (data.mobile) flags.push("mobile");

      return {
        status: "ok",
        summary: [data.city, data.regionName, data.country]
          .filter(Boolean)
          .join(", ")
          .concat(data.as ? ` (${data.as})` : ""),
        categories: flags,
        details: {
          isp: data.isp,
          org: data.org,
          asn: data.as,
          reverseDns: data.reverse,
          flags: flags.length ? flags : ["none"],
        },
        geo: ipApiToGeo(data),
        raw: data,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
