import { getDomain } from "tldts";
import { getJson, getText } from "../http";
import { sharedLoader } from "../shared-feed";
import type { SourceFinding } from "../types";

const LATEST = "https://tranco-list.eu/api/lists/date/latest";
const TOP_N = 1000; // VOUCH_RANK: exactly the set that can vouch
const TTL_MS = 24 * 60 * 60 * 1000;

/** Popular registrable domains whose subdomains belong to customers, which the
 *  Public Suffix List's private section does not cover (checked 2026-10-07).
 *  Both appear in a real IOC file: adsninjacdn.b-cdn.net, *.tencent-cloud.net. */
export const SHARED_HOSTING: readonly string[] = ["b-cdn.net", "tencent-cloud.net"];

function sharedHosting(): string[] {
  const extra = (process.env.TI_SHARED_HOSTING_SUFFIXES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...SHARED_HOSTING, ...extra];
}

export function parseTrancoCsv(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const [rank, domain] = line.split(",");
    const n = Number(rank);
    if (domain && Number.isInteger(n) && n > 0) out.set(domain.trim().toLowerCase(), n);
  }
  return out;
}

/** The registrable parent, or null when the host is its own registrable domain
 *  or sits under shared hosting, where a parent's popularity says nothing. */
export function parentDomain(host: string): string | null {
  const parent = getDomain(host, { allowPrivateDomains: true });
  if (!parent || parent === host) return null;
  return sharedHosting().includes(parent) ? null : parent;
}

let cache: { top: Map<string, number>; fetchedAt: number } | null = null;

const download = sharedLoader(async (signal) => {
  const latest = await getJson<{ list_id?: string }>(LATEST, signal);
  if (!latest.ok || !latest.data?.list_id) {
    throw new Error(`Tranco list id unavailable (HTTP ${latest.status})`);
  }
  const csv = await getText(`https://tranco-list.eu/download/${latest.data.list_id}/${TOP_N}`, signal);
  if (!csv.ok || !csv.text) throw new Error(`Tranco list unavailable (HTTP ${csv.status})`);
  cache = { top: parseTrancoCsv(csv.text), fetchedAt: Date.now() };
  return cache;
});

export async function loadTopList(signal: AbortSignal): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.top;
  return (await download(signal)).top;
}

/** The bulk lane's answer. An exact hit is the vouch /check would give; a
 *  parent hit is bucketing only and deliberately not `allowlisted`. */
export function bulkTrancoFinding(domain: string, top: Map<string, number>): SourceFinding {
  const exact = top.get(domain);
  if (exact !== undefined) {
    // Field for field what trancoFinding() returns for a vouched rank, so the
    // accuracy invariant holds between the two lanes.
    return {
      status: "ok",
      score: 0,
      allowlisted: true,
      categories: ["popular-domain"],
      summary: `Tranco rank ${exact.toLocaleString("en-US")}, a top-ranked domain`,
      details: { rank: exact, vouched: true },
    };
  }
  const parent = parentDomain(domain);
  const rank = parent ? top.get(parent) : undefined;
  if (parent && rank !== undefined) {
    return { status: "ok", summary: `Under ${parent}, Tranco rank ${rank}`, details: { parentVouch: { parent, rank } } };
  }
  return { status: "ok", summary: "Not in the Tranco top 1,000" };
}
