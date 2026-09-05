import { cloudProvider } from "./cloud";
import { HASH_ALGO_LABEL } from "../hash";
import { classifyDomainLabel, classifyHashLabel, classifyIpLabel } from "./indicator-class";
import { maliciousTags } from "./sources/shodan-internetdb";
import { IDENTIFIERS, threatTypeOf } from "./threat-type";
import type { CheckResult, DomainCheckResult, HashCheckResult, SourceResult } from "./types";
import type { BodyKey, MarkKey, SpriteSpec } from "./sprite";

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
  /**
   * Hash only: the multi-engine detection tally. Undefined for IP and domain,
   * and undefined on a hash when VirusTotal (key-gated, the only source that
   * sets it) did not answer. This is display text, not a sprite input: it may
   * come and go with a key or a quota without ever moving the picture, which
   * is exactly the distinction the ladders in this file exist to enforce.
   * Never promote it into a resolver rung.
   */
  detections?: { malicious: number; total: number };
  /** ISO days. */
  seen?: { first?: string; last?: string };
  sprite: SpriteSpec;
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

/** Feodo names the malware family, free and with no key. "Dridex C2" places the
 *  host far better than the bare "c2" that survives classifyCategory today. */
const fromFeodo: Resolver = (r) => {
  const hit = ok(r.sources, "feodo");
  if (!hit?.malicious) return null;
  const family = str(hit.details?.malware);
  return { label: family ? `${family} C2` : "Botnet C2", sources: ["feodo"] };
};

const fromTor: Resolver = (r) => {
  const role = str(ok(r.sources, "tor-project")?.details?.role);
  if (!role) return null;
  return {
    label: role === "exit" ? "Tor exit node" : "Tor relay",
    sources: ["tor-project"],
  };
};

const fromScannerId: Resolver = (r) => {
  const operator = str(ok(r.sources, "scanner-id")?.details?.operator);
  return operator
    ? { label: `Research scanner, ${operator}`, sources: ["scanner-id"] }
    : null;
};

/** How Shodan's own malicious-tag set reads as a sentence. The set is malware,
 *  compromised, c2, phishing, botnet, honeypot; nothing else in `tags` is a
 *  claim about the host itself. */
const SHODAN_TAG_LABEL: Record<string, string> = {
  honeypot: "Honeypot",
  c2: "Command and control",
  botnet: "Botnet node",
  compromised: "Compromised host",
  malware: "Malware host",
  phishing: "Phishing host",
};

const fromShodanThreatTags: Resolver = (r) => {
  const tags = strArr(ok(r.sources, "shodan-internetdb")?.details?.tags);
  const first = maliciousTags(tags)[0]?.toLowerCase();
  const label = first ? SHODAN_TAG_LABEL[first] : undefined;
  return label ? { label, sources: ["shodan-internetdb"] } : null;
};

/** A category the adapter emits as its own constant, so matching the string is
 *  matching the adapter, not guessing at a display name. */
function fromCategory(id: string, category: string, label: string): Resolver {
  return (r) => {
    const cats = ok(r.sources, id)?.categories ?? [];
    return cats.includes(category) ? { label, sources: [id] } : null;
  };
}

/** geo.isProxy is a reconciled flag, same story as fromAsnTable: a key-gated
 *  provider can outvote every free one in the weighted vote, so on a day only
 *  they answer, the "fact" behind Anonymizer could be a key-gated pick. That
 *  selects the anonymizer sprite body, so it moves the picture and needs the
 *  same guard. (Contrast fromGeoFlags above, which reads isHosting unguarded:
 *  under spriteFor's ordering, a bare infra claim (no named provider) no
 *  longer outranks a threat body, and when there is no threat, an infra claim
 *  and typeBody(r) both draw "hosting" for a bare IP, so the two remaining
 *  steps agree and fromGeoFlags genuinely cannot move the picture. This stops
 *  being true the day a distinct IP fallback body exists and typeBody(r) no
 *  longer returns "hosting" for every IP: at that point fromGeoFlags reaches a
 *  branch where its unguarded isHosting can pick between two different
 *  drawings, and it will need the same backedByFreeSource guard fromAsnTable
 *  and fromProxyFlag already use. That follow-up is expected; this comment is
 *  what should stop it shipping without the guard.) */
const fromProxyFlag: Resolver = (r) => {
  const geo = geoOf(r);
  if (!geo?.isProxy) return null;
  const backers = geoResolutionOf(r)?.flags?.sources?.isProxy;
  if (backers && !backedByFreeSource(r, backers)) return null;
  return { label: "Anonymizer", sources: ["geo flags"] };
};

const isHash = (r: AnyResult): r is HashCheckResult => "hash" in r;

/** Spamhaus DBL puts the human meaning of each return code straight into
 *  `categories`, so the first one is the claim. */
const fromSpamhausDbl: Resolver = (r) => {
  const label = ok(r.sources, "spamhaus-dbl")?.categories?.[0];
  if (!label) return null;
  return { label: label.charAt(0).toUpperCase() + label.slice(1), sources: ["spamhaus-dbl"] };
};

const fromCymruMhr: Resolver = (r) => {
  const hit = ok(r.sources, "cymru-mhr");
  return hit?.malicious
    ? { label: "Known malware, Team Cymru MHR", sources: ["cymru-mhr"] }
    : null;
};

/** CIRCL hashlookup answers both sides: which vendor flagged the file, and,
 *  uniquely among the free hash sources, that a file is known good. */
const fromHashlookup: Resolver = (r) => {
  const hit = ok(r.sources, "hashlookup");
  if (!hit) return null;
  if (hit.malicious) {
    const by = hit.categories?.[0];
    return {
      label: by ? `Known malicious, ${by}` : "Known malicious",
      sources: ["hashlookup"],
    };
  }
  if (hit.score === 0) {
    const origin = str(hit.details?.source);
    return {
      label: origin ? `Known legitimate file, ${origin}` : "Known legitimate file",
      sources: ["hashlookup"],
    };
  }
  return null;
};

const THREAT: Resolver[] = [
  fromFeodo,
  fromTor,
  fromScannerId,
  fromShodanThreatTags,
  fromCategory("spamhaus-drop", "criminal-netblock", "Criminal netblock"),
  fromCategory("et-open", "compromised", "Compromised host"),
  fromCategory("openphish", "phishing", "Phishing page"),
  fromSpamhausDbl,
  fromCategory("quad9", "dns-blocked", "Blocked by Quad9"),
  fromCategory("rdap", "registry-hold", "Registry hold"),
  fromCymruMhr,
  fromHashlookup,
  fromProxyFlag,
];

/** What the box is, from free, unmetered sources only. */
export function threatClaim(r: AnyResult): Claim | null {
  return firstClaim(THREAT, r);
}

/** Tranco is a positive identification for the overwhelmingly common case: a
 *  domain that nothing has anything against. */
const fromTranco: Resolver = (r) => {
  const d = ok(r.sources, "tranco")?.details;
  const rank = typeof d?.rank === "number" ? d.rank : undefined;
  return d?.vouched === true && rank !== undefined
    ? { label: `Popular domain, Tranco rank ${rank}`, sources: ["tranco"] }
    : null;
};

/**
 * What to say when no rung identified anything. Never empty: for these three
 * the absence of a finding is itself the classification.
 */
export function lastResortClaim(r: AnyResult): Claim {
  const tranco = fromTranco(r);
  if (tranco) return tranco;
  if (isDomain(r)) {
    const resolves =
      (r.context?.resolvedIps?.length ?? 0) > 0 || (r.context?.ipv6?.length ?? 0) > 0;
    return {
      label: classifyDomainLabel(r.context, resolves).label,
      sources: ["registration age"],
    };
  }
  if (isHash(r)) {
    const hasData = r.sources.some((s) => s.status === "ok" && s.score !== undefined);
    // classifyHashLabel falls all the way to "Unknown file" only when none of
    // malwareFamily, fileType, or hasData is true, i.e. when no file metadata
    // exists to be the mechanism. Naming "file metadata" as the source of a
    // claim that there is none reads backwards, so that branch gets no source
    // at all; every other branch keeps it, because there the input was real.
    const hasMetadata = Boolean(r.context?.malwareFamily || r.context?.fileType) || hasData;
    return {
      label: classifyHashLabel(r.context, hasData).label,
      sources: hasMetadata ? ["file metadata"] : [],
    };
  }
  const geo = geoOf(r);
  // Same story: classifyIpLabel(undefined) is "Unknown type", and there is no
  // geo input to call "geo flags" when there was none.
  return { label: classifyIpLabel(geo).label, sources: geo ? ["geo flags"] : [] };
}

/** Which drawn mark, if any, a provider name maps to. Anything undrawn falls
 *  through to the plain hosting body, which is the correct generic. */
const PROVIDER_MARK: Record<string, MarkKey> = {
  "Amazon Web Services": "aws",
  "Microsoft Azure": "azure",
  "Google Cloud": "gcp",
  Cloudflare: "cloudflare",
};

/** Which drawn body a threat claim maps to. Behaviour has no sprites in this
 *  set on purpose: it would only be reached when nothing identified the
 *  indicator, and drawing a guess is worse than drawing the type's own body and
 *  letting the reported-for line speak. */
const THREAT_BODY: [RegExp, BodyKey][] = [
  [/scanner/i, "scanner"],
  [/c2|command and control|botnet/i, "c2"],
  [/tor |anonymizer|proxy|vpn/i, "anonymizer"],
];

function typeBody(r: AnyResult): BodyKey {
  if (isDomain(r)) return "site";
  if (isHash(r)) return "file";
  return "hosting";
}

/**
 * Only a *named provider* outranks a threat: "an EC2 instance is more truly an
 * AWS box than a C2" holds when there is an actual AWS, but it is not an
 * argument for a generic rack outranking a positively identified scanner.
 * fromOrgRegex and fromGeoFlags fire for essentially every datacentre
 * address, and scanners, C2s and Tor exits overwhelmingly live in
 * datacentres, so a bare infra claim (no provider name) must not pre-empt a
 * threat body the way a named one does.
 */
function spriteFor(
  r: AnyResult,
  infra: Claim | null,
  threat: Claim | null,
  flagged: boolean,
): SpriteSpec {
  const provider = infra
    ? Object.keys(PROVIDER_MARK).find((p) => infra.label.includes(p))
    : undefined;
  if (provider) {
    return { body: "hosting", mark: PROVIDER_MARK[provider], flagged };
  }
  const threatBody = threat
    ? THREAT_BODY.find(([re]) => re.test(threat.label))?.[1]
    : undefined;
  if (threatBody) {
    return { body: threatBody, flagged };
  }
  return { body: infra ? "hosting" : typeBody(r), flagged };
}

function subjectOf(r: AnyResult): string {
  if (isDomain(r)) return r.domain;
  if (isHash(r)) return r.hash;
  return r.ip;
}

/**
 * The record behind the card.
 *
 * `class` prefers the threat identity, because "Dridex C2" tells an analyst
 * more than "AWS". The sprite orders the two the other way round, because it
 * answers "what is this thing" and an EC2 instance is more truly an AWS box
 * than a C2. Nothing is lost either way: whichever one the class did not take
 * is the `hostedOn` line beside it.
 */
export function buildSubjectRecord(r: AnyResult): SubjectRecord {
  const infra = infraClaim(r);
  const threat = threatClaim(r);
  const klass = threat ?? infra ?? lastResortClaim(r);
  const hostedOn = infra && infra !== klass ? infra : undefined;

  // The behaviour axis. Identification sources are filtered out so a source
  // answering "this is a scanner" cannot win the ballot about what it did.
  const behaviour = threatTypeOf(
    r.sources.filter((s) => !IDENTIFIERS.has(s.source.id)),
    { verdict: r.verdict, benignOverride: r.scoreBreakdown?.benignOverride },
  );

  const flagged = r.verdict === "malicious" || r.verdict === "suspicious";

  return {
    subject: subjectOf(r),
    qualifier: isHash(r) ? HASH_ALGO_LABEL[r.algorithm] : undefined,
    class: klass,
    hostedOn,
    reportedFor: behaviour
      ? { label: behaviour.type, sources: behaviour.sources, also: behaviour.also }
      : undefined,
    detections: isHash(r) ? r.context?.detectionRatio : undefined,
    seen: seenRange(r.sources, isHash(r) ? r.context : undefined),
    sprite: spriteFor(r, infra, threat, flagged),
  };
}
