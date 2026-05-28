import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";

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
  async check(domain, signal): Promise<SourceFinding> {
    const key = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const res = await fetch(
        `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`,
        {
          method: "POST",
          signal,
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client: { clientId: "project-ophanim", clientVersion: "0.1" },
            threatInfo: {
              threatTypes: Object.keys(THREAT_LABEL),
              platformTypes: ["ANY_PLATFORM"],
              threatEntryTypes: ["URL"],
              threatEntries: [{ url: domain }],
            },
          }),
        },
      );
      const text = await res.text();
      let data: SbResponse | null = null;
      try {
        data = text ? (JSON.parse(text) as SbResponse) : null;
      } catch {
        data = null;
      }

      if (!res.ok) {
        return {
          status: "error",
          error: data?.error?.message ?? `HTTP ${res.status}`,
        };
      }

      const matches = data?.matches ?? [];
      if (matches.length === 0) {
        return { status: "ok", score: 0, summary: "Not on any Safe Browsing list" };
      }

      const threats = Array.from(
        new Set(
          matches.map((m) => THREAT_LABEL[m.threatType ?? ""] ?? m.threatType ?? "threat"),
        ),
      );

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
  },
};
