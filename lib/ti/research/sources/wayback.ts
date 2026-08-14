import { errorMessage, getJson, isTimeout } from "../../http";
import type {
  ResearchData,
  ResearchFinding,
  ResearchProvider,
  WaybackSnapshot,
} from "../types";

/** Default number of snapshots to surface. */
const MAX_SNAPSHOTS = 8;

type WaybackData = Extract<ResearchData, { type: "wayback" }>;

/** Convert a CDX timestamp (yyyyMMddHHmmss) to ISO, or undefined if malformed. */
function cdxTimeToIso(ts: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

/** Parse a Wayback CDX response (array of [timestamp, original] rows, with a
 *  header row first). Rows arrive chronological; we surface the most recent
 *  snapshots plus the overall first/last-seen span. Pure. */
export function parseWayback(
  payload: unknown,
  limit = MAX_SNAPSHOTS,
): Omit<WaybackData, "type"> {
  if (!Array.isArray(payload) || payload.length < 2) return { snapshots: [] };

  const rows = payload.slice(1).filter((r): r is string[] => Array.isArray(r));
  if (rows.length === 0) return { snapshots: [] };

  const firstSeen = cdxTimeToIso(rows[0][0]);
  const lastSeen = cdxTimeToIso(rows.at(-1)?.[0] ?? "");

  const snapshots: WaybackSnapshot[] = [];
  for (let i = rows.length - 1; i >= 0 && snapshots.length < limit; i--) {
    const [ts, original] = rows[i];
    const time = cdxTimeToIso(ts);
    if (!time || !original) continue;
    snapshots.push({
      url: `https://web.archive.org/web/${ts}/${original}`,
      time,
    });
  }

  return { firstSeen, lastSeen, snapshots };
}

interface WaybackAvailability {
  archived_snapshots?: {
    closest?: { available?: boolean; url?: string; timestamp?: string };
  };
}

/** Lighter fallback: the availability API returns just the closest snapshot, but
 *  it stays up when the CDX index is overloaded (frequent 503s). */
async function availabilityFallback(
  indicator: string,
  signal: AbortSignal,
): Promise<ResearchFinding> {
  const { ok, data } = await getJson<WaybackAvailability>(
    `https://archive.org/wayback/available?url=${encodeURIComponent(indicator)}`,
    signal,
  );
  const closest = data?.archived_snapshots?.closest;
  if (!ok || !closest?.available || !closest.timestamp || !closest.url) {
    return { status: "empty", summary: "Not archived" };
  }
  const time = cdxTimeToIso(closest.timestamp);
  return {
    status: "ok",
    summary: "archived",
    link: `https://web.archive.org/web/*/${indicator}`,
    data: {
      type: "wayback",
      snapshots: time ? [{ url: closest.url, time }] : [],
    },
  };
}

/** Wayback Machine (Internet Archive) CDX index, no key. Shows whether and for
 *  how long a domain has been archived, with deep links to past snapshots. The
 *  CDX endpoint 503s under load, so we retry once then fall back to the
 *  lighter availability API rather than reporting a dead lane. */
export const waybackProvider: ResearchProvider = {
  meta: {
    id: "wayback",
    name: "Wayback Machine",
    url: "https://web.archive.org",
    timeoutMs: 12000,
  },
  supports: ["domain"],
  isEnabled: () => true,
  async check(indicator, _kind, signal): Promise<ResearchFinding> {
    // collapse to one capture per day keeps the response small while still
    // spanning the archive's full history.
    const url =
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(indicator)}` +
      `&output=json&fl=timestamp,original&collapse=timestamp:8&limit=200`;
    try {
      let status = 0;
      let data: unknown = null;
      // One retry: the CDX load balancer often routes the retry to a healthy node.
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await getJson<unknown>(url, signal);
        status = res.status;
        data = res.data;
        if (res.ok) break;
        if (status < 500) break; // 4xx won't fix on retry
      }

      if (status < 200 || status >= 300) {
        return availabilityFallback(indicator, signal);
      }

      const parsed = parseWayback(data);
      if (parsed.snapshots.length === 0) {
        return { status: "empty", summary: "Not archived" };
      }
      const span = parsed.firstSeen
        ? `archived since ${parsed.firstSeen.slice(0, 4)}`
        : "archived";
      return {
        status: "ok",
        summary: span,
        link: `https://web.archive.org/web/*/${indicator}`,
        data: { type: "wayback", ...parsed },
      };
    } catch (err) {
      if (isTimeout(err)) return { status: "timeout", error: errorMessage(err) };
      // A network blip on CDX: try the lighter endpoint before giving up.
      try {
        return await availabilityFallback(indicator, signal);
      } catch (fallbackErr) {
        return {
          status: isTimeout(fallbackErr) ? "timeout" : "error",
          error: errorMessage(fallbackErr),
        };
      }
    }
  },
};
