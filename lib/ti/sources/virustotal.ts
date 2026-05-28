import type { RelatedIndicator, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface VtResponse {
  data?: {
    attributes?: {
      last_analysis_stats?: {
        harmless?: number;
        malicious?: number;
        suspicious?: number;
        undetected?: number;
        timeout?: number;
      };
      reputation?: number;
      as_owner?: string;
      asn?: number;
      country?: string;
      tags?: string[];
    };
  };
  error?: { message?: string };
}

interface VtResolutionsResponse {
  data?: { attributes?: { host_name?: string } }[];
}

/**
 * Pull recent passive-DNS resolutions for the IP - the domains seen pointing
 * at it - so the investigation graph can pivot IP -> hosted-domain. Best-effort:
 * any failure (timeout, quota, etc.) just yields no relations.
 */
async function fetchIpResolutions(
  ip: string,
  signal: AbortSignal,
  headers: Record<string, string>,
): Promise<RelatedIndicator[]> {
  try {
    const { ok, data } = await getJson<VtResolutionsResponse>(
      `https://www.virustotal.com/api/v3/ip_addresses/${ip}/resolutions?limit=10`,
      signal,
      headers,
    );
    if (!ok || !Array.isArray(data?.data)) return [];
    const hosts = data.data
      .map((d) => d?.attributes?.host_name)
      .filter((h): h is string => typeof h === "string" && h.length > 0);
    return [...new Set(hosts)]
      .slice(0, 8)
      .map((value) => ({ value, type: "domain", relation: "hosted" }));
  } catch {
    return [];
  }
}

/** VirusTotal v3: multi-engine IP reputation (free API key required). */
export const virusTotalSource: TiSource = {
  meta: {
    id: "virustotal",
    name: "VirusTotal",
    url: "https://www.virustotal.com",
    category: "reputation",
    requiresKey: true,
    weight: 1,
    keyEnv: "VIRUSTOTAL_API_KEY",
  },
  isEnabled: () => Boolean(process.env.VIRUSTOTAL_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.VIRUSTOTAL_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const headers = { "x-apikey": key };
      const [main, relations] = await Promise.all([
        getJson<VtResponse>(
          `https://www.virustotal.com/api/v3/ip_addresses/${ip}`,
          signal,
          headers,
        ),
        fetchIpResolutions(ip, signal, headers),
      ]);
      const { ok, status, data } = main;
      if (!ok || !data?.data?.attributes) {
        return {
          status: "error",
          error: data?.error?.message ?? `HTTP ${status}`,
        };
      }

      const attr = data.data.attributes;
      const stats = attr.last_analysis_stats ?? {};
      const malicious = stats.malicious ?? 0;
      const suspicious = stats.suspicious ?? 0;
      const total =
        (stats.harmless ?? 0) +
        malicious +
        suspicious +
        (stats.undetected ?? 0) +
        (stats.timeout ?? 0);

      const score = Math.min(100, malicious * 10 + suspicious * 3);

      return {
        status: "ok",
        malicious: malicious >= 3,
        score,
        summary: `${malicious}/${total} vendors flagged malicious${
          suspicious ? `, ${suspicious} suspicious` : ""
        }`,
        categories: attr.tags ?? [],
        details: {
          maliciousVendors: malicious,
          suspiciousVendors: suspicious,
          harmlessVendors: stats.harmless ?? 0,
          totalVendors: total,
          reputation: attr.reputation,
          asOwner: attr.as_owner,
          asn: attr.asn,
          country: attr.country,
        },
        relations: relations.length ? relations : undefined,
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
