import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getText, isTimeout } from "../http";

const FEED_URL =
  "https://rules.emergingthreats.net/blockrules/compromised-ips.txt";
const TTL_MS = 60 * 60 * 1000; // 1 hour

interface Cache {
  ips: Set<string>;
  fetchedAt: number;
}

let cache: Cache | null = null;
let inflight: Promise<Cache> | null = null;

async function loadFeed(signal: AbortSignal): Promise<Cache> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const { ok, status, text } = await getText(FEED_URL, signal);
    if (!ok) throw new Error(`feed unavailable (HTTP ${status})`);
    const ips = new Set<string>();
    for (const line of text.split("\n")) {
      const v = line.trim();
      if (v && !v.startsWith("#")) ips.add(v);
    }
    cache = { ips, fetchedAt: Date.now() };
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Emerging Threats Open: known compromised hosts blocklist (no key). */
export const etOpenSource: TiSource = {
  meta: {
    id: "et-open",
    name: "ET Open",
    url: "https://rules.emergingthreats.net",
    category: "blocklist",
    requiresKey: false,
    weight: 0.9,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ips } = await loadFeed(signal);
      if (!ips.has(ip)) {
        return {
          status: "ok",
          score: 0,
          summary: "Not on the ET Open compromised-hosts list",
        };
      }
      return {
        status: "ok",
        malicious: true,
        score: 85,
        categories: ["compromised", "et-open"],
        summary: "Listed as a known compromised host (ET Open)",
        details: { list: "compromised-ips", listSize: ips.size },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
