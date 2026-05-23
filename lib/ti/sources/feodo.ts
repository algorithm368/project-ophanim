import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface FeodoEntry {
  ip_address: string;
  port?: number;
  status?: string;
  hostname?: string | null;
  as_number?: number;
  as_name?: string;
  country?: string;
  first_seen?: string;
  last_online?: string;
  malware?: string;
}

const FEED_URL = "https://feodotracker.abuse.ch/downloads/ipblocklist.json";
const TTL_MS = 60 * 60 * 1000; // 1 hour

interface Cache {
  byIp: Map<string, FeodoEntry>;
  fetchedAt: number;
}

let cache: Cache | null = null;
let inflight: Promise<Cache> | null = null;

async function loadFeed(signal: AbortSignal): Promise<Cache> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const { ok, status, data } = await getJson<FeodoEntry[]>(FEED_URL, signal);
    if (!ok || !Array.isArray(data)) {
      throw new Error(`feed unavailable (HTTP ${status})`);
    }
    const byIp = new Map<string, FeodoEntry>();
    for (const entry of data) {
      if (entry.ip_address) byIp.set(entry.ip_address, entry);
    }
    cache = { byIp, fetchedAt: Date.now() };
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Feodo Tracker (abuse.ch) — known botnet C2 IPs (no key, downloadable feed). */
export const feodoSource: TiSource = {
  meta: {
    id: "feodo",
    name: "Feodo Tracker",
    url: "https://feodotracker.abuse.ch",
    category: "blocklist",
    requiresKey: false,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { byIp } = await loadFeed(signal);
      const hit = byIp.get(ip);
      if (!hit) {
        return {
          status: "ok",
          score: 0,
          summary: "Not a known botnet C2",
        };
      }
      return {
        status: "ok",
        malicious: true,
        score: 95,
        categories: ["botnet-c2", hit.malware ?? "malware"].filter(Boolean),
        lastSeen: hit.last_online,
        summary: `Known ${hit.malware ?? "malware"} C2 (status: ${hit.status ?? "unknown"})`,
        details: {
          malware: hit.malware,
          port: hit.port,
          status: hit.status,
          firstSeen: hit.first_seen,
          lastOnline: hit.last_online,
          asNumber: hit.as_number,
          asName: hit.as_name,
          country: hit.country,
        },
        raw: hit,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
