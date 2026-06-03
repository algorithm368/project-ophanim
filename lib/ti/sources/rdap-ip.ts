import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface RdapIpResponse {
  country?: string;
  name?: string;
  startAddress?: string;
  endAddress?: string;
  handle?: string;
}

export function rdapIpToGeo(data: RdapIpResponse): GeoContext {
  const geo: GeoContext = {};
  if (data.country) geo.countryCode = data.country;
  if (data.name) geo.asnOrg = data.name;
  return geo;
}

/** RDAP via rdap.org bootstrap: authoritative RIR allocation (no key). Context only. */
export const rdapIpSource: TiSource = {
  meta: {
    id: "rdap-ip",
    name: "RDAP (RIR)",
    url: "https://rdap.org",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, status, data } = await getJson<RdapIpResponse>(
        `https://rdap.org/ip/${ip}`,
        signal,
      );
      if (!ok || !data) {
        return { status: "error", error: `HTTP ${status}` };
      }
      const geo = rdapIpToGeo(data);
      return {
        status: "ok",
        summary:
          [data.name, data.country].filter(Boolean).join(" · ") || "Allocation found",
        geo,
        details: {
          networkName: data.name,
          allocationCountry: data.country,
          range: [data.startAddress, data.endAddress].filter(Boolean).join(" – "),
        },
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
