import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface AbuseResponse {
  data?: {
    abuseConfidenceScore?: number;
    totalReports?: number;
    numDistinctUsers?: number;
    countryCode?: string;
    isp?: string;
    domain?: string;
    usageType?: string;
    isWhitelisted?: boolean;
    isTor?: boolean;
    lastReportedAt?: string;
  };
  errors?: { detail?: string }[];
}

export type AbuseData = NonNullable<AbuseResponse["data"]>;

/** Map an AbuseIPDB confidence record to score/verdict/categories/summary. */
export function summarizeAbuse(d: AbuseData): {
  score: number;
  malicious: boolean;
  categories: string[];
  summary: string;
} {
  const score = d.abuseConfidenceScore ?? 0;
  const categories: string[] = [];
  if (d.isTor) categories.push("tor");
  if (d.usageType) categories.push(d.usageType);
  return {
    score,
    // AbuseIPDB's own confidence ≥50% is the community "this is abusive" line.
    malicious: score >= 50,
    categories,
    summary: `${score}% abuse confidence from ${d.totalReports ?? 0} report(s)`,
  };
}

/** AbuseIPDB: community abuse reports, confidence score (free API key required). */
export const abuseIpdbSource: TiSource = {
  meta: {
    id: "abuseipdb",
    name: "AbuseIPDB",
    url: "https://www.abuseipdb.com",
    category: "reputation",
    requiresKey: true,
    weight: 1,
    keyEnv: "ABUSEIPDB_API_KEY",
  },
  isEnabled: () => Boolean(process.env.ABUSEIPDB_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.ABUSEIPDB_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<AbuseResponse>(
        `https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=90`,
        signal,
        { Key: key },
      );
      if (!ok || !data?.data) {
        return {
          status: "error",
          error: data?.errors?.[0]?.detail ?? `HTTP ${status}`,
        };
      }

      const d = data.data;
      const { score, malicious, categories, summary } = summarizeAbuse(d);

      return {
        status: "ok",
        malicious,
        score,
        lastSeen: d.lastReportedAt,
        summary,
        categories,
        details: {
          totalReports: d.totalReports,
          distinctReporters: d.numDistinctUsers,
          isp: d.isp,
          domain: d.domain,
          usageType: d.usageType,
          countryCode: d.countryCode,
          isWhitelisted: d.isWhitelisted,
          isTor: d.isTor,
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
