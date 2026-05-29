import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getText, isTimeout } from "../http";
import { cidrContains } from "../cidr";

export interface DropBlock {
  cidr: string;
  sblid?: string;
}

/**
 * Parse the DROP feed, which is newline-delimited JSON (one object per line,
 * NOT a JSON array — so getJson can't parse it whole). Lines without a `cidr`
 * (a metadata object, blanks, comments) are skipped.
 */
export function parseDropFeed(text: string): DropBlock[] {
  const blocks: DropBlock[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    try {
      const obj = JSON.parse(trimmed) as { cidr?: string; sblid?: string };
      if (obj.cidr) blocks.push({ cidr: obj.cidr, sblid: obj.sblid });
    } catch {
      // non-JSON line (e.g. an HTML error page) — skip
    }
  }
  return blocks;
}

/** First DROP netblock that contains the IP, or null. */
export function matchDrop(ip: string, blocks: DropBlock[]): DropBlock | null {
  for (const b of blocks) {
    if (cidrContains(b.cidr, ip)) return b;
  }
  return null;
}

const FEED_URL = "https://www.spamhaus.org/drop/drop_v4.json";
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — DROP changes slowly

interface Cache {
  blocks: DropBlock[];
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
    cache = { blocks: parseDropFeed(text), fetchedAt: Date.now() };
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Spamhaus DROP (no key): netblocks wholly controlled by criminals or hijacked.
 * Listing is at netblock granularity, so it carries a low weight and never sets
 * the `malicious` floor — it informs the score and the note without forcing a
 * malicious verdict on an individual IP that happens to share the block.
 */
export const spamhausDropSource: TiSource = {
  meta: {
    id: "spamhaus-drop",
    name: "Spamhaus DROP",
    url: "https://www.spamhaus.org/drop/",
    category: "blocklist",
    requiresKey: false,
    weight: 0.3,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { blocks } = await loadFeed(signal);
      const hit = matchDrop(ip, blocks);
      if (!hit) {
        return {
          status: "ok",
          score: 0,
          summary: "Not in any Spamhaus DROP netblock",
        };
      }
      return {
        status: "ok",
        score: 55,
        categories: ["spamhaus-drop", "criminal-netblock"],
        summary: `Within Spamhaus DROP netblock ${hit.cidr}${
          hit.sblid ? ` (${hit.sblid})` : ""
        }`,
        details: { cidr: hit.cidr, sblid: hit.sblid },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
