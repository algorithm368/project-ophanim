import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";
import { abuseContact, type RdapVcardEntity } from "../rdap-shared";

export interface RdapIpResponse {
  country?: string;
  name?: string;
  startAddress?: string;
  endAddress?: string;
  handle?: string;
  events?: { eventAction?: string; eventDate?: string }[];
  entities?: RdapVcardEntity[];
}

export function rdapIpToGeo(data: RdapIpResponse): GeoContext {
  const geo: GeoContext = {};
  if (data.country) geo.countryCode = data.country;
  if (data.name) geo.asnOrg = data.name;
  return geo;
}

/** Whole-day age of the allocation from its RDAP "registration" event. */
function allocationAgeDays(
  events: RdapIpResponse["events"],
  now = Date.now(),
): number | undefined {
  const reg = events?.find((e) => e.eventAction === "registration")?.eventDate;
  if (!reg) return undefined;
  const t = Date.parse(reg);
  return Number.isNaN(t) ? undefined : Math.floor((now - t) / 86_400_000);
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
    families: [4, 6],
    // rdap.org 302-redirects to the authoritative RIR (two hops), and some RIRs
    // (ARIN, AFRINIC) are genuinely slow. Default mode (not no-cors) is required
    // so undici follows that cross-origin redirect at all; 12s of headroom — the
    // same ceiling RIPEstat already uses — absorbs slow RIRs without lengthening
    // the worst-case wait.
    timeoutMs: 12000,
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
      const abuse = abuseContact(data.entities);
      const registeredAt = data.events?.find(
        (e) => e.eventAction === "registration",
      )?.eventDate;
      const ageDays = allocationAgeDays(data.events);
      return {
        status: "ok",
        summary:
          [data.name, data.country].filter(Boolean).join(" · ") || "Allocation found",
        geo,
        details: {
          networkName: data.name,
          allocationCountry: data.country,
          range: [data.startAddress, data.endAddress].filter(Boolean).join(" – "),
          registeredAt,
          allocationAgeDays: ageDays,
          abuseContact: abuse?.email,
          abuseOrg: abuse?.org,
        },
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
