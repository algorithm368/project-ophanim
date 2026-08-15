import { getText } from "../http";
import { parseUrl } from "@/lib/url";

// openphish.com/feed.txt redirects here; use the canonical source directly.
const FEED_URL =
  "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt";
const TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * The feed is a list of full phishing URLs. Both projections are kept because
 * they answer different questions: `hosts` says the name has been used for
 * phishing, `urls` says this exact resource is the phish. The host match is the
 * weaker claim, since one compromised site can host both a phish and a hundred
 * innocent pages.
 */
export interface OpenphishFeed {
  hosts: Set<string>;
  /** Canonical URLs, so a feed line and a pasted URL compare equal. */
  urls: Set<string>;
  fetchedAt: number;
}

let cache: OpenphishFeed | null = null;
let inflight: Promise<OpenphishFeed> | null = null;

/** Tests only: drop the module-level feed cache between cases. */
export function resetOpenphishCache(): void {
  cache = null;
  inflight = null;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/** Download and index the feed, reusing the cached copy within its TTL and
 *  collapsing concurrent callers onto one request. */
export async function loadOpenphishFeed(
  signal: AbortSignal,
): Promise<OpenphishFeed> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const { ok, status, text } = await getText(FEED_URL, signal);
    if (!ok || !text) {
      throw new Error(`feed unavailable (HTTP ${status})`);
    }
    const hosts = new Set<string>();
    const urls = new Set<string>();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const host = hostOf(trimmed);
      if (host) hosts.add(host);
      const parsed = parseUrl(trimmed);
      if (parsed) urls.add(parsed.canonical);
    }
    cache = { hosts, urls, fetchedAt: Date.now() };
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
