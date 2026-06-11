import type { RelatedIndicator, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";
import {
  communicatingSamples,
  relationshipIds,
  resolutionDomain,
  type VtRelationships,
} from "../vt-relationships";

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
    /** Inline relationship pivots fetched via the `?relationships=` param. */
    relationships?: VtRelationships;
  };
  error?: { message?: string };
}

/**
 * Passive-DNS hosted domains + communicating malware samples from the inline
 * `?relationships=` block. Resolution items carry only an `${ip}${host_name}`
 * id (no inline attributes), so the domain is recovered by stripping the IP.
 */
export function ipRelationsFromVt(
  ip: string,
  rels: VtRelationships | undefined,
): RelatedIndicator[] {
  const hosted = relationshipIds(rels, "resolutions", 8)
    .map((id) => resolutionDomain(id, ip))
    .filter((d): d is string => Boolean(d))
    .map((value) => ({ value, type: "domain" as const, relation: "hosted" }));
  return [...hosted, ...communicatingSamples(rels)];
}

/** VT vendor stats → 0-100 (IP weighting: 10× malicious + 3× suspicious). */
export function vtScore(malicious: number, suspicious: number): number {
  return Math.min(100, malicious * 10 + suspicious * 3);
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
      // Single request: hosted-domain + communicating-sample pivots ride along
      // on the main GET via ?relationships=, replacing the separate /resolutions
      // call.
      const { ok, status, data } = await getJson<VtResponse>(
        `https://www.virustotal.com/api/v3/ip_addresses/${ip}?relationships=resolutions,communicating_files`,
        signal,
        headers,
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

      const score = vtScore(malicious, suspicious);
      const relations = ipRelationsFromVt(ip, data.data.relationships);

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
