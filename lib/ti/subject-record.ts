import { cloudProvider } from "./cloud";
import { fileFormatOf } from "./file-format";
import { HASH_ALGO_LABEL } from "../hash";
import { parseDomain } from "../domain";
import {
  classifyDomainLabel,
  classifyHashLabel,
  classifyIpLabel,
  contentCategory,
  domainEvidence,
  hashEvidence,
  ipEvidence,
} from "./indicator-class";
import { maliciousTags } from "./sources/shodan-internetdb";
import { IDENTIFIERS, threatTypeOf } from "./threat-type";
import type { ThreatTypeVerdict } from "./threat-type";
import type { CheckResult, DomainCheckResult, HashCheckResult, SourceResult } from "./types";
import { moodFor, seedOf, type BodyKey, type SpriteSpec } from "./sprite";

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

/** The country the geo providers voted for. `dissent` is populated only when
 *  the vote actually split; see the counting rule in the design doc. */
export type Origin = Claim & {
  dissent?: { value: string; sources: string[] }[];
  /** ISO 3166-1 alpha-2, when a provider gave one, for rendering the flag. */
  countryCode?: string;
};

export type SubjectRecord = {
  /** The indicator, verbatim. */
  subject: string;
  /** Hash only: the algorithm, rendered as the chip beside the heading. */
  qualifier?: string;
  /** What it is. The threat identity when there is one, else the
   *  infrastructure identity, else the per-type classifier. */
  class: Claim;
  /** The country the geo providers voted for. IP only: the domain pipeline
   *  fetches no geo, and a hash has no origin by nature. */
  origin?: Origin;
  /** Who runs the box. Undefined when `class` already carries it, so the same
   *  fact never renders on two rows. */
  hostedOn?: Claim;
  /** What the subject is charged with: counted priors, not an elected label.
   *  Always present — rung 4 of `priorsOf` answers "No record" when nothing
   *  else does. */
  priors: Claim & { also: string[] };
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
function ok(sources: SourceResult[], id: string): SourceResult | undefined {
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
  const trimmed = value.trim().replace(/utc$/i, "").trimEnd();
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
type Resolver = (r: AnyResult) => Claim | null;

/** First resolver that answers wins. Written as a reduce rather than a chain of
 *  ifs so the ladder stays one statement and S3776 stays flat however long it
 *  gets. */
function firstClaim(resolvers: Resolver[], r: AnyResult): Claim | null {
  return resolvers.reduce<Claim | null>((hit, f) => hit ?? f(r), null);
}

const isDomain = (r: AnyResult): r is DomainCheckResult => "domain" in r;
const geoOf = (r: AnyResult) => ("ip" in r ? r.geo : undefined);
const geoResolutionOf = (r: AnyResult) =>
  "ip" in r || isDomain(r) ? r.geoResolution : undefined;
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
 *  network", which is not the same question as "who runs the box".
 *
 *  isHosting is guarded the same way fromAsnTable and fromProxyFlag already
 *  are: it is a reconciled field where a key-gated provider can outvote every
 *  free one, and now that typeBody(r) draws a different sprite for hosting
 *  vs. mobile/residential/unknown, an unguarded isHosting could swing the
 *  picture on a day only a paid source answered. Before the IP fallback
 *  bodies existed this could not happen: infra claim and typeBody(r) both
 *  drew "hosting" regardless of which source won, so the two always agreed. */
const fromGeoFlags: Resolver = (r) => {
  const geo = geoOf(r);
  if (!geo?.isHosting || geo.isProxy) return null;
  const backers = geoResolutionOf(r)?.flags?.sources?.isHosting;
  if (backers && !backedByFreeSource(r, backers)) return null;
  // The generic, spelled out rather than fetched from classifyIpLabel.
  // Guarded as it is, that call could only ever return this one label, and once
  // the classifier grew rungs like "Front door" and "Single host" the borrowed
  // answer would have started answering a different question: this ladder asks
  // who runs the box, not how much of an identity the address has.
  return { label: "Hosting / Datacenter", sources: ["geo flags"] };
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
 *  same guard. */
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
 * What kind of site Cloudflare says this is.
 *
 * Deliberately resolved here rather than in `infraClaim`: this is a key-gated
 * source, and `infraClaim` is one of the two inputs to `spriteFor`, so a claim
 * added there would change the drawn body depending on whether a token was set
 * that day. That is #37 in a new costume. `lastResortClaim` only ever feeds the
 * class label, which is text, and a key-gated source refining wording is
 * allowed where deciding the picture is not.
 *
 * It outranks both Tranco and the infrastructure claim because a category
 * answers what a site is, where a rank answers only how busy it is and a CDN
 * answers only where it sits.
 */
/** Not `primaryCategory`, which is Cloudflare's own field and is not the
 *  primary *content* category: for pornhub.com it is "CIPA Filter", a US
 *  school-filtering statute, and this claim printed "This is a CIPA Filter
 *  site". The category list, with the filter taxonomy dropped, answers what the
 *  site is. */
const fromCloudflareCategory: Resolver = (r) => {
  const details = ok(r.sources, "cloudflare-intel")?.details;
  const category =
    contentCategory(strArr(details?.categories)) ??
    contentCategory([str(details?.primaryCategory) ?? ""]);
  return category ? { label: `${category} site`, sources: ["cloudflare-intel"] } : null;
};

/**
 * What to say when no rung identified anything. Never empty: for these three
 * the absence of a finding is itself the classification.
 */
/** What kind of threat a file's flagging sources describe, for the class
 *  headline. Exported so the hero can ask the same question the record does and
 *  get the same answer, rather than each running its own tally. */
export function fileThreat(r: HashCheckResult): string | undefined {
  return threatTypeOf(r.sources, {
    verdict: r.verdict,
    benignOverride: r.scoreBreakdown?.benignOverride,
  })?.type;
}

export function lastResortClaim(r: AnyResult): Claim {
  const tranco = fromTranco(r);
  if (tranco) return tranco;
  // All three classifiers now name the mechanism themselves, rather than the
  // call site asserting one. That mattered most here: "registration age" was
  // hardcoded for every domain, including the ones whose class was settled by
  // DNS returning nothing or by the name sitting under a free-subdomain
  // service, neither of which is a registration date.
  if (isDomain(r)) {
    const domain = classifyDomainLabel(
      domainEvidence(r.domain, parseDomain(r.domain)?.registrable, r.context, r.sources),
    );
    return { label: domain.label, sources: domain.sources };
  }
  if (isHash(r)) {
    const file = classifyHashLabel(hashEvidence(r.context, r.sources, fileThreat(r)));
    return { label: file.label, sources: file.sources };
  }
  // Same story: with nothing to read, classifyIpLabel is "Unknown type" and
  // returns no sources, because there was no input to name as the mechanism.
  // Every other rung names what decided it, which is why the list comes back
  // from the classifier now instead of being assumed to be the geo flags.
  const ip = classifyIpLabel(ipEvidence(geoOf(r), r.sources));
  return { label: ip.label, sources: ip.sources };
}

/** Provider names specific enough to count as a *named* box, as opposed to a
 *  bare "Hosting" inference. Only these outrank a positively identified
 *  threat body; see the comment on spriteFor. */
const NAMED_PROVIDERS = ["Amazon Web Services", "Microsoft Azure", "Google Cloud", "Cloudflare"];

/** Which drawn body a threat claim maps to. Behaviour has no sprites in this
 *  set on purpose: it would only be reached when nothing identified the
 *  indicator, and drawing a guess is worse than drawing the type's own body and
 *  letting the reported-for line speak.
 *
 *  Every label tested here comes out of the THREAT ladder, whose resolvers read
 *  only sources that need no key (fromProxyFlag is guarded where it reads a
 *  reconciled flag), so no key or quota can move these bodies. Ordered, first
 *  hit wins: ransomware before malware because it is the more specific claim,
 *  and the three network bodies first because "Botnet C2 domain" is a C2 that
 *  happens to be a domain, not a malware host. "Known malicious" is hashlookup
 *  naming a curated feed that flagged the file; a file someone flagged is
 *  malware, and matching on that phrase keeps the vendor name it carries (which
 *  can itself contain "malware") from deciding anything. */
const THREAT_BODY: [RegExp, BodyKey][] = [
  [/scanner/i, "scanner"],
  [/c2|command and control|botnet/i, "c2"],
  [/tor |anonymizer|proxy|vpn/i, "anonymizer"],
  [/ransomware/i, "ransomware"],
  [/phishing/i, "phishing"],
  [/\bspam/i, "spam"],
  [/\bmalware\b|trojan|stealer|backdoor|known malicious/i, "malware"],
];

/** classifyIpLabel's labels, mapped onto their sprite body. The hosting-shaped
 *  ones and "Anonymizer" fall through to the default: spriteFor only reaches
 *  typeBody(r) once infra and threatBody are both null, and infra already
 *  includes fromGeoFlags (isHosting), so a genuine hosting IP would have
 *  produced an infra claim before this ever runs. A proxy/VPN/Tor IP works the
 *  same way through fromProxyFlag's threat claim. Both are still handled here
 *  rather than assumed unreachable, since either resolver can decline for its
 *  own reasons (an unguarded key-gated source, a missing free backer) and leave
 *  classifyIpLabel as the only thing that answered.
 *
 *  "Front door" shares the hosting golem for now, which understates it: it is
 *  the one class whose meaning inverts, a wall with tenants behind it rather
 *  than a box that might be hostile, and it wants a body of its own. That is
 *  more than a line here, because the sprite has its own resolver chain and
 *  this switch is only its last resort; a front door has to enter the infra
 *  claim ladder to be drawn reliably. */
function ipFallbackBody(r: AnyResult): BodyKey {
  switch (classifyIpLabel(ipEvidence(geoOf(r), r.sources)).label) {
    case "Anonymizer":
      return "anonymizer";
    case "Mobile network":
      return "mobile";
    // An organisation's egress is an end-user network wearing a company name,
    // so it belongs with the consumer line rather than with the datacentre.
    case "Corporate network":
    case "Residential / Other":
      return "residential";
    case "Unknown type":
      return "unknown";
    default:
      return "hosting";
  }
}

/** `ok`, narrowed to sources that need no key. The identity bodies below read
 *  a source's own context rather than the merged `r.context`, because the
 *  merge is first-non-empty across every source and a key-gated one (domain
 *  VirusTotal sets resolvedIps and mx, file VirusTotal sets fileType) can be
 *  the one that filled a field; that would make the body depend on the key. */
function free(sources: SourceResult[], id: string): SourceResult | undefined {
  const hit = ok(sources, id);
  return hit && !hit.source.requiresKey ? hit : undefined;
}

type DomainSignals = {
  dns?: DomainCheckResult["context"];
  ageDays?: number;
  vouched: boolean;
};

/**
 * Domain identity, first hit wins. A name that does not exist is a husk
 * whatever else is true of it: its age and rank describe something that is no
 * longer there. A name days old is a hatchling even if it already serves mail
 * or has a rank, because newness is the more actionable fact. Mail-only before
 * popularity because a Tranco-ranked name with no A/AAAA is rare and, when it
 * happens, "this only receives mail" says more about it than its rank.
 *
 * Inputs: DNS (`dns`), RDAP (`rdap`), Tranco (`tranco`), all key-free, each
 * read through `free` so a future key-gated rename cannot slip in.
 */
const DOMAIN_IDENTITY: [(d: DomainSignals) => boolean, BodyKey][] = [
  [(d) => d.dns?.nxdomain === true, "husk"],
  [(d) => d.ageDays !== undefined && d.ageDays < 30, "hatchling"],
  [
    (d) => !d.dns?.resolvedIps?.length && !d.dns?.ipv6?.length && Boolean(d.dns?.mx?.length),
    "courier",
  ],
  [(d) => d.vouched, "landmark"],
];

function domainBody(r: DomainCheckResult): BodyKey {
  const signals: DomainSignals = {
    dns: free(r.sources, "dns")?.domainContext,
    ageDays: free(r.sources, "rdap")?.domainContext?.ageDays,
    vouched: free(r.sources, "tranco")?.details?.vouched === true,
  };
  return DOMAIN_IDENTITY.find(([test]) => test(signals))?.[1] ?? "site";
}

/** File identity from what key-free sources said about the file: today that is
 *  Maltiverse's fileType and names, and hashlookup's NSRL file name. The
 *  formats VirusTotal, MalwareBazaar, Hybrid Analysis and Kaspersky report are
 *  better and more often present, and deliberately not read: the body would
 *  then change with the key, and the format still shows in the record text. */
function fileBody(r: HashCheckResult): BodyKey {
  const contexts = r.sources.flatMap((s) =>
    s.status === "ok" && !s.source.requiresKey && s.hashContext ? [s.hashContext] : [],
  );
  const format = fileFormatOf({
    descriptions: contexts.flatMap((c) =>
      [c.fileType, c.mimeType, c.magic].filter((v): v is string => Boolean(v)),
    ),
    names: contexts.flatMap((c) =>
      [c.fileName, ...(c.fileNames ?? [])].filter((v): v is string => Boolean(v)),
    ),
  });
  return format ?? "file";
}

function typeBody(r: AnyResult): BodyKey {
  if (isDomain(r)) return domainBody(r);
  if (isHash(r)) return fileBody(r);
  return ipFallbackBody(r);
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
  const seed = seedOf(subjectOf(r));
  const mood = moodFor(r.verdict);
  // A domain's infra claim is "Behind Cloudflare": where it is hosted, not
  // what it is, and true of most names on the web. Letting it draw the hosting
  // golem would put a rack on nearly every domain and leave the domain bodies
  // unreachable, so the infra rungs of this ladder are an IP's alone.
  const ipInfra = "ip" in r ? infra : null;
  const namedProvider = ipInfra
    ? NAMED_PROVIDERS.some((p) => ipInfra.label.includes(p))
    : false;
  if (namedProvider) {
    return { body: "hosting", flagged, mood, seed };
  }
  const threatBody = threat
    ? THREAT_BODY.find(([re]) => re.test(threat.label))?.[1]
    : undefined;
  if (threatBody) {
    return { body: threatBody, flagged, mood, seed };
  }
  return { body: ipInfra ? "hosting" : typeBody(r), flagged, mood, seed };
}

/**
 * The country the geo providers voted for. Reads the reconciled vote
 * (`geoResolution.country`) when one exists, falling back to a single IP
 * provider's raw `geo.country` when the caller never reconciled. On a
 * domain, the reconciled vote is dnsGeoSource's cross-IP vote (see
 * lib/ti/geo/vote-ips.ts) rather than a per-provider one, but it is the same
 * `GeoResolution` shape, so everything below reads it identically. A hash has
 * no origin by nature; `geoResolutionOf`/`geoOf` returning undefined for it
 * already makes this undefined too.
 */
export function originOf(r: AnyResult): Origin | undefined {
  const resolution = geoResolutionOf(r);
  const country = resolution?.country;
  if (country) {
    const code = resolution?.countryCode;
    const city = resolution?.city?.value;
    const label = [code ? `${country.value} (${code})` : country.value, city]
      .filter(Boolean)
      .join(", ");
    return {
      label,
      sources: country.sources,
      dissent: country.alternatives?.length
        ? country.alternatives.map((a) => ({ value: a.value, sources: a.sources }))
        : undefined,
      countryCode: code,
    };
  }
  const geo = geoOf(r);
  if (!geo?.country) return undefined;
  const label = [geo.countryCode ? `${geo.country} (${geo.countryCode})` : geo.country, geo.city]
    .filter(Boolean)
    .join(", ");
  return { label, sources: [], countryCode: geo.countryCode };
}

type ReportCategory = { name: string; count: number };

/** AbuseIPDB's own named report-reason tally, count descending (already
 *  sorted by categoryBreakdown in lib/ti/sources/abuseipdb.ts) — never the
 *  `categories` array a `tor` tag can slip into. */
function reportCategoriesOf(details: Record<string, unknown> | undefined): ReportCategory[] {
  const raw = details?.reportCategories;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is ReportCategory =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as ReportCategory).name === "string" &&
      typeof (c as ReportCategory).count === "number",
  );
}

/**
 * Rung 1: counted charges. The report total leads the label rather than
 * living in the provenance line, which is a bare list of source ids
 * everywhere else in this file. The three shown counts do not have to sum to
 * the total (one report can carry several categories), so "led by", not
 * "for": these are the largest buckets, not claimed to be all of them.
 */
function fromAbuseReports(r: AnyResult): (Claim & { also: string[] }) | null {
  const hit = ok(r.sources, "abuseipdb");
  const total = hit?.details?.totalReports;
  const cats = reportCategoriesOf(hit?.details);
  if (typeof total !== "number" || cats.length === 0) return null;
  // AbuseIPDB's own category names hyphenate ("Brute-Force"); every other
  // label on this card reads as natural prose, so the hyphen is normalized to
  // a space alongside the lowercasing, not just lowercased in place.
  const top = cats
    .slice(0, 3)
    .map((c) => `${c.name.toLowerCase().replace(/-/g, " ")} (${c.count})`);
  return { label: `${total} reports, led by ${top.join(", ")}`, sources: ["abuseipdb"], also: [] };
}

/** Rung 2: the existing behaviour ballot, unchanged. Capitalized here, once,
 *  rather than with a CSS transform in record.tsx: a per-word CSS capitalize
 *  would wrongly title-case rung 1 and rung 3's multi-word sentences too, and
 *  this is the only rung whose label was ever a bare lowercase enum value. */
function fromBehaviour(behaviour: ThreatTypeVerdict | null): (Claim & { also: string[] }) | null {
  if (!behaviour) return null;
  const label = behaviour.type.charAt(0).toUpperCase() + behaviour.type.slice(1);
  return { label, sources: behaviour.sources, also: behaviour.also };
}

/**
 * Rung 3: flagged with no charges. Names who flagged it rather than leaving
 * the row silent under a malicious/suspicious verdict. Only VirusTotal gets a
 * vendor-count parenthetical, since it is the one source whose `details`
 * shape this file already reads elsewhere (`maliciousVendors`/
 * `totalVendors`); every other flooring/dominant source is still named, just
 * without a count this function has no generic way to read.
 */
function fromFloorOrDominant(r: AnyResult): (Claim & { also: string[] }) | null {
  if (r.verdict !== "malicious" && r.verdict !== "suspicious") return null;
  const sb = r.scoreBreakdown;
  const sourceId = sb?.flooredBy ?? sb?.dominantSourceId;
  if (!sourceId) return null;
  const hit = ok(r.sources, sourceId);
  if (!hit) return null;
  const name = hit.source.name;
  if (sourceId === "virustotal") {
    const malicious = hit.details?.maliciousVendors;
    const total = hit.details?.totalVendors;
    if (typeof malicious === "number" && typeof total === "number") {
      return {
        label: `Flagged by ${name} (${malicious} of ${total} vendors)`,
        sources: [sourceId],
        also: [],
      };
    }
  }
  return { label: `Flagged by ${name}`, sources: [sourceId], also: [] };
}

/**
 * Rung 4: no charges, nothing flagged. Names the voucher when one cleared it
 * (Tranco rank, hashlookup known-good), unless `klass` already carries that
 * same fact: a Tranco-vouched popular domain already says so in `CLASS`
 * (`lastResortClaim`'s `fromTranco`), and citing it again here would repeat a
 * row rather than add one — the same failure mode `hostedOn` already guards
 * against for `class`.
 */
function fromNoRecord(r: AnyResult, klass: Claim): Claim & { also: string[] } {
  if (!klass.sources.includes("tranco")) {
    const tranco = ok(r.sources, "tranco");
    const rank = tranco?.details?.rank;
    if (tranco?.details?.vouched === true && typeof rank === "number") {
      return { label: `No record, vouched by Tranco (rank ${rank})`, sources: ["tranco"], also: [] };
    }
  }
  if (!klass.sources.includes("hashlookup")) {
    const hashlookup = ok(r.sources, "hashlookup");
    if (hashlookup && hashlookup.malicious !== true && hashlookup.score === 0) {
      return { label: "No record, vouched by hashlookup", sources: ["hashlookup"], also: [] };
    }
  }
  return { label: "No record", sources: [], also: [] };
}

/**
 * What the subject is charged with, counted rather than elected. A rap sheet
 * lists charges; it does not pick one word to summarise a person, which is
 * what the single-winner ballot in threatTypeOf did when a stray "tor"
 * category (emitted by non-identifier sources like virustotal and abuseipdb)
 * out-voted 148 real abuse reports on 185.220.101.42. This routes around that
 * bug rather than fixing threatTypeOf itself, which verdict.tsx still calls
 * unfiltered for the headline. Never returns null: rung 4 always answers.
 */
export function priorsOf(
  r: AnyResult,
  behaviour: ThreatTypeVerdict | null,
  klass: Claim,
): Claim & { also: string[] } {
  return (
    fromAbuseReports(r) ?? fromBehaviour(behaviour) ?? fromFloorOrDominant(r) ?? fromNoRecord(r, klass)
  );
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
  // Cloudflare's category sits between the threat and the infrastructure claim
  // on purpose. "Behind Microsoft Azure" is where a site is hosted, not what it
  // is, and on the modern web nearly every name is behind something, so an
  // infra claim would otherwise win for almost all of them. `spriteFor` is
  // still handed `infra`, so the drawn body does not move with the token, and
  // whichever claim the class does not take becomes the `hostedOn` line.
  const klass = threat ?? fromCloudflareCategory(r) ?? infra ?? lastResortClaim(r);
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
    origin: originOf(r),
    hostedOn,
    priors: priorsOf(r, behaviour, klass),
    detections: isHash(r) ? r.context?.detectionRatio : undefined,
    seen: seenRange(r.sources, isHash(r) ? r.context : undefined),
    sprite: spriteFor(r, infra, threat, flagged),
  };
}
