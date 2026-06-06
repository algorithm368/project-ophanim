import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface NetworkInfoResponse {
  data?: {
    /** The announced prefix the IP falls within, e.g. "27.254.104.0/23". */
    prefix?: string;
    /** ASNs announcing that prefix. */
    asns?: string[];
  };
}

/** Map RIPEstat network-info into a context finding (announced prefix + ASN). */
export function ripestatFinding(data: NetworkInfoResponse["data"]): SourceFinding {
  const prefix = data?.prefix;
  const asns = (data?.asns ?? []).filter(Boolean);

  if (!prefix && asns.length === 0) {
    return { status: "ok", summary: "Not announced in BGP" };
  }

  const asnLabel = asns.map((a) => `AS${a}`).join(", ");
  const geo: GeoContext | undefined = asns[0]
    ? { asn: `AS${asns[0]}` }
    : undefined;

  return {
    status: "ok",
    summary: [prefix && `Announced as ${prefix}`, asnLabel && `by ${asnLabel}`]
      .filter(Boolean)
      .join(" "),
    geo,
    details: { prefix, asns },
  };
}

/** RIPEstat (RIPE NCC): BGP routing context — announced prefix + ASN (no key). */
export const ripeStatSource: TiSource = {
  meta: {
    id: "ripestat",
    name: "RIPEstat",
    url: "https://stat.ripe.net",
    category: "context",
    requiresKey: false,
    weight: 0,
    // stat.ripe.net can be slow under load; give it more headroom than the
    // 8s default so this enrichment isn't lost to a timeout.
    timeoutMs: 12000,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, status, data } = await getJson<NetworkInfoResponse>(
        `https://stat.ripe.net/data/network-info/data.json?resource=${ip}`,
        signal,
      );
      if (!ok || !data) return { status: "error", error: `HTTP ${status}` };
      return { ...ripestatFinding(data.data), raw: data };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
