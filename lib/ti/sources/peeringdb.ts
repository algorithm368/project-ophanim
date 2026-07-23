import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface NetworkInfoResponse {
  data?: {
    asns?: unknown[];
  };
}

interface PeeringDbNetRecord {
  name?: string;
  info_type?: string;
  info_traffic?: string;
}

interface PeeringDbNetResponse {
  data?: PeeringDbNetRecord[];
}

/** Normalize one RIPEstat `asns` element to a plain ASN string. Elements are
 *  documented as strings, but defensively accept a number or an `{ asn }`
 *  object shape too. */
function asnToString(entry: unknown): string | undefined {
  if (typeof entry === "string" || typeof entry === "number") return String(entry);
  if (entry && typeof entry === "object" && "asn" in entry) {
    const asn = (entry as { asn?: unknown }).asn;
    if (typeof asn === "string" || typeof asn === "number") return String(asn);
  }
  return undefined;
}

/** First ASN announcing the prefix that contains this IP (keyless RIPEstat). */
async function resolveAsn(ip: string, signal: AbortSignal): Promise<string | undefined> {
  const { ok, data } = await getJson<NetworkInfoResponse>(
    `https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`,
    signal,
  );
  if (!ok || !data) return undefined;
  const asns = data.data?.asns;
  if (!Array.isArray(asns) || asns.length === 0) return undefined;
  return asnToString(asns[0]);
}

/** PeeringDB (peeringdb.com): network classification for an IP's ASN. Keyless,
 *  context-only (weight 0). "info_type" is PeeringDB's own network category,
 *  e.g. "ISP", "Content", "Hosting", "Enterprise". */
export const peeringDbSource: TiSource = {
  meta: {
    id: "peeringdb",
    name: "PeeringDB",
    url: "https://www.peeringdb.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const asn = await resolveAsn(ip, signal);
      if (!asn) return { status: "ok", summary: "No ASN to look up" };

      const { ok, status, data } = await getJson<PeeringDbNetResponse>(
        `https://www.peeringdb.com/api/net?asn=${encodeURIComponent(asn)}`,
        signal,
      );
      if (!ok || !data) return { status: "error", error: `HTTP ${status}` };

      const rec = data.data?.[0];
      if (!rec) return { status: "ok", summary: "Not registered in PeeringDB" };

      return {
        status: "ok",
        summary: [rec.name, rec.info_type].filter(Boolean).join(", ") || "PeeringDB record",
        details: {
          networkClass: rec.info_type || undefined,
          peeringName: rec.name || undefined,
          trafficLevel: rec.info_traffic || undefined,
        },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
