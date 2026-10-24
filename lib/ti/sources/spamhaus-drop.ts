import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getText, isTimeout } from "../http";
import { sharedLoader } from "../shared-feed";
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

const FEEDS: Record<4 | 6, string> = {
  4: "https://www.spamhaus.org/drop/drop_v4.json",
  6: "https://www.spamhaus.org/drop/drop_v6.json",
};
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — DROP changes slowly

interface Cache {
  blocks: DropBlock[];
  fetchedAt: number;
}

// One cache and one shared download per family: the two feeds are separate
// documents with independent lifetimes, and a v6 lookup must not be served the
// v4 blocklist.
const caches: Partial<Record<4 | 6, Cache>> = {};

function downloader(family: 4 | 6) {
  return sharedLoader(async (signal): Promise<Cache> => {
    const { ok, status, text } = await getText(FEEDS[family], signal);
    if (!ok) throw new Error(`feed unavailable (HTTP ${status})`);
    const fresh: Cache = { blocks: parseDropFeed(text), fetchedAt: Date.now() };
    caches[family] = fresh;
    return fresh;
  });
}

const downloads: Record<4 | 6, ReturnType<typeof downloader>> = {
  4: downloader(4),
  6: downloader(6),
};

async function loadFeed(family: 4 | 6, signal: AbortSignal): Promise<Cache> {
  const cached = caches[family];
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  return downloads[family](signal);
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
    families: [4, 6],
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    const family = ip.includes(":") ? 6 : 4;
    try {
      const { blocks } = await loadFeed(family, signal);
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
