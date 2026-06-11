import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postForm } from "../../http";

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

/**
 * URLhaus host verdict. Live (online) payloads are a hard signal; URLs already
 * taken down are historical and weaker, so a single stale URL on a big host
 * shouldn't max the verdict.
 */
export function urlhausVerdict(
  online: number,
  total: number,
): { score: number; malicious: boolean } {
  if (online > 0) return { score: Math.min(100, 60 + online * 5), malicious: true };
  return { score: Math.min(70, 20 + total * 4), malicious: total >= 5 };
}

/**
 * Reputable-blocklist listing for the host. `spamhaus_dbl` reports a specific
 * abuse label ("malware_domain", "phishing_domain", "abused_legit_malware", …)
 * or "not listed"; `surbl` is "listed" / "not listed". A listing on either is a
 * reputable-blocklist confirmation — the one URLhaus signal that moves the score
 * on its own (independent of whether any malware URLs are currently catalogued).
 */
export function blacklistVerdict(
  blacklists: Record<string, string> | undefined,
): { listed: boolean; score: number; categories: string[] } {
  const categories: string[] = [];
  const dbl = blacklists?.spamhaus_dbl;
  const surbl = blacklists?.surbl;
  if (dbl && dbl !== "not listed") categories.push(`spamhaus:${dbl}`);
  if (surbl && surbl !== "not listed") categories.push(`surbl:${surbl}`);
  const listed = categories.length > 0;
  return { listed, score: listed ? 65 : 0, categories };
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
      const { ok, status, data } = await postForm<UrlhausResponse>(
        "https://urlhaus-api.abuse.ch/v1/host/",
        signal,
        { host: domain },
        { "Auth-Key": key },
      );

      const blacklist = blacklistVerdict(data?.blacklists);

      if (data?.query_status === "no_results") {
        // No catalogued URLs, but the host can still be on a reputable
        // blocklist — that listing alone is a verdict-moving signal.
        if (blacklist.listed) {
          return {
            status: "ok",
            malicious: true,
            score: blacklist.score,
            categories: blacklist.categories,
            summary: `On reputable blocklist: ${blacklist.categories.join(", ")}`,
            details: { blacklists: data.blacklists },
            raw: data,
          };
        }
        return { status: "ok", score: 0, summary: "No malicious URLs on record" };
      }
      if (!ok || data?.query_status !== "ok") {
        return {
          status: "error",
          error: data?.query_status ?? `HTTP ${status}`,
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

      const url = urlhausVerdict(online, total);
      // Reputable-blocklist membership floors the score and the malicious call.
      const score = Math.max(url.score, blacklist.score);
      const malicious = url.malicious || blacklist.listed;

      return {
        status: "ok",
        malicious,
        score,
        categories: [...threats, ...tags, ...blacklist.categories].slice(0, 12),
        lastSeen: data.firstseen,
        summary:
          `Hosts ${total} malicious URL(s)${online > 0 ? `, ${online} online` : ""}` +
          (blacklist.listed ? `; ${blacklist.categories.join(", ")}` : ""),
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
