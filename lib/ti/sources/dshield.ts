import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";
import { count } from "@/lib/text";

/** One feed's window of sightings, as DShield reports it. */
interface ThreatFeed {
  firstseen?: string;
  lastseen?: string;
}

interface DShieldIp {
  number?: string;
  /** Reports to the DShield sensor network. */
  count?: number | null;
  attacks?: number | null;
  mindate?: string | null;
  maxdate?: string | null;
  asabusecontact?: string | null;
  as?: number;
  asname?: string;
  assize?: number;
  network?: string;
  threatfeeds?: Record<string, ThreatFeed>;
}

const API = "https://isc.sans.edu/api/ip";

/** ISO date, or undefined when the value is null/blank/unparseable. */
function isoDate(value: string | null | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  return Number.isNaN(Date.parse(raw)) ? undefined : raw;
}

/** The most recent sighting across every feed, plus the earliest first-seen. */
export function feedWindow(feeds: Record<string, ThreatFeed> | undefined): {
  names: string[];
  firstSeen?: string;
  lastSeen?: string;
} {
  const names: string[] = [];
  let firstSeen: string | undefined;
  let lastSeen: string | undefined;

  for (const [name, feed] of Object.entries(feeds ?? {})) {
    names.push(name);
    const first = isoDate(feed.firstseen);
    const last = isoDate(feed.lastseen);
    if (first && (!firstSeen || first < firstSeen)) firstSeen = first;
    if (last && (!lastSeen || last > lastSeen)) lastSeen = last;
  }
  return { names: names.toSorted((a, b) => a.localeCompare(b)), firstSeen, lastSeen };
}

/** Every field worth surfacing, skipping the ones DShield returns as null. */
function buildDetails(
  ip: DShieldIp,
  window: ReturnType<typeof feedWindow>,
): Record<string, unknown> | undefined {
  const entries: [string, unknown][] = [
    ["feeds", window.names.length ? window.names : undefined],
    ["feedFirstSeen", window.firstSeen],
    ["network", ip.network],
    ["asn", ip.as ? `AS${ip.as}` : undefined],
    ["asName", ip.asname],
    ["asSize", ip.assize],
    ["abuseContact", ip.asabusecontact],
    ["sensorReports", ip.count ?? undefined],
    ["sensorTargets", ip.attacks ?? undefined],
  ];
  const details = Object.fromEntries(entries.filter(([, v]) => Boolean(v)));
  return Object.keys(details).length ? details : undefined;
}

function buildSummary(
  sensorReports: number,
  window: ReturnType<typeof feedWindow>,
): string {
  const parts: string[] = [];
  if (window.names.length) {
    parts.push(`Tracked on ${count(window.names.length, "threat feed")}`);
    if (window.firstSeen && window.lastSeen) {
      parts.push(`seen ${window.firstSeen} to ${window.lastSeen}`);
    }
  }
  if (sensorReports) {
    parts.push(count(sensorReports, "DShield sensor report"));
  }
  return parts.length ? parts.join(", ") : "No DShield record";
}

/** Turn a DShield record into a finding. Exported for its test. */
export function dshieldFinding(ip: DShieldIp): SourceFinding {
  const window = feedWindow(ip.threatfeeds);

  return {
    status: "ok",
    // The dating is the point. Only a third of the sources that report
    // something adverse date their claim, which is why an age-aware score has
    // nothing to stand on (see the time-decay research issue).
    lastSeen: window.lastSeen ?? isoDate(ip.maxdate),
    summary: buildSummary(ip.count ?? 0, window),
    details: buildDetails(ip, window),
  };
}

/**
 * DShield (SANS Internet Storm Center): which public feeds have seen an
 * address, and when.
 *
 * Context only, weight 0, deliberately. The `threatfeeds` map is largely other
 * people's blocklists, several of which this app already queries directly
 * (blocklist-de among them), so scoring it would count the same evidence twice.
 * What it uniquely provides is a *date range per feed*, plus the network's
 * abuse contact and announced CIDR, none of which cost a credential.
 *
 * No API key. The published guidance is that there is no hard rate limit, but
 * a 429 means stop for five minutes, so a quota failure surfaces as a normal
 * rate_limited row rather than an error.
 */
export const dshieldSource: TiSource = {
  meta: {
    id: "dshield",
    name: "DShield (SANS ISC)",
    url: "https://isc.sans.edu",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, status, data } = await getJson<{ ip?: DShieldIp }>(
        `${API}/${encodeURIComponent(ip)}?json`,
        signal,
      );
      if (status === 429) {
        return { status: "rate_limited", error: "DShield asked us to back off" };
      }
      if (!ok || !data?.ip) {
        return { status: "error", error: `HTTP ${status}` };
      }
      return dshieldFinding(data.ip);
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
