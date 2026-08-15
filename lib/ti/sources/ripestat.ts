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

interface RpkiResponse {
  data?: { status?: string };
}

/** An "invalid" RPKI origin (the prefix is announced by an AS the ROA forbids)
 *  is a soft route-hijack signal; "valid"/"unknown" add no tag. */
export function rpkiCategories(status: string | undefined): string[] {
  return status === "invalid" ? ["rpki-invalid"] : [];
}

/** Best-effort RPKI origin validation for the announcing AS + prefix. */
async function fetchRpkiStatus(
  asn: string,
  prefix: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    const { ok, data } = await getJson<RpkiResponse>(
      `https://stat.ripe.net/data/rpki-validation/data.json?resource=AS${asn}&prefix=${encodeURIComponent(prefix)}`,
      signal,
    );
    return ok ? data?.data?.status : undefined;
  } catch {
    return undefined;
  }
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
    families: [4, 6],
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

      const finding = ripestatFinding(data.data);
      // +1 best-effort call: validate the prefix's RPKI origin for the AS.
      const asn = (data.data?.asns ?? []).find(Boolean);
      const prefix = data.data?.prefix;
      const rpkiStatus =
        asn && prefix ? await fetchRpkiStatus(asn, prefix, signal) : undefined;

      return {
        ...finding,
        categories: rpkiCategories(rpkiStatus),
        details: { ...finding.details, rpkiStatus },
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
