import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getText, isTimeout } from "../http";
import { sharedLoader } from "../shared-feed";

const FEED_URL =
  "https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt";
const TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Parse the IPsum feed into an `ip -> list count` map. Each non-comment line is
 * `<ip>\t<number of blacklists>`; the count is the strength of the signal.
 */
export function parseIpsum(text: string): Map<string, number> {
  const byIp = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [ip, countRaw] = line.split(/\s+/);
    const count = Number(countRaw);
    if (ip && Number.isFinite(count)) byIp.set(ip, count);
  }
  return byIp;
}

/** Risk 0-100 from the number of blocklists IPsum aggregated for this IP. */
export function ipsumScore(count: number): number {
  return Math.min(100, count * 10);
}

/**
 * IPsum aggregates 30+ public blocklists; a hit on a single list is noisy, but
 * presence on three or more independent lists is a strong consensus signal.
 */
export function ipsumMalicious(count: number): boolean {
  return count >= 3;
}

interface Cache {
  byIp: Map<string, number>;
  fetchedAt: number;
}

let cache: Cache | null = null;

const download = sharedLoader(async (signal): Promise<Cache> => {
  const { ok, status, text } = await getText(FEED_URL, signal);
  if (!ok || !text) throw new Error(`feed unavailable (HTTP ${status})`);
  cache = { byIp: parseIpsum(text), fetchedAt: Date.now() };
  return cache;
});

async function loadFeed(signal: AbortSignal): Promise<Cache> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  return download(signal);
}

/** IPsum (stamparm): IPs aggregated across 30+ public blocklists (no key). */
export const ipsumSource: TiSource = {
  meta: {
    id: "ipsum",
    name: "IPsum",
    url: "https://github.com/stamparm/ipsum",
    category: "blocklist",
    requiresKey: false,
    weight: 0.7,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { byIp } = await loadFeed(signal);
      const count = byIp.get(ip);
      if (!count) {
        return {
          status: "ok",
          score: 0,
          summary: "Not on any aggregated blocklist",
        };
      }
      return {
        status: "ok",
        malicious: ipsumMalicious(count),
        score: ipsumScore(count),
        categories: ["blocklisted"],
        summary: `Listed on ${count} public blocklist(s)`,
        details: { blocklistCount: count },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
