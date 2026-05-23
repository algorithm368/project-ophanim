import type { SourceFinding, TiSource } from "../types";
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

/** VirusTotal v3 — multi-engine IP reputation (free API key required). */
export const virusTotalSource: TiSource = {
  meta: {
    id: "virustotal",
    name: "VirusTotal",
    url: "https://www.virustotal.com",
    category: "reputation",
    requiresKey: true,
    keyEnv: "VIRUSTOTAL_API_KEY",
  },
  isEnabled: () => Boolean(process.env.VIRUSTOTAL_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.VIRUSTOTAL_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<VtResponse>(
        `https://www.virustotal.com/api/v3/ip_addresses/${ip}`,
        signal,
        { "x-apikey": key },
      );
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
