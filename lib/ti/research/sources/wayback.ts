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

/**
 * Parse a Wayback CDX response (array of [timestamp, original] rows, with a
 * header row first).
 *
 * Rows arrive oldest-first, and this reads them newest-first, so the span it
 * reports is the span *of the rows it was given*. That distinction is the whole
 * reason the provider asks for the newest captures and the first capture
 * separately: a CDX `limit` counts from the start of the archive, so one query
 * cannot honestly answer both "when did this first appear" and "was it archived
 * recently". Pure.
 */
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

/**
 * The same snapshot, in the archive's frame mode.
 *
 * A playback URL renders with the Wayback toolbar wrapped around the page,
 * which is right for a tab and wrong for an embed. The `if_` flag is the
 * archive's own way of asking for the page alone. Returns null when the URL is
 * not a playback URL, so a caller never embeds something it did not recognise.
 */
export function archiveFrameUrl(playbackUrl: string): string | null {
  const match = /^(https:\/\/web\.archive\.org\/web\/)(\d{14})\/(.+)$/.exec(
    playbackUrl,
  );
  if (!match) return null;
  const [, base, timestamp, original] = match;
  return `${base}${timestamp}if_/${original}`;
}

interface WaybackAvailability {
  archived_snapshots?: {
    closest?: { available?: boolean; url?: string; timestamp?: string };
  };
}

/** The archive's capture nearest a given time, through the light availability
 *  API. Far faster than a CDX scan and it stays up when the CDX index is
 *  overloaded, which it frequently is. */
async function closestCapture(
  indicator: string,
  signal: AbortSignal,
  timestamp?: string,
) {
  const at = timestamp ? `&timestamp=${timestamp}` : "";
  const { ok, data } = await getJson<WaybackAvailability>(
    `https://archive.org/wayback/available?url=${encodeURIComponent(indicator)}${at}`,
    signal,
  );
  return { ok, closest: data?.archived_snapshots?.closest };
}

/**
 * Lighter fallback for when the CDX index will not answer at all.
 *
 * A refused request and an empty archive are reported differently, because they
 * are opposite facts: "Not archived" is a claim about the site, and saying it
 * when the archive simply did not answer is how a well-archived domain came
 * back looking brand new under rate limiting.
 */
async function availabilityFallback(
  indicator: string,
  signal: AbortSignal,
): Promise<ResearchFinding> {
  const { ok, closest } = await closestCapture(indicator, signal);
  if (!ok) {
    return { status: "error", error: "The archive did not answer" };
  }
  if (!closest?.available || !closest.timestamp || !closest.url) {
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

/** The CDX search, for a page of captures. A negative `limit` counts back from
 *  the newest capture; a positive one counts forward from the oldest. Exported
 *  because that sign is the whole difference between the latest snapshot and one
 *  from 2004, and it is worth a test. */
export function cdxUrl(indicator: string, limit: number, collapse: boolean): string {
  return (
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(indicator)}` +
    `&output=json&fl=timestamp,original${collapse ? "&collapse=timestamp:8" : ""}` +
    `&limit=${limit}`
  );
}

/** Before the web had much to archive, so the capture closest to it is the
 *  earliest one the archive holds for that URL. */
const START_OF_THE_WEB = "19960101";

/** How long the age query gets. It only decorates the summary, so it is capped
 *  well under the provider's budget rather than being allowed to time the
 *  snapshots out with it. */
const AGE_QUERY_MS = 5000;

/** How long the CDX index gets before the lighter endpoint takes over. Short of
 *  the provider's own budget on purpose, so there is time left to fall back.
 *  Measured against the live index: a domain answers in one to nine seconds
 *  depending on how hard the archive is being hit, and cutting it off early
 *  trades eight dated snapshots for one. */
const CDX_QUERY_MS = 10000;

/**
 * When the archive first captured this, as ISO, or undefined when that cannot
 * be read.
 *
 * Asked as "the capture closest to 1996" rather than as a CDX query with
 * `limit=1`: the CDX index has to walk the site's whole history to answer that
 * and takes 16 to 25 seconds on a well-archived domain, while this answers in
 * about one. Undefined rather than a guess when it fails, because "archived
 * since" is a claim about age and a page of recent captures cannot support it.
 */
async function firstCapture(
  indicator: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(AGE_QUERY_MS)]);
    const { ok, closest } = await closestCapture(
      indicator,
      deadline,
      START_OF_THE_WEB,
    );
    if (!ok || !closest?.available || !closest.timestamp) return undefined;
    return cdxTimeToIso(closest.timestamp);
  } catch {
    return undefined;
  }
}

/**
 * Wayback Machine (Internet Archive) CDX index, no key.
 *
 * Two small queries rather than one big one. `limit=200` counts from the
 * *oldest* capture, so a long-lived site returned its captures from 1998 to
 * 2004 and the card showed a decade-old page as its latest snapshot. The newest
 * captures come from a negative limit, and the archive's start date comes from
 * the availability API, which answers that in about a second.
 *
 * The CDX endpoint is slow and 503s under load, so it gets a slice of the
 * budget rather than all of it: it retries once, and whatever is left goes to
 * the availability API, whose one recent capture beats reporting a dead lane.
 */
export const waybackProvider: ResearchProvider = {
  meta: {
    id: "wayback",
    name: "Wayback Machine",
    url: "https://web.archive.org",
    // Room for the CDX index plus a fallback after it. This lane is off the
    // scoring path and streams in on its own, so a slower answer costs nothing
    // but a few more seconds of an animated placeholder.
    timeoutMs: 16000,
  },
  supports: ["domain"],
  isEnabled: () => true,
  async check(indicator, _kind, signal): Promise<ResearchFinding> {
    // One capture per day keeps the response small; the negative limit makes
    // those the most recent days rather than the archive's first ones.
    const url = cdxUrl(indicator, -MAX_SNAPSHOTS, true);
    try {
      // Both queries at once: the archive's start date is independent of the
      // page of recent captures, and serializing them would double the wait.
      const oldest = firstCapture(indicator, signal);

      let status = 0;
      let data: unknown = null;
      // The CDX index gets its own deadline, short of the provider's, so a slow
      // one leaves time for the fallback instead of spending the whole budget
      // and returning nothing.
      const cdxDeadline = AbortSignal.any([
        signal,
        AbortSignal.timeout(CDX_QUERY_MS),
      ]);
      try {
        // One retry: the CDX load balancer often routes it to a healthy node.
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await getJson<unknown>(url, cdxDeadline);
          status = res.status;
          data = res.data;
          if (res.ok) break;
          if (status < 500) break; // 4xx won't fix on retry
        }
      } catch (cdxErr) {
        // The provider's own budget being spent is a real timeout; the CDX
        // deadline being spent is just this index being slow again.
        if (signal.aborted) throw cdxErr;
        status = 0;
      }

      if (status < 200 || status >= 300) {
        // Awaited, not just returned: a returned promise's rejection would sail
        // straight past this function's own catch and out of the provider.
        return await availabilityFallback(indicator, signal);
      }

      const parsed = parseWayback(data);
      if (parsed.snapshots.length === 0) {
        return { status: "empty", summary: "Not archived" };
      }
      // Only the dedicated query can answer this. parsed.firstSeen is the
      // oldest row of the *recent* page, which is days old, not years, and
      // reporting it as "archived since" would be a false claim about age.
      const firstSeen = await oldest;
      const span = firstSeen
        ? `archived since ${firstSeen.slice(0, 4)}`
        : "archived";
      return {
        status: "ok",
        summary: span,
        link: `https://web.archive.org/web/*/${indicator}`,
        data: { type: "wayback", ...parsed, firstSeen },
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
