import type { GeoContext, RelatedIndicator, SourceFinding, TiSource } from "../types";
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
    /** PTR hostnames (only present with &verbose). */
    hostnames?: string[] | null;
    /** Individual reports (only present with &verbose), newest first and
     *  capped at 100; categories are ids. */
    reports?: { categories?: number[]; reportedAt?: string }[] | null;
  };
  errors?: { detail?: string }[];
}

export type AbuseData = NonNullable<AbuseResponse["data"]>;

/** AbuseIPDB report category ids → human names (the API returns only ids). */
const ABUSE_CATEGORIES: Record<number, string> = {
  1: "DNS Compromise",
  2: "DNS Poisoning",
  3: "Fraud Orders",
  4: "DDoS Attack",
  5: "FTP Brute-Force",
  6: "Ping of Death",
  7: "Phishing",
  8: "Fraud VoIP",
  9: "Open Proxy",
  10: "Web Spam",
  11: "Email Spam",
  12: "Blog Spam",
  13: "VPN IP",
  14: "Port Scan",
  15: "Hacking",
  16: "SQL Injection",
  17: "Spoofing",
  18: "Brute-Force",
  19: "Bad Web Bot",
  20: "Exploited Host",
  21: "Web App Attack",
  22: "SSH",
  23: "IoT Targeted",
};

/** Tally the verbose reports' category ids into named buckets, most-reported
 *  first, so we can say *what* an IP is reported for, not just how often. */
export function categoryBreakdown(
  reports: { categories?: number[] }[] | null | undefined,
): { name: string; count: number }[] {
  const tally = new Map<number, number>();
  for (const r of reports ?? [])
    for (const c of r.categories ?? []) tally.set(c, (tally.get(c) ?? 0) + 1);
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([id, count]) => ({ name: ABUSE_CATEGORIES[id] ?? `Category ${id}`, count }));
}

/** How far back the check looks. The verbose report list covers the same
 *  window, so it is also the timeline's honest horizon. */
export const MAX_AGE_DAYS = 90;

export interface ReportLog {
  /** Reports per UTC day, oldest first. */
  days: { day: string; count: number }[];
  /** Reports the list itemized, which verbose caps at 100. */
  itemized: number;
  /** Earliest itemized report, only when the list is complete: when it is
   *  cut off, the oldest one returned is not the first. */
  firstReported?: string;
}

/** The dated side of the verbose reports: a per-day tally for the timeline's
 *  density strip, and a first report when the list holds every one. */
export function reportLog(d: AbuseData): ReportLog | undefined {
  const dated = (d.reports ?? [])
    .map((r) => r.reportedAt)
    .filter((at): at is string => typeof at === "string" && !Number.isNaN(Date.parse(at)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!dated.length) return undefined;
  const tally = new Map<string, number>();
  for (const at of dated) {
    const day = new Date(Date.parse(at)).toISOString().slice(0, 10);
    tally.set(day, (tally.get(day) ?? 0) + 1);
  }
  const complete = dated.length >= (d.totalReports ?? 0);
  return {
    days: [...tally].map(([day, count]) => ({ day, count })),
    itemized: dated.length,
    firstReported: complete ? dated[0] : undefined,
  };
}

/** Map an AbuseIPDB confidence record to score/verdict/categories/summary. */
export function summarizeAbuse(d: AbuseData): {
  score: number;
  malicious: boolean;
  categories: string[];
  summary: string;
} {
  const score = d.abuseConfidenceScore ?? 0;
  const breakdown = categoryBreakdown(d.reports);
  const categories: string[] = [];
  if (d.isTor) categories.push("tor");
  if (d.usageType) categories.push(d.usageType);
  for (const b of breakdown) categories.push(b.name.toLowerCase());
  // Headline the top report reasons (SourceBreakdown renders summary, not
  // categories), e.g. "… for SSH, Brute-Force".
  const reasons = breakdown.slice(0, 3).map((b) => b.name);
  const base = `${score}% abuse confidence from ${d.totalReports ?? 0} report(s)`;
  return {
    score,
    // AbuseIPDB's own confidence >=75% is the bar for a definitive listing;
    // 50-74% still scores but must not trip the aggregate's hard floor.
    malicious: score >= 75,
    categories: [...new Set(categories)].slice(0, 12),
    summary: reasons.length ? `${base} for ${reasons.join(", ")}` : base,
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
    families: [4, 6],
    keyEnv: "ABUSEIPDB_API_KEY",
  },
  isEnabled: () => Boolean(process.env.ABUSEIPDB_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.ABUSEIPDB_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      // &verbose adds the PTR hostnames + per-report category ids (same call,
      // same 1/1000-day quota) so we can show *what* the IP is reported for.
      const { ok, status, data } = await getJson<AbuseResponse>(
        `https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=${MAX_AGE_DAYS}&verbose`,
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
      const breakdown = categoryBreakdown(d.reports);
      const log = reportLog(d);

      const relations: RelatedIndicator[] = [
        ...new Set(
          (d.hostnames ?? []).filter((h): h is string => Boolean(h)),
        ),
      ]
        .slice(0, 6)
        .map((value) => ({ value, type: "domain" as const, relation: "rDNS" }));

      const geo: GeoContext = {};
      if (d.isp) geo.isp = d.isp;
      if (d.countryCode) geo.countryCode = d.countryCode;

      return {
        status: "ok",
        malicious,
        allowlisted: Boolean(d.isWhitelisted),
        score,
        lastSeen: d.lastReportedAt,
        summary,
        categories,
        geo: d.isp || d.countryCode ? geo : undefined,
        relations: relations.length ? relations : undefined,
        details: {
          totalReports: d.totalReports,
          distinctReporters: d.numDistinctUsers,
          // Named report-reason breakdown (SourceBreakdown doesn't render
          // categories, so the full list lives here).
          reportCategories: breakdown.length ? breakdown : undefined,
          // Dated reports, for the timeline (see timeline.ts reportActivity).
          firstReported: log?.firstReported,
          reportDays: log?.days,
          reportsItemized: log?.itemized,
          reportWindowDays: log ? MAX_AGE_DAYS : undefined,
          isp: d.isp,
          domain: d.domain,
          usageType: d.usageType,
          countryCode: d.countryCode,
          hostnames: d.hostnames?.length ? d.hostnames : undefined,
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
