import { cpeLabel } from "@/lib/cpe";
import { classifyIpLabel, contentCategory, ipEvidence } from "./indicator-class";
import { formatBytes } from "./narrative";
import { PORT_SERVICE, shodanHostInfo } from "./shodan";
import { buildSubjectRecord, type AnyResult } from "./subject-record";
import { isDomainResult, isHashResult } from "./types";
import type { CheckResult, DomainCheckResult, HashCheckResult, SourceResult } from "./types";

/**
 * The subject record: a dex entry for the thing itself.
 *
 * Its job is orientation, not judgement. The panel above has already said how
 * bad this is and how sure it is; a reader who scrolls here has accepted that
 * and wants to know what the thing actually is. Four rules follow, and each was
 * decided against a built version that did the opposite:
 *
 *  - **One fixed order, no groups.** The same fields in the same places on
 *    every lookup, so the eye learns where each fact lives and stops reading
 *    labels. Grouping by aspect and grouping by who said it were both tried and
 *    both cost more than they returned.
 *  - **Every field, every time.** A field with nothing behind it prints
 *    `none published` rather than vanishing. A host with no reverse name and no
 *    operator entry is telling you something, and a card that silently skipped
 *    those rows made it look like nobody had asked. It is also what keeps the
 *    order fixed, which is the whole point of a fixed order.
 *  - **No provenance.** Nothing marks which facts the subject published about
 *    itself. That distinction is a trust device, and trust is the panel's job.
 *  - **No behaviour.** Listings, reports, feed history and reputation trend are
 *    the panel's, and they have their own section below this one. This card says
 *    what the thing is and nothing about what it did.
 *
 * Every value is a fragment, never a sentence: the label already names the
 * field, so a value that repeats it back is words the eye must walk past to
 * reach the fact. Lists print in full, because there is no fold to hide a tail
 * in any more.
 */

export type IdentityClaim = {
  /** Stable id, for keys and tests. */
  key: string;
  /** The field name ("Name", "Country"). */
  label: string;
  /** The value, as a fragment, or `none published`. */
  value: string;
  /** ISO 3166-1 alpha-2, when the row should carry a flag. */
  countryCode?: string;
  /** A contradiction, a disownment, or a name on its way out of existence.
   *  Drawn heavier, never coloured: sources disagree about Google's city too. */
  notable?: boolean;
  /** Nothing was published for this field. Drawn quiet, so an absence reads as
   *  an absence rather than as a value. */
  absent?: boolean;
};

/**
 * One of the four headline facts, set large above the ledger.
 *
 * A vital is a *position*, not a row: the eye is meant to land on the third
 * cell for the network without reading the label, which only works if the four
 * slots never move and never disappear. A slot with nothing behind it therefore
 * says so in its own words, rather than yielding its place to the next one.
 */
export type Vital = {
  key: string;
  /** The slot name ("Country", "Type"). Fixed per IOC type. */
  label: string;
  /** The headline, two or three words. */
  value: string;
  /** The one line that qualifies it. */
  sub?: string;
  /** ISO 3166-1 alpha-2, when the slot should carry a flag. */
  countryCode?: string;
  /** Nothing was measured for this slot, so `value` is the absence. */
  absent?: boolean;
};

export type IdentityRecord = {
  /** What the thing is, e.g. "Tor exit node". The header states it. */
  kind: string;
  /** Exactly four, in a fixed order per IOC type. */
  vitals: Vital[];
  /** The fixed list, in order. Every field is present on every lookup. */
  fields: IdentityClaim[];
};

const NONE = "none published";

/** One row. An empty value becomes the absence, which is itself a fact. */
function f(
  key: string,
  label: string,
  value: string | undefined | false,
  extra: Omit<IdentityClaim, "key" | "label" | "value"> = {},
): IdentityClaim {
  return value ? { key, label, value, ...extra } : { key, label, value: NONE, absent: true };
}

const ok = (sources: SourceResult[], id: string): SourceResult | undefined =>
  sources.find((s) => s.source.id === id && s.status === "ok");

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Comma-joined and deduped, in full: there is no fold to hide the tail in. */
const list = (values: string[]): string => [...new Set(values.filter(Boolean))].join(", ");

/** Drop the empties and join what is left with commas, so a missing part
 *  shortens a value instead of leaving a dangling separator. */
const parts = (...values: (string | undefined | false)[]): string =>
  values.filter((v): v is string => Boolean(v)).join(", ");

const day = (iso: string | undefined): string | undefined => iso?.slice(0, 10);

/**
 * An ISO 3166-1 alpha-2 code as the country's name.
 *
 * The registry files a code and nothing else, and a row reading "AD" asks the
 * reader to know that AD is Andorra, which is the failure mode this card was
 * rebuilt to avoid. `Intl.DisplayNames` ships with the runtime, so this costs
 * no dependency and no table to maintain; the fallback covers a malformed code
 * rather than a missing API.
 */
export function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Cloudflare's application names carry operational suffixes meant for its own
 *  product, e.g. "GitHub (Do Not Inspect)", which is an instruction to a TLS
 *  proxy and not part of the name. */
export function cleanAppName(name: string | undefined): string | undefined {
  const trimmed = name?.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return trimmed || undefined;
}

/** The issuer names out of a CAA record set. A CAA line reads
 *  `0 issue "letsencrypt.org"`, and only the quoted authority is worth showing. */
export function caaIssuers(caa: string[]): string[] {
  return caa
    .map((line) => /"([^"]+)"/.exec(line)?.[1] ?? line.split(/\s+/).at(-1) ?? "")
    .map((v) => v.replace(/^;$/, "").trim())
    .filter(Boolean);
}

/** Ports with their well-known service, in numeric order. */
export function portList(ports: number[]): string {
  return [...ports]
    .sort((a, b) => a - b)
    .map((p) => (PORT_SERVICE[p] ? `${p} ${PORT_SERVICE[p]}` : String(p)))
    .join(", ");
}

// ---------------------------------------------------------------- IP

/** What public lists say this address is. DROP outranks the rest because it is
 *  a statement about the whole netblock, which is the one nobody should miss. */
export function listedAs(r: CheckResult): string | undefined {
  const drop = ok(r.sources, "spamhaus-drop");
  if (drop?.categories?.includes("criminal-netblock")) {
    return parts("disowned block", str(drop.details?.cidr));
  }
  const cats = ok(r.sources, "tor-project")?.categories ?? [];
  if (cats.includes("tor-exit")) return "Tor exit, by the Tor project";
  if (cats.includes("tor-relay")) return "Tor relay, by the Tor project";
  const gn = ok(r.sources, "greynoise")?.details;
  if (gn?.riot === true) return parts(str(gn.actor), "common service infrastructure");
  const scanner = str(ok(r.sources, "scanner-id")?.details?.operator);
  return scanner ? `research scanner, ${scanner}` : undefined;
}

/** The AS number with its holder, unless the number already spells it out.
 *  ip-api returns `asn` as "AS60729 Stiftung Erneuerbare Freiheit" and `asnOrg`
 *  as the same holder, so joining them blind printed the name twice. */
export function asnLine(asn: string | undefined, org: string | undefined): string | undefined {
  if (!asn) return undefined;
  const repeats = org && asn.toLowerCase().includes(org.toLowerCase());
  return org && !repeats ? `${asn} ${org}` : asn;
}

/** The caption under the Type cell. Derived from the same classifier the cell
 *  itself is, because it sits directly beneath it: when this read the geo flags
 *  on its own, a front door printed "FRONT DOOR" with "hosting or datacentre"
 *  under it, two answers to one question stacked one on top of the other. */
export function assignment(r: CheckResult): string {
  return classifyIpLabel(ipEvidence(r.geo, r.sources)).caption;
}

function ipFields(r: CheckResult): IdentityClaim[] {
  const geo = r.geo;
  const pdb = ok(r.sources, "peeringdb")?.details;
  const rdap = ok(r.sources, "rdap-ip")?.details;
  const ripe = ok(r.sources, "ripestat")?.details;
  const range = ok(r.sources, "cloud-range")?.details;
  const shodan = shodanHostInfo(r.sources);
  const scanned = ok(r.sources, "shodan-internetdb");
  const neighbours = ok(r.sources, "reverse-ip")?.details?.domainCount;
  const res = r.geoResolution;
  const filed = str(rdap?.allocationCountry);
  const measured = res?.countryCode ?? geo?.countryCode;
  const clash = Boolean(filed && measured && filed.toUpperCase() !== measured.toUpperCase());
  const asnOrg = geo?.asnOrg?.trim();
  const isp = geo?.isp?.trim();
  const rpki = str(ripe?.rpkiStatus)?.toLowerCase();
  const fcrdns = geo?.fcrdns;

  return [
    f("name", "Name", geo?.reverse),
    f("fcrdns", "Name checks out", fcrdns && (fcrdns.verified ? "yes, points back" : "no, does not point back"), {
      notable: fcrdns?.verified === false || undefined,
    }),
    f("listed", "Listed as", listedAs(r)),
    f("assignment", "Assignment", assignment(r)),
    f("operator", "Operator", str(pdb?.peeringName)),
    f("class", "Network class", parts(str(pdb?.networkClass), str(pdb?.trafficLevel))),
    f("country", "Country", parts(res?.country?.value ?? geo?.country, res?.city?.value ?? geo?.city), {
      countryCode: measured,
    }),
    f("filed", "Registry country", countryName(filed), { notable: clash || undefined }),
    f("asn", "Network", asnLine(geo?.asn?.trim(), asnOrg)),
    f("isp", "Provider", isp && (!asnOrg || isp.toLowerCase() !== asnOrg.toLowerCase()) && isp),
    f("org", "Organisation", geo?.org && geo.org !== isp && geo.org !== asnOrg && geo.org),
    f("block", "Block", parts(str(rdap?.networkName), str(rdap?.range))),
    f("allocated", "Allocated", day(str(rdap?.registeredAt))),
    f("prefix", "Announced", parts(str(ripe?.prefix), rpki && `RPKI ${rpki}`)),
    f("range", "Published range", parts(str(range?.provider), str(range?.cidr))),
    f("ports", "Open ports", scanned && (portList(shodan.ports) || "none found")),
    f(
      "software",
      "Software",
      list(
        shodan.cpes.map((c) => {
          const t = cpeLabel(c);
          return t.version ? `${t.name} ${t.version}` : t.name;
        }),
      ),
    ),
    f("hostnames", "Hostnames", list(shodan.hostnames)),
    f(
      "sharing",
      "Sharing it",
      typeof neighbours === "number" &&
        neighbours > 0 &&
        `${neighbours} other ${neighbours === 1 ? "name" : "names"}`,
    ),
    f("abuse", "Complaints to", parts(str(rdap?.abuseContact), str(rdap?.abuseOrg))),
  ];
}

// ------------------------------------------------------------ domain

/**
 * EPP status codes worth naming. Most are routine locks; these say the name is
 * on its way out of existence, which is an identity fact.
 */
const GRAVE_STATUS: Record<string, string> = {
  clienthold: "suspended, will not resolve",
  serverhold: "suspended by the registry",
  pendingdelete: "queued for deletion",
  redemptionperiod: "expired, in redemption",
};

export function standing(statuses: string[]): { value?: string; grave: boolean } {
  const grave = statuses.map((s) => GRAVE_STATUS[s.toLowerCase()]).find(Boolean);
  if (grave) return { value: grave, grave: true };
  return { value: statuses.length ? list(statuses) : undefined, grave: false };
}

function domainFields(r: DomainCheckResult): IdentityClaim[] {
  const ctx = r.context;
  const res = r.geoResolution;
  const range = ok(r.sources, "cloud-range")?.details;
  const certs = r.certificates ?? [];
  const rank = ok(r.sources, "tranco")?.details?.rank;
  const cf = ok(r.sources, "cloudflare-intel")?.details;
  const state = standing(ctx?.statuses ?? []);

  return [
    f("category", "Category", list(ctx?.categories ?? [])),
    f("application", "Known as", cleanAppName(str(cf?.application))),
    f("registrar", "Registrar", ctx?.registrar),
    f("created", "Registered", day(ctx?.createdAt)),
    f("expires", "Paid to", day(ctx?.expiresAt)),
    f("standing", "Standing", state.value, { notable: state.grave || undefined }),
    f("resolve", "Resolves to", ctx?.nxdomain ? "no such name" : list(ctx?.resolvedIps ?? []), {
      notable: ctx?.nxdomain || undefined,
    }),
    f("ipv6", "IPv6", list(ctx?.ipv6 ?? [])),
    f("country", "Country", parts(res?.country?.value, res?.city?.value), {
      countryCode: res?.countryCode,
    }),
    f("range", "Published range", parts(str(range?.provider), str(range?.cidr))),
    f("reverse", "Reverse names", list(ctx?.reverse ?? [])),
    f("ns", "Nameservers", list(ctx?.nameservers ?? [])),
    f("mx", "Mail hosts", list(ctx?.mx ?? [])),
    f("spf", "SPF", ctx?.spf),
    f("dmarc", "DMARC", ctx?.dmarc),
    f("dnssec", "DNSSEC", ctx?.dnssec === "unknown" ? undefined : ctx?.dnssec),
    f("caa", "Certificates from", list(caaIssuers(ctx?.caa ?? []))),
    f("certs", "Certificates", certs.length ? `${certs.length} in CT logs, ${certs[0].issuer}` : undefined),
    f("subs", "Subdomains", r.subdomains?.length ? String(r.subdomains.length) : undefined),
    f("tranco", "Tranco rank", typeof rank === "number" ? rank.toLocaleString("en-US") : undefined),
    f("soa", "SOA", ctx?.soa),
    f("cname", "CNAME", list(ctx?.cname ?? [])),
  ];
}

// -------------------------------------------------------------- hash

function hashFields(r: HashCheckResult): IdentityClaim[] {
  const ctx = r.context;
  const names = (ctx?.fileNames?.length ? ctx.fileNames : [ctx?.fileName]).filter(
    (n): n is string => Boolean(n),
  );
  const times = ctx?.timesSubmitted;
  const dlls = (ctx?.importedDlls ?? []).map((d) => d.name);
  const yara = [...new Set(strArr(ok(r.sources, "yaraify")?.details?.yaraRules))];
  const forged = ctx?.signed === false && Boolean(ctx?.signer);

  return [
    f("names", "Names", list(names)),
    f("format", "Format", ctx?.fileType),
    f("magic", "Really", ctx?.magic),
    f("size", "Size", formatBytes(ctx?.fileSize)),
    f("family", "Family", ctx?.malwareFamily ?? ctx?.threatLabel, { notable: true }),
    f("signer", "Signed by", ctx?.signer),
    f("signed", "Signature checks out", signatureWord(ctx?.signed, ctx?.signer), {
      notable: forged || undefined,
    }),
    f("md5", "MD5", ctx?.md5),
    f("sha1", "SHA-1", ctx?.sha1),
    f("sha256", "SHA-256", ctx?.sha256),
    f("imphash", "Imphash", ctx?.imphash),
    f("ssdeep", "ssdeep", ctx?.ssdeep),
    f("tlsh", "TLSH", ctx?.tlsh),
    f("first", "First seen", day(ctx?.firstSeen)),
    f("last", "Last seen", day(ctx?.lastSeen)),
    f(
      "submissions",
      "Submissions",
      typeof times === "number" && times > 0 && times.toLocaleString("en-US"),
    ),
    f("imports", "Imports", list(dlls)),
    f("yara", "YARA rules", list(yara)),
  ];
}

/** An unsigned file and a file whose signature failed are different things, and
 *  only the second one has anything to check. */
function signatureWord(signed: boolean | undefined, signer: string | undefined): string | undefined {
  if (signed === true) return "yes";
  if (signed === false && signer) return "no";
  return undefined;
}

// ------------------------------------------------------------ vitals

/**
 * The value half of a slot, or nothing.
 *
 * Takes the headline and its caption together because they stand or fall
 * together: a caption under an absent headline qualifies a fact that is not
 * there.
 */
const got = (
  value: string | undefined | false,
  sub?: string | undefined | false,
): { value: string; sub?: string } | undefined =>
  value ? { value, sub: sub || undefined } : undefined;

/** One slot. The missing wording is per slot rather than one global "unknown",
 *  because "no reverse name" and "unranked" are different facts and a strip of
 *  four identical `unknown`s says nothing at all. */
function v(
  key: string,
  label: string,
  hit: { value: string; sub?: string } | undefined,
  missing: string | { value: string; sub?: string },
  extra: Omit<Vital, "key" | "label" | "value" | "sub"> = {},
): Vital {
  if (hit) return { key, label, ...hit, ...extra };
  const gap = typeof missing === "string" ? { value: missing } : missing;
  return { key, label, ...gap, absent: true };
}

/**
 * The AS number and its holder, split apart.
 *
 * ip-api packs both into one field ("AS48090 TECHOFF SRV LIMITED"), and the
 * strip needs them separately: the number is short enough to be a headline and
 * the holder never is. Falls back to the separate org field when the packed
 * string carries only the number.
 */
export function splitAsn(
  asn: string | undefined,
  org: string | undefined,
): { number?: string; holder?: string } {
  const trimmed = asn?.trim() ?? "";
  const number = /^AS\d+/i.exec(trimmed)?.[0];
  const packed = number ? trimmed.slice(number.length).trim() : undefined;
  return { number, holder: packed || org?.trim() || undefined };
}

/** The connection kind as one word, for the headline. `assignment` already
 *  names it as a phrase, which is the caption under this.
 *
 *  Derived rather than decided: this used to read the same three geo booleans
 *  the tile's own heading reads, which meant the cell and the heading above it
 *  were two independent answers to one question, free to drift apart the moment
 *  either grew a case. They did grow one. Now there is a single classifier and
 *  this is its short form. */
export function typeWord(r: CheckResult): string {
  return classifyIpLabel(ipEvidence(r.geo, r.sources)).short;
}

/** Whether the reverse name survives a forward lookup, in the caption's voice. */
function fcrdnsWord(verified: boolean | undefined): string | undefined {
  if (verified === true) return "points back";
  if (verified === false) return "does not point back";
  return undefined;
}

function ipVitals(r: CheckResult): Vital[] {
  const geo = r.geo;
  const res = r.geoResolution;
  const rdap = ok(r.sources, "rdap-ip")?.details;
  const filed = str(rdap?.allocationCountry);
  const measured = res?.countryCode ?? geo?.countryCode;
  const clash = Boolean(filed && measured && filed.toUpperCase() !== measured.toUpperCase());
  const { number, holder } = splitAsn(geo?.asn, geo?.asnOrg ?? geo?.isp);
  const ripe = ok(r.sources, "ripestat")?.details;
  const prefix = str(ripe?.prefix);
  // RIPEstat's own ASN list first: it is the party actually announcing the
  // prefix, which is not always the holder the geo provider names. It stores
  // bare AS numbers, so the prefix has to be put back on.
  const announcing = Array.isArray(ripe?.asns) ? ripe.asns[0] : undefined;
  const announcer =
    announcing === undefined || announcing === null ? number : `AS${announcing}`;

  return [
    v(
      "country",
      "Country",
      got(
        res?.country?.value ?? geo?.country,
        parts(
          res?.city?.value ?? geo?.city,
          clash ? `registry says ${countryName(filed)}` : undefined,
        ),
      ),
      "Not located",
      { countryCode: measured },
    ),
    // The class used to sit here, and it is the hero's headline now. Putting
    // the announced prefix in the freed slot rather than leaving three cells
    // keeps the four fixed positions the strip is built on, and the prefix is
    // a fact the page otherwise only has inside the summary paragraph.
    v(
      "prefix",
      "Prefix",
      got(prefix, prefix && announcer ? `announced by ${announcer}` : undefined),
      "No prefix announced",
    ),
    v("network", "Network", got(number ?? holder, number ? holder : undefined), "No AS on record"),
    v("name", "Name", got(geo?.reverse, fcrdnsWord(geo?.fcrdns?.verified)), "No reverse name"),
  ];
}

function domainVitals(r: DomainCheckResult): Vital[] {
  const ctx = r.context;
  const res = r.geoResolution;
  // Not `categories[0]`: Cloudflare mixes its filter-list taxonomy in with the
  // content categories and in no useful order, so the first entry for
  // pornhub.com is "CIPA Filter", the name of a school-filtering statute,
  // printed in the slot meant to say what the site is.
  const cats = ctx?.categories ?? [];
  const cat = contentCategory(cats);
  const rest = cats.filter((c) => c !== cat && contentCategory([c]));
  const rank = ok(r.sources, "tranco")?.details?.rank;
  const app = cleanAppName(str(ok(r.sources, "cloudflare-intel")?.details?.application));
  const born = day(ctx?.createdAt);

  return [
    v("category", "Category", got(cat ?? app, list(rest)), "Uncategorised"),
    v(
      "registrar",
      "Registrar",
      got(ctx?.registrar, born && `registered ${born}`),
      born ? { value: "Not on file", sub: `registered ${born}` } : "Not on file",
    ),
    v(
      "country",
      "Country",
      got(res?.country?.value, res?.city?.value),
      "Not located",
      { countryCode: res?.countryCode },
    ),
    v(
      "reach",
      "Reach",
      got(
        typeof rank === "number" && `Rank ${rank.toLocaleString("en-US")}`,
        "Tranco top million",
      ),
      { value: "Unranked", sub: "outside the Tranco top million" },
    ),
  ];
}

/** What the signature says about who made the file. A file nobody signed and a
 *  file whose signature does not check out are opposite facts, and only the
 *  second one names a publisher. */
export function signatureVital(
  signed: boolean | undefined,
  signer: string | undefined,
): { value: string; sub?: string } {
  if (signed === true) return { value: "Signed", sub: signer };
  if (signed === false && signer) return { value: "Bad signature", sub: `claims ${signer}` };
  return { value: "Unsigned", sub: "no publisher claims it" };
}

function hashVitals(r: HashCheckResult): Vital[] {
  const ctx = r.context;
  const bytes = ctx?.fileSize;
  const first = day(ctx?.firstSeen);
  const last = day(ctx?.lastSeen);

  return [
    // The family used to headline this strip and is the hero's headline now.
    // First seen takes the freed slot: it is the fact that separates a sample
    // the world met this morning from one it has known for six years, and it
    // lived only in the ledger below.
    v("seen", "First seen", got(first, last && last !== first && `last ${last}`), "Never recorded"),
    v("format", "Format", got(ctx?.fileType, ctx?.magic), "Unknown format"),
    v(
      "size",
      "Size",
      got(
        formatBytes(bytes),
        typeof bytes === "number" && `${bytes.toLocaleString("en-US")} bytes`,
      ),
      "Unknown size",
    ),
    // Never absent: "unsigned" is what an absent signature means, and drawing
    // it quiet would say the question was not asked.
    { key: "signature", label: "Signature", ...signatureVital(ctx?.signed, ctx?.signer) },
  ];
}

/** The dex entry behind the subject record. */
export function buildIdentity(r: AnyResult): IdentityRecord {
  const kind = buildSubjectRecord(r).class.label;
  if (isHashResult(r)) return { kind, vitals: hashVitals(r), fields: hashFields(r) };
  if (isDomainResult(r)) return { kind, vitals: domainVitals(r), fields: domainFields(r) };
  return { kind, vitals: ipVitals(r), fields: ipFields(r) };
}
