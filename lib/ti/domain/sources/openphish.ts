import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getText, isTimeout } from "../../http";

// openphish.com/feed.txt redirects here; use the canonical source directly.
const FEED_URL =
  "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt";
const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface Cache {
  hosts: Set<string>;
  fetchedAt: number;
}

let cache: Cache | null = null;
let inflight: Promise<Cache> | null = null;

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

async function loadFeed(signal: AbortSignal): Promise<Cache> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const { ok, status, text } = await getText(FEED_URL, signal);
    if (!ok || !text) {
      throw new Error(`feed unavailable (HTTP ${status})`);
    }
    const hosts = new Set<string>();
    for (const line of text.split("\n")) {
      const host = hostOf(line);
      if (host) hosts.add(host);
    }
    cache = { hosts, fetchedAt: Date.now() };
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** OpenPhish - community phishing URL feed (no key, cached download). */
export const openPhishSource: TiSource = {
  meta: {
    id: "openphish",
    name: "OpenPhish",
    url: "https://openphish.com",
    category: "blocklist",
    requiresKey: false,
    weight: 0.9,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      const { hosts } = await loadFeed(signal);
      if (!hosts.has(domain)) {
        return { status: "ok", score: 0, summary: "Not in the phishing feed" };
      }
      return {
        status: "ok",
        malicious: true,
        score: 90,
        categories: ["phishing"],
        summary: "Listed as an active phishing host",
        details: { feedSize: hosts.size },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
