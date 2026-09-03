import type { SourceResult } from "./types";
import type { SpriteSpec } from "./sprite";

/**
 * One assertion about the indicator, plus who made it.
 *
 * `sources` holds registry source ids where a single source is responsible
 * ("feodo", "abuseipdb, otx"). Where the claim comes from merged context that
 * cannot be attributed to one row, it holds the mechanism instead ("asn table",
 * "asn org name", "geo flags"). Both render the same way, and both are honest
 * about where the sentence came from.
 */
export type Claim = { label: string; sources: string[] };

export type SubjectRecord = {
  /** The indicator, verbatim. */
  subject: string;
  /** Hash only: the algorithm, rendered as the chip beside the heading. */
  qualifier?: string;
  /** What it is. The threat identity when there is one, else the
   *  infrastructure identity, else the per-type classifier. */
  class: Claim;
  /** Who runs the box. Undefined when `class` already carries it, so the same
   *  fact never renders on two rows. */
  hostedOn?: Claim;
  /** What it did, as reported. */
  reportedFor?: Claim & { also: string[] };
  /** ISO days. */
  seen?: { first?: string; last?: string };
  sprite: SpriteSpec;
  footer: string;
};

/** A settled, successful row for a given source id. A timed-out or errored
 *  source must not back a claim, which is why the status is checked here rather
 *  than at each call site. */
export function ok(sources: SourceResult[], id: string): SourceResult | undefined {
  return sources.find((s) => s.source.id === id && s.status === "ok");
}

const ZONELESS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;

/**
 * Milliseconds for one of the timestamp shapes the sources emit, or undefined.
 *
 * A zone-less "YYYY-MM-DD HH:MM:SS" is read as UTC. `Date.parse` reads it as
 * local, which is how the Onionoo timestamp shifts by the deployment's offset
 * with nothing failing and nothing logging. #60 gives `lastSeen` a format
 * contract and a home in lib/ti/canon/; move this there when that lands.
 */
export function parseSeen(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\s+UTC$/i, "");
  const normalized = ZONELESS.test(trimmed) ? `${trimmed.replace(" ", "T")}Z` : trimmed;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) return undefined;
  const year = new Date(ms).getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return undefined;
  return ms;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The two `details` keys that carry a first-seen. No source puts one on the
 *  finding itself: `SourceFinding` has `lastSeen` and no sibling. */
const FIRST_SEEN_KEYS = ["firstSeen", "feedFirstSeen"] as const;

/** Earliest first-seen and latest last-seen across everything that answered. */
export function seenRange(
  sources: SourceResult[],
  ctx?: { firstSeen?: string; lastSeen?: string },
): { first?: string; last?: string } | undefined {
  const settled = sources.filter((s) => s.status === "ok");

  const firsts = [
    parseSeen(ctx?.firstSeen),
    ...settled.flatMap((s) =>
      FIRST_SEEN_KEYS.map((k) => {
        const v = s.details?.[k];
        return typeof v === "string" ? parseSeen(v) : undefined;
      }),
    ),
  ].filter((n): n is number => n !== undefined);

  const lasts = [
    parseSeen(ctx?.lastSeen),
    ...settled.map((s) => parseSeen(s.lastSeen)),
  ].filter((n): n is number => n !== undefined);

  if (!firsts.length && !lasts.length) return undefined;
  return {
    first: firsts.length ? isoDay(Math.min(...firsts)) : undefined,
    last: lasts.length ? isoDay(Math.max(...lasts)) : undefined,
  };
}
