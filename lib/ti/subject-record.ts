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

import { cloudProvider } from "./cloud";
import { classifyIpLabel } from "./indicator-class";
import type { CheckResult, DomainCheckResult, HashCheckResult } from "./types";

export type AnyResult = CheckResult | DomainCheckResult | HashCheckResult;
export type Resolver = (r: AnyResult) => Claim | null;

/** First resolver that answers wins. Written as a reduce rather than a chain of
 *  ifs so the ladder stays one statement and S3776 stays flat however long it
 *  gets. */
export function firstClaim(resolvers: Resolver[], r: AnyResult): Claim | null {
  return resolvers.reduce<Claim | null>((hit, f) => hit ?? f(r), null);
}

const isDomain = (r: AnyResult): r is DomainCheckResult => "domain" in r;
const geoOf = (r: AnyResult) => ("ip" in r ? r.geo : undefined);
const geoResolutionOf = (r: AnyResult) => ("ip" in r ? r.geoResolution : undefined);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** True when at least one source backing a reconciled field needs no API key.
 *  A key-gated source may refine a label's wording, but it may not decide what
 *  the sprite draws: an icon that changes with the day's quota is #37 again. */
function backedByFreeSource(r: AnyResult, backers: string[] | undefined): boolean {
  return (backers ?? []).some((id) =>
    r.sources.some((s) => s.source.id === id && !s.source.requiresKey),
  );
}

/** The provider's own published prefix list, which is the only authoritative
 *  answer available. For a domain the match is against the resolved IPs, and
 *  the claim is weaker: it says the origin is hidden, not that the domain is
 *  the provider. */
const fromCloudRange: Resolver = (r) => {
  const d = ok(r.sources, "cloud-range")?.details;
  const provider = str(d?.provider);
  if (!provider) return null;
  if (isDomain(r)) return { label: `Behind ${provider}`, sources: ["cloud-range"] };
  const label = [provider, str(d?.region), str(d?.service)].filter(Boolean).join(", ");
  return { label, sources: ["cloud-range"] };
};

/** AS16509 is Amazon. A fact, and safe to put a named mark on, but only when
 *  the winning `asn` value is itself backed by a source that needs no key.
 *  `geo.asn` is not one source's field: it is the winner of a weighted
 *  reconciliation (lib/ti/geo/reconcile.ts) where key-gated providers like
 *  ipinfo/ipgeolocation outweigh free ip-api, so on a day they answer and
 *  ip-api doesn't, the "fact" this rung renders could itself be a key-gated
 *  pick, which is #37 in a different costume. When there is no
 *  `geoResolution` at all there is nothing to check provenance against, and
 *  absence of evidence is not evidence of taint, so that case is allowed
 *  through rather than gutting the rung for every caller that doesn't
 *  reconcile. */
const fromAsnTable: Resolver = (r) => {
  const geo = geoOf(r);
  const hit = cloudProvider(geo?.asn, geo?.asnOrg);
  if (hit?.via !== "asn") return null;
  const backers = geoResolutionOf(r)?.asn?.sources;
  if (backers && !backedByFreeSource(r, backers)) return null;
  return { label: hit.name, sources: ["asn table"] };
};

const fromShodanCdn: Resolver = (r) => {
  const tags = strArr(ok(r.sources, "shodan-internetdb")?.details?.tags).map((t) =>
    t.toLowerCase(),
  );
  return tags.includes("cdn")
    ? { label: "CDN edge", sources: ["shodan-internetdb"] }
    : null;
};

const fromPeeringDb: Resolver = (r) => {
  const d = ok(r.sources, "peeringdb")?.details;
  const label = [str(d?.networkClass), str(d?.peeringName)].filter(Boolean).join(", ");
  return label ? { label, sources: ["peeringdb"] } : null;
};

/** An org-name regex is an inference, so it yields the generic and never a
 *  name. See the comment on CLOUD_BY_ORG in lib/ti/cloud.ts for what a bad
 *  inference looks like. */
const fromOrgRegex: Resolver = (r) => {
  const geo = geoOf(r);
  const hit = cloudProvider(geo?.asn, geo?.asnOrg);
  return hit?.via === "org" ? { label: "Hosting", sources: ["asn org name"] } : null;
};

/** Only the hosting flag is an infrastructure claim. isProxy is a threat claim
 *  and belongs to the other ladder; mobile and residential answer "what kind of
 *  network", which is not the same question as "who runs the box". */
const fromGeoFlags: Resolver = (r) => {
  const geo = geoOf(r);
  if (!geo?.isHosting || geo.isProxy) return null;
  return { label: classifyIpLabel(geo).label, sources: ["geo flags"] };
};

const INFRA: Resolver[] = [
  fromCloudRange,
  fromAsnTable,
  fromShodanCdn,
  fromPeeringDb,
  fromOrgRegex,
  fromGeoFlags,
];

/** Who runs the box, from free, unmetered sources only. */
export function infraClaim(r: AnyResult): Claim | null {
  return firstClaim(INFRA, r);
}
