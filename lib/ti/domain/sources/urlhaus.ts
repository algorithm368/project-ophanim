import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";

interface UrlhausUrl {
  url?: string;
  url_status?: string;
  threat?: string;
  tags?: string[] | null;
  date_added?: string;
}

interface UrlhausResponse {
  query_status?: string;
  urls?: UrlhausUrl[];
  url_count?: string | number;
  firstseen?: string;
  blacklists?: Record<string, string>;
}

/** URLhaus (abuse.ch) - malicious URLs hosted on a domain (shared abuse.ch key). */
export const urlhausSource: TiSource = {
  meta: {
    id: "urlhaus",
    name: "URLhaus",
    url: "https://urlhaus.abuse.ch",
    category: "blocklist",
    requiresKey: true,
    weight: 0.9,
    // abuse.ch issues one Auth-Key that works across ThreatFox/URLhaus/etc.
    keyEnv: "THREATFOX_API_KEY",
  },
  isEnabled: () => Boolean(process.env.THREATFOX_API_KEY),
  async check(domain, signal): Promise<SourceFinding> {
    const key = process.env.THREATFOX_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const res = await fetch("https://urlhaus-api.abuse.ch/v1/host/", {
        method: "POST",
        signal,
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "Auth-Key": key,
        },
        body: new URLSearchParams({ host: domain }).toString(),
      });
      const text = await res.text();
      let data: UrlhausResponse | null = null;
      try {
        data = text ? (JSON.parse(text) as UrlhausResponse) : null;
      } catch {
        data = null;
      }

      if (data?.query_status === "no_results") {
        return { status: "ok", score: 0, summary: "No malicious URLs on record" };
      }
      if (!res.ok || data?.query_status !== "ok") {
        return {
          status: "error",
          error: data?.query_status ?? `HTTP ${res.status}`,
        };
      }

      const urls = data.urls ?? [];
      const online = urls.filter((u) => u.url_status === "online").length;
      const threats = Array.from(
        new Set(urls.map((u) => u.threat).filter(Boolean)),
      ) as string[];
      const tags = Array.from(
        new Set(urls.flatMap((u) => u.tags ?? [])),
      ).slice(0, 10);
      const total = Number(data.url_count ?? urls.length) || urls.length;

      // Live payloads are a hard signal; URLs already taken down are historical
      // and weaker - a single stale URL on a big host shouldn't max the verdict.
      let score: number;
      let malicious: boolean;
      if (online > 0) {
        score = Math.min(100, 60 + online * 5);
        malicious = true;
      } else {
        score = Math.min(70, 20 + total * 4);
        malicious = total >= 5;
      }

      return {
        status: "ok",
        malicious,
        score,
        categories: [...threats, ...tags].slice(0, 12),
        lastSeen: data.firstseen,
        summary: `Hosts ${total} malicious URL(s)${online > 0 ? `, ${online} online` : ""}`,
        details: {
          urlCount: total,
          onlineUrls: online,
          threats,
          blacklists: data.blacklists,
          firstSeen: data.firstseen,
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
