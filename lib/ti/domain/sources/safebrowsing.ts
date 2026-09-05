import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postJson } from "../../http";

interface ThreatMatch {
  threatType?: string;
  platformType?: string;
}

interface SbResponse {
  matches?: ThreatMatch[];
  error?: { message?: string };
}

const THREAT_LABEL: Record<string, string> = {
  MALWARE: "malware",
  SOCIAL_ENGINEERING: "phishing",
  UNWANTED_SOFTWARE: "unwanted software",
  POTENTIALLY_HARMFUL_APPLICATION: "harmful application",
};

/** De-dupe Safe Browsing matches into human threat labels. */
export function labelThreats(matches: ThreatMatch[]): string[] {
  return Array.from(
    new Set(
      matches.map(
        (m) => THREAT_LABEL[m.threatType ?? ""] ?? m.threatType ?? "threat",
      ),
    ),
  );
}

/**
 * Query Safe Browsing for one indicator. The v4 API takes a URL entry either
 * way, so a bare domain and a full URL differ only in what is handed to it,
 * which is why the domain-level and URL-level sources share this and do not
 * each carry a copy of the request shape.
 */
export async function safeBrowsingLookup(
  indicator: string,
  signal: AbortSignal,
): Promise<SourceFinding> {
  const key = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!key) return { status: "skipped" };
  try {
    const { ok, status, data } = await postJson<SbResponse>(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`,
      signal,
      {
        client: { clientId: "project-ophanim", clientVersion: "0.1" },
        threatInfo: {
          threatTypes: Object.keys(THREAT_LABEL),
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url: indicator }],
        },
      },
    );

    if (!ok) {
      return {
        status: "error",
        error: data?.error?.message ?? `HTTP ${status}`,
      };
    }

    const matches = data?.matches ?? [];
    if (matches.length === 0) {
      return { status: "ok", score: 0, summary: "Not on any Safe Browsing list" };
    }

    const threats = labelThreats(matches);

    return {
      status: "ok",
      malicious: true,
      score: 90,
      categories: threats,
      summary: `Flagged by Google for ${threats.join(", ")}`,
      details: { threatTypes: matches.map((m) => m.threatType) },
      raw: data,
    };
  } catch (err) {
    return {
      status: isTimeout(err) ? "timeout" : "error",
      error: errorMessage(err),
    };
  }
}

/** Google Safe Browsing v4 - authoritative malware/phishing list (free API key). */
export const safeBrowsingSource: TiSource = {
  meta: {
    id: "safebrowsing",
    name: "Google Safe Browsing",
    url: "https://safebrowsing.google.com",
    category: "reputation",
    requiresKey: true,
    weight: 1,
    keyEnv: "GOOGLE_SAFE_BROWSING_API_KEY",
  },
  isEnabled: () => Boolean(process.env.GOOGLE_SAFE_BROWSING_API_KEY),
  check: (domain, signal) => safeBrowsingLookup(domain, signal),
};
