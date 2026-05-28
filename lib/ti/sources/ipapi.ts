import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface IpApiResponse {
  status: "success" | "fail";
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

const FIELDS =
  "status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,asname,reverse,mobile,proxy,hosting,query";

/** ip-api.com: free geolocation/ASN context (no key). Context only, no risk score. */
export const ipApiSource: TiSource = {
  meta: {
    id: "ip-api",
    name: "ip-api.com",
    url: "https://ip-api.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { data } = await getJson<IpApiResponse>(
        `http://ip-api.com/json/${ip}?fields=${FIELDS}`,
        signal,
      );
      if (!data || data.status !== "success") {
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
        geo: {
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
        },
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
