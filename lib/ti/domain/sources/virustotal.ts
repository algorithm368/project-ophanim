import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface VtDomainResolutionsResponse {
  data?: { attributes?: { ip_address?: string } }[];
}

/**
 * Pull historical passive-DNS resolutions for the domain - IPs it has pointed
 * at over time, richer than the current A record. Best-effort.
 */
async function fetchDomainResolutions(
  domain: string,
  signal: AbortSignal,
  headers: Record<string, string>,
): Promise<RelatedIndicator[]> {
  try {
    const { ok, data } = await getJson<VtDomainResolutionsResponse>(
      `https://www.virustotal.com/api/v3/domains/${domain}/resolutions?limit=10`,
      signal,
      headers,
    );
    if (!ok || !Array.isArray(data?.data)) return [];
    const ips = data.data
      .map((d) => d?.attributes?.ip_address)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    return [...new Set(ips)]
      .slice(0, 8)
      .map((value) => ({ value, type: "ip", relation: "resolved" }));
  } catch {
    return [];
  }
}

interface VtDomainResponse {
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
      categories?: Record<string, string>;
      registrar?: string;
      creation_date?: number;
      tags?: string[];
    };
  };
  error?: { message?: string };
}

// VT content categories are vendor-specific and messy ("searchengines",
// "Information Technology (alphaMountain.ai)"). Clean + merge them into a small
// set of human labels describing what the domain is.
const CATEGORY_ALIASES: Record<string, string> = {
  // search
  searchengines: "Search engines",
  searchenginesportals: "Search engines",
  searchenginesandportals: "Search engines",
  // it / computers
  informationtechnology: "Information technology",
  computersandtechnology: "Information technology",
  computertechnology: "Information technology",
  technology: "Information technology",
  // storage / hosting
  onlinestorage: "Online storage",
  contentserver: "Online storage",
  // news
  news: "News & media",
  newsandmedia: "News & media",
  newsmedia: "News & media",
  // media
  radiomusic: "Radio & music",
  streamingmedia: "Streaming media",
  // social
  socialnetworks: "Social networking",
  socialnetworking: "Social networking",
  // education / reference (often split across many near-identical labels)
  education: "Education & reference",
  educationreference: "Education & reference",
  educationalmaterials: "Education & reference",
  educationalinstitutions: "Education & reference",
  reference: "Education & reference",
  // commerce / finance
  shopping: "Shopping",
  ecommerce: "Shopping",
  business: "Business",
  finance: "Finance",
  financialservices: "Finance",
  // misc
  gambling: "Gambling",
  entertainment: "Entertainment",
  advertisements: "Advertising",
  advertising: "Advertising",
};

// Descriptive categories ("what it does") should outrank broad/infrastructure
// ones, so e.g. google.com leads with "Search engines" over "Information
// technology". Higher number = surfaced first; unknown labels sit in the middle.
const CATEGORY_PRIORITY: Record<string, number> = {
  "Search engines": 100,
  "Social networking": 95,
  "News & media": 90,
  Shopping: 88,
  Finance: 86,
  Gambling: 85,
  Entertainment: 80,
  "Radio & music": 78,
  "Streaming media": 78,
  "Education & reference": 75,
  "Online storage": 30,
  Advertising: 25,
  Business: 20,
  "Information technology": 10,
};
const DEFAULT_PRIORITY = 50;

function priorityOf(label: string): number {
  return CATEGORY_PRIORITY[label] ?? DEFAULT_PRIORITY;
}

/** VT vendor stats → 0-100 (domain weighting: 10× malicious + 3× suspicious). */
export function vtScore(malicious: number, suspicious: number): number {
  return Math.min(100, malicious * 10 + suspicious * 3);
}

export function normalizeCategories(map: Record<string, string>): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const raw of Object.values(map)) {
    const cleaned = raw.replace(/\s*\(.*?\)\s*$/, "").trim().toLowerCase();
    if (!cleaned) continue;
    const key = cleaned.replace(/[^a-z0-9]/g, "");
    const label =
      CATEGORY_ALIASES[key] ?? cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    const dedupeKey = label.toLowerCase();
    const entry = counts.get(dedupeKey) ?? { label, n: 0 };
    entry.n += 1;
    counts.set(dedupeKey, entry);
  }
  return Array.from(counts.values())
    .sort(
      (a, b) =>
        priorityOf(b.label) - priorityOf(a.label) ||
        b.n - a.n ||
        a.label.localeCompare(b.label),
    )
    .map((c) => c.label)
    .slice(0, 4);
}

/** VirusTotal v3 - multi-engine domain reputation (free API key required). */
export const virusTotalDomainSource: TiSource = {
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
  async check(domain, signal): Promise<SourceFinding> {
    const key = process.env.VIRUSTOTAL_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const headers = { "x-apikey": key };
      const [main, relations] = await Promise.all([
        getJson<VtDomainResponse>(
          `https://www.virustotal.com/api/v3/domains/${domain}`,
          signal,
          headers,
        ),
        fetchDomainResolutions(domain, signal, headers),
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

      const score = vtScore(malicious, suspicious);
      // Content categories describe what the domain is - keep them out of the
      // threat-signal list and surface them as context instead.
      const contentCategories = normalizeCategories(attr.categories ?? {});

      return {
        status: "ok",
        malicious: malicious >= 3,
        score,
        summary: `${malicious}/${total} vendors flagged malicious${
          suspicious ? `, ${suspicious} suspicious` : ""
        }`,
        domainContext: { categories: contentCategories },
        details: {
          maliciousVendors: malicious,
          suspiciousVendors: suspicious,
          harmlessVendors: stats.harmless ?? 0,
          totalVendors: total,
          reputation: attr.reputation,
          registrar: attr.registrar,
          categories: attr.categories,
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
