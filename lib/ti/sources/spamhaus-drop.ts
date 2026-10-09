import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getText, isTimeout } from "../http";
import { sharedLoader } from "../shared-feed";
import { ipValue, parseCidr } from "../cidr";

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

/** One parsed block, in the order `DropIndex.sorted` keeps them. */
interface IndexedBlock<T extends number | bigint> {
  start: T;
  end: T;
  /** Nearest enclosing block in `sorted`, or -1 at the top level. */
  parent: number;
  /** The block `matchDrop` reports for an address whose deepest match is this
   *  one: the earliest in feed order among it and its enclosing blocks. */
  first: DropBlock;
}

interface DropIndex {
  4: IndexedBlock<number>[];
  6: IndexedBlock<bigint>[];
}

/**
 * Sort one family's ranges by start (widest first on a tie) and link each to
 * the nearest range enclosing it. CIDR blocks either nest or are disjoint, so
 * the blocks containing any address form one chain of enclosing ranges.
 */
function buildFamily<T extends number | bigint>(
  entries: { start: T; end: T; order: number; block: DropBlock }[],
): IndexedBlock<T>[] {
  entries.sort((a, b) => {
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (a.end !== b.end) return a.end > b.end ? -1 : 1;
    return a.order - b.order;
  });
  const sorted: IndexedBlock<T>[] = [];
  const orders: number[] = [];
  const open: number[] = []; // indexes of the ranges enclosing the current one
  for (const e of entries) {
    while (open.length && sorted[open[open.length - 1]].end < e.start) open.pop();
    const parent = open.length ? open[open.length - 1] : -1;
    const inherit = parent >= 0 && orders[parent] < e.order;
    sorted.push({
      start: e.start,
      end: e.end,
      parent,
      first: inherit ? sorted[parent].first : e.block,
    });
    orders.push(inherit ? orders[parent] : e.order);
    open.push(sorted.length - 1);
  }
  return sorted;
}

function buildIndex(blocks: DropBlock[]): DropIndex {
  const v4: { start: number; end: number; order: number; block: DropBlock }[] = [];
  const v6: { start: bigint; end: bigint; order: number; block: DropBlock }[] = [];
  blocks.forEach((block, order) => {
    const range = parseCidr(block.cidr);
    if (range?.family === 4) v4.push({ ...range, order, block });
    else if (range?.family === 6) v6.push({ ...range, order, block });
  });
  return { 4: buildFamily(v4), 6: buildFamily(v6) };
}

/** The first block in feed order containing `value`, by binary search. */
function lookup<T extends number | bigint>(
  sorted: IndexedBlock<T>[],
  value: T,
): DropBlock | null {
  // Last range starting at or before the address.
  let lo = 0;
  let hi = sorted.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].start <= value) {
      at = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Every range containing the address encloses that one, so the deepest
  // match is the first range up its chain that reaches the address.
  while (at >= 0 && sorted[at].end < value) at = sorted[at].parent;
  return at >= 0 ? sorted[at].first : null;
}

// Built once per feed array: the feed caches hand the same array to every
// lookup until the next download, and a parsed list is never mutated.
const indexes = new WeakMap<DropBlock[], DropIndex>();

/**
 * First DROP netblock (in feed order) that contains the IP, or null. The list
 * is parsed into sorted numeric ranges on first use, so a lookup is a binary
 * search rather than a CIDR parse per block, which bulk pass 0 depends on.
 */
export function matchDrop(ip: string, blocks: DropBlock[]): DropBlock | null {
  const addr = ipValue(ip);
  if (!addr) return null;
  let index = indexes.get(blocks);
  if (!index) {
    index = buildIndex(blocks);
    indexes.set(blocks, index);
  }
  return addr.family === 4
    ? lookup(index[4], addr.value)
    : lookup(index[6], addr.value);
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
