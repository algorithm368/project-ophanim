import { cpeLabel } from "@/lib/cpe";
import { parseDomain } from "@/lib/domain";
import { classifyIpLabel, ipEvidence } from "./indicator-class";
import { formatBytes } from "./narrative";
import { PORT_SERVICE, shodanHostInfo } from "./shodan";
import { byCodeUnit } from "./sort";
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
 *  - **One fixed order.** The same fields in the same places on every lookup,
 *    so the eye learns where each fact lives and stops reading labels. A
 *    domain's fields are also grouped by aspect (registration, resolution,
 *    mail, certificates): its twenty rows read as a wall, and the headings are
 *    what let a reader go straight to the mail posture. An address and a file
 *    are still one flat list.
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
  /** The aspect the field belongs to, which the record heads it with. Only a
   *  domain's fields carry one. */
  group?: string;
  /** The reading of the value in a word or two ("Softfail", "Locked"), set
   *  before it and heavier. `value` is then the detail behind the reading. */
  lead?: string;
  /** The record as published, set small under the reading, so the evidence
   *  for it can still be read and copied. */
  raw?: string;
  /** A list set one item per line. `value` still holds it comma-joined. */
  lines?: string[];
  /** A value a machine reads (an address, a host, a record), set in mono so
   *  `l` and `1` stay apart. Prose values are set in the page's sans. */
  data?: boolean;
};

/**
 * One of the headline facts, set large above the ledger.
 *
 * A vital is a *position*, not a row: the eye is meant to land on the second
 * cell for the network, which only works if the slots never move and never
 * disappear. A slot with nothing behind it therefore says so in its own words,
 * rather than yielding its place to the next one.
 */
export type Vital = {
  key: string;
  /** The slot name ("Country", "Network"). Fixed per IOC type. */
  label: string;
  /** The headline, two or three words. */
  value: string;
  /** The one line under it that qualifies it. */
  sub?: string;
  /** A run at the start or end of `value` that carries no news ("AS", "Rank ",
   *  ".it"), drawn quiet so the eye lands on the part that differs. */
  quiet?: { lead?: string; tail?: string };
  /** ISO 3166-1 alpha-2, when the slot should carry a flag. */
  countryCode?: string;
  /** Nothing was measured for this slot, so `value` is the absence. */
  absent?: boolean;
  /** The value is itself a red flag the scanner raised. Only the active scan
   *  sets this; the passive strip keeps colour off its vitals. */
  flagged?: boolean;
};

/** An age as a mark, in the largest unit that is still accurate, with the
 *  unit split off so the number is what the eye lands on. Whole units only,
 *  rounded down: a mark has no room for "about", so it never claims a year the
 *  thing has not reached. */
export function ageMark(days: number): Pick<Vital, "value" | "quiet"> {
  if (days === 0) return { value: "Today" };
  let n = days;
  let unit = days === 1 ? "day" : "days";
  if (days >= 730) {
    n = Math.floor(days / 365);
    unit = "years";
  } else if (days >= 60) {
    n = Math.round(days / 30);
    unit = "months";
  }
  return { value: `${n} ${unit}`, quiet: { tail: ` ${unit}` } };
}

/**
 * The longest unbreakable run across a strip's headlines, in characters.
 *
 * The strip sets every mark at one size, the largest at which this run still
 * fits its cell, so a word is never split to make it fit. A run ends at a
 * space or after a dot, which is where a mark is allowed to wrap; a hyphen
 * does not end one, since "2020-07-" over "15" reads as broken, not wrapped.
 */
export function longestRun(vitals: Pick<Vital, "value">[]): number {
  const runs = vitals.flatMap((v) => v.value.split(/\s+|(?<=\.)/));
  return Math.max(1, ...runs.map((r) => r.length));
}

/** One run of a headline, as `markParts` splits it. */
export type MarkPart = { text: string; quiet?: boolean };

/**
 * A headline in runs, its quiet lead and tail split off.
 *
 * A quiet run the value does not actually carry is ignored, and the value is
 * never quiet as a whole: a headline that is all quiet has nothing left for
 * the eye to land on.
 */
export function markParts(v: Pick<Vital, "value" | "quiet">): MarkPart[] {
  const { value } = v;
  const lead = v.quiet?.lead && value.startsWith(v.quiet.lead) ? v.quiet.lead : "";
  const rest = value.slice(lead.length);
  const tail = v.quiet?.tail && rest.endsWith(v.quiet.tail) ? v.quiet.tail : "";
  const core = rest.slice(0, rest.length - tail.length);
  if (!core) return [{ text: value }];
  return [
    ...(lead ? [{ text: lead, quiet: true }] : []),
    { text: core },
    ...(tail ? [{ text: tail, quiet: true }] : []),
  ];
}

export type IdentityRecord = {
  /** What the thing is, e.g. "Tor exit node". The header states it. */
  kind: string;
  /** Three for an address, four for a domain or a file, in a fixed order per
   *  IOC type. */
  vitals: Vital[];
  /** The fixed list, in order. Every field is present on every lookup. */
  fields: IdentityClaim[];
};

const NONE = "none published";

/** A claim's value; empty or false reads as the absence. */
type ClaimValue = string | undefined | false;

/** One row. An empty value becomes the absence, which is itself a fact. */
function f(
  key: string,
  label: string,
  value: ClaimValue,
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
const parts = (...values: (ClaimValue)[]): string =>
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
    // The default fallback is "code", so an unknown region comes back as itself.
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase());
  } catch {
    return code;
  }
}

/** Cloudflare's application names carry operational suffixes meant for its own
 *  product, e.g. "GitHub (Do Not Inspect)", which is an instruction to a TLS
 *  proxy and not part of the name. */
export function cleanAppName(name: string | undefined): string | undefined {
  const trimmed = name?.replace(/\([^()]*\)\s*$/, "").trim();
  return trimmed || undefined;
}

/** The issuer names out of a CAA record set. A CAA line reads
 *  `0 issue "letsencrypt.org"`, and only the quoted authority is worth showing. */
export function caaIssuers(caa: string[]): string[] {
  return caa
    // split() never returns an empty list, so there is always a last word.
    .map((line) => /"([^"]+)"/.exec(line)?.[1] ?? line.split(/\s+/).pop()!)
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
    f("isp", "Provider", isp && asnOrg?.toLowerCase() !== isp.toLowerCase() && isp),
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

/** RDAP spells a status "client transfer prohibited" and EPP spells it
 *  "clientTransferProhibited"; both reduce to the same key. */
const statusKey = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

const LOCK_ACTIONS = ["delete", "transfer", "update"] as const;

/**
 * A domain's statuses as a reading of its locks.
 *
 * The six `*Prohibited` codes are the point of the field, and as a list they
 * were three lines of near-identical words. Read instead: what is locked, and
 * by whom ("Transfer locked, by client"). Any other status is named after it.
 * A status that means the name is going away outranks all of it.
 */
/** A reading of the locks, or a grave status (or none) as a plain value. */
export type Standing =
  | { lead: string; value: string; grave: false }
  | { lead?: undefined; value?: string; grave: boolean };

export function standing(statuses: string[]): Standing {
  const keys = statuses.map(statusKey);
  const grave = keys.map((k) => GRAVE_STATUS[k]).find(Boolean);
  if (grave) return { value: grave, grave: true };
  if (statuses.length === 0) return { grave: false };

  const matches = keys.map((k) => /^(client|server)(delete|transfer|update)prohibited$/.exec(k));
  const locks = matches
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([, by, action]) => ({ by, action }));
  const other = statuses.filter((_, i) => matches[i] === null);
  const also = other.length ? list(other.map((s) => s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase())) : "";

  const actions = LOCK_ACTIONS.filter((a) => locks.some((l) => l.action === a));
  const whoLocks = (a: string) => list(locks.filter((l) => l.action === a).map((l) => l.by)).replace(", ", " and ");
  let lead = "Unlocked";
  let detail = "";
  if (locks.length === 6) {
    lead = "Locked";
    detail = "client and server";
  } else if (actions.length) {
    const named = actions.join(", ");
    lead = `${named[0].toUpperCase()}${named.slice(1)} locked`;
    const who = new Set(actions.map(whoLocks));
    detail = who.size === 1 ? `by ${[...who][0]}` : actions.map((a) => `${a} by ${whoLocks(a)}`).join(", ");
  }
  // Never empty: a status is either one of the six locks, which leaves a
  // detail, or another status, which is named.
  return { lead, value: parts(detail, also && `also ${also}`), grave: false };
}

const SPF_ALL: Record<string, string> = { "-": "Fail", "~": "Softfail", "?": "Neutral", "+": "Pass all" };

/** Counted as "1 include" or "3 addresses". */
function tally(n: number, word: string): string | false {
  if (n === 0) return false;
  if (n === 1) return `1 ${word}`;
  return `${n} ${word}${word.endsWith("s") ? "es" : "s"}`;
}

/**
 * An SPF record as its policy and its size.
 *
 * The `all` qualifier is the policy, what a receiver does with mail from
 * anywhere not listed, so it leads. The rest is counted rather than printed,
 * since the record itself is set in full under the reading.
 */
export function spfReading(spf: string): { lead: string; value?: string } {
  const terms = spf.trim().split(/\s+/).slice(1);
  const all = terms.map((t) => /^([-~?+]?)all$/i.exec(t)).find(Boolean);
  const redirect = terms.find((t) => /^redirect=/i.test(t));
  let lead = "No policy";
  if (all) lead = SPF_ALL[all[1] || "+"];
  else if (redirect) lead = "Redirect";
  const rest = terms.filter((t) => !/^[-~?+]?all$/i.test(t) && !/^redirect=/i.test(t));
  const addresses = rest.filter((t) => /^[-~?+]?ip[46]:/i.test(t)).length;
  const includes = rest.filter((t) => /^[-~?+]?include:/i.test(t)).length;
  const value = parts(
    redirect && `to ${redirect.slice("redirect=".length)}`,
    tally(addresses, "address"),
    tally(includes, "include"),
    tally(rest.length - addresses - includes, "other"),
  );
  return { lead, value: value || undefined };
}

/** A DMARC record as its policy and where it reports to. */
export function dmarcReading(dmarc: string): { lead: string; value: string } {
  const tag = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]+)`, "i").exec(dmarc)?.[1].trim();
  const policy = tag("p")?.toLowerCase();
  const rua = tag("rua")
    ?.split(",")
    .map((u) => u.trim().replace(/^mailto:/i, ""))
    .filter(Boolean);
  return {
    lead: policy ? `${policy[0].toUpperCase()}${policy.slice(1)}` : "No policy",
    value: rua?.length ? `reports to ${list(rua)}` : "no report address",
  };
}

/** Mail providers recognisable from their MX hosts alone. */
const MAIL_PROVIDERS: [RegExp, string][] = [
  [/(^|\.)(aspmx\.l\.google\.com|googlemail\.com)$/, "Google Workspace"],
  [/\.mail\.protection\.outlook\.com$/, "Microsoft 365"],
  [/\.pphosted\.com$/, "Proofpoint"],
  [/\.mimecast\.com$/, "Mimecast"],
  [/(^|\.)zoho\.(com|eu|in)$/, "Zoho Mail"],
  [/\.mx\.cloudflare\.net$/, "Cloudflare Email Routing"],
];

/** Who handles the mail, when every MX host belongs to one known provider. */
export function mailProvider(hosts: string[]): string | undefined {
  if (hosts.length === 0) return undefined;
  const lower = hosts.map((h) => h.toLowerCase().replace(/\.$/, ""));
  return MAIL_PROVIDERS.find(([re]) => lower.every((h) => re.test(h)))?.[1];
}

/** Tags every claim with its group. */
const group = (name: string, claims: IdentityClaim[]): IdentityClaim[] =>
  claims.map((c) => ({ ...c, group: name }));

/** A list as a claim, one item per line, in the order given. */
const lined = (key: string, label: string, items: string[], extra: Omit<IdentityClaim, "key" | "label" | "value"> = {}) => {
  const unique = [...new Set(items.filter(Boolean))];
  return f(key, label, list(unique), unique.length ? { lines: unique, data: true, ...extra } : extra);
};

/** A claim read as a word with its detail behind it, plus what it was read from. */
function read(key: string, label: string, raw: string | undefined, reading: (raw: string) => { lead: string; value?: string }): IdentityClaim {
  if (!raw) return f(key, label, undefined);
  const { lead, value } = reading(raw);
  return { key, label, lead, value: value ?? "", raw };
}

/**
 * A domain's fields, by aspect.
 *
 * Four facts are left to the page around it rather than repeated here: the
 * content category is the hero's class, the country and the Tranco rank are
 * vitals, and the subdomains have a tile of their own.
 */
function domainFields(r: DomainCheckResult): IdentityClaim[] {
  const ctx = r.context;
  const range = ok(r.sources, "cloud-range")?.details;
  const certs = r.certificates ?? [];
  const cf = ok(r.sources, "cloudflare-intel")?.details;
  const state = standing(ctx?.statuses ?? []);
  const mx = [...new Set(ctx?.mx ?? [])].sort(byCodeUnit);
  const provider = mailProvider(mx);

  return [
    ...group("Registration", [
      f("application", "Known as", cleanAppName(str(cf?.application))),
      f("registrar", "Registrar", ctx?.registrar),
      f("created", "Registered", day(ctx?.createdAt), { data: true }),
      f("expires", "Paid to", day(ctx?.expiresAt), { data: true }),
      state.lead
        ? { key: "standing", label: "Standing", lead: state.lead, value: state.value }
        : f("standing", "Standing", state.value, { notable: state.grave || undefined }),
      f("dnssec", "DNSSEC", ctx?.dnssec === "unknown" ? undefined : ctx?.dnssec),
    ]),
    ...group("Resolution", [
      ctx?.nxdomain
        ? f("resolve", "Resolves to", "no such name", { notable: true })
        : lined("resolve", "Resolves to", ctx?.resolvedIps ?? []),
      lined("ipv6", "IPv6", ctx?.ipv6 ?? []),
      lined("reverse", "Reverse names", ctx?.reverse ?? []),
      lined("ns", "Nameservers", [...(ctx?.nameservers ?? [])].sort(byCodeUnit)),
    ]),
    ...group("Other records", [
      lined("cname", "CNAME", ctx?.cname ?? []),
      f("range", "Published range", parts(str(range?.provider), str(range?.cidr))),
      f("soa", "SOA", ctx?.soa, { data: true }),
    ]),
    ...group("Mail", [
      provider
        ? { key: "mx", label: "Mail hosts", lead: provider, value: `${mx.length} ${mx.length === 1 ? "host" : "hosts"}`, lines: mx }
        : lined("mx", "Mail hosts", mx),
      read("spf", "SPF", ctx?.spf, spfReading),
      read("dmarc", "DMARC", ctx?.dmarc, dmarcReading),
    ]),
    ...group("Certificates", [
      f("certs", "Issued by", certs[0]?.issuer),
      f("ct", "In CT logs", certs.length > 0 && String(certs.length), { data: true }),
      lined("caa", "Allowed by CAA", caaIssuers(ctx?.caa ?? [])),
    ]),
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
  value: ClaimValue,
  sub?: ClaimValue,
): { value: string; sub?: string } | undefined =>
  value ? { value, sub: sub || undefined } : undefined;

/** One slot. The missing wording is per slot rather than one global "unknown",
 *  because "no reverse name" and "unranked" are different facts and a strip of
 *  four identical `unknown`s says nothing at all. */
function v(
  key: string,
  label: string,
  hit: Pick<Vital, "value" | "sub" | "quiet"> | undefined,
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

/** Where in the country, as "city, region", each said once and none of them
 *  the country again: under SINGAPORE, "Singapore" is not a caption. */
export function place(country: string | undefined, ...within: (string | undefined)[]): string {
  return list(within.filter((p): p is string => Boolean(p) && p !== country));
}

/**
 * A reverse name as headline and caption: the registered domain, which says
 * whose name it is, over the host part in front of it, which only numbers the
 * address inside that domain. A name that does not parse is shown whole.
 */
export function reverseName(
  reverse: string | undefined,
): { value: string; sub?: string; quiet?: Vital["quiet"] } | undefined {
  if (!reverse) return undefined;
  const parsed = parseDomain(reverse);
  if (!parsed) return { value: reverse };
  const { domain, registrable } = parsed;
  return {
    value: registrable,
    sub: domain.slice(0, domain.length - registrable.length) || undefined,
    quiet: { tail: registrable.slice(registrable.indexOf(".")) },
  };
}

function ipVitals(r: CheckResult): Vital[] {
  const geo = r.geo;
  const res = r.geoResolution;
  const rdap = ok(r.sources, "rdap-ip")?.details;
  const filed = str(rdap?.allocationCountry);
  const measured = res?.countryCode ?? geo?.countryCode;
  const clash = Boolean(filed && measured && filed.toUpperCase() !== measured.toUpperCase());
  const { number, holder } = splitAsn(geo?.asn, geo?.asnOrg ?? geo?.isp);
  const name = reverseName(geo?.reverse);

  // Three, not four. The announced prefix held the second slot while the strip
  // had labels; without them a bare CIDR is the one value that cannot say what
  // it is, and the record below still carries it as the announced prefix.
  return [
    v(
      "country",
      "Country",
      got(
        res?.country?.value ?? geo?.country,
        parts(
          place(
            res?.country?.value ?? geo?.country,
            res?.city?.value ?? geo?.city,
            res?.region?.value ?? geo?.region,
          ),
          clash && `registry says ${countryName(filed)}`,
        ),
      ),
      "Not located",
      { countryCode: measured },
    ),
    v(
      "network",
      "Network",
      got(number ?? holder, number ? holder : undefined),
      "No AS on record",
      number ? { quiet: { lead: "AS" } } : {},
    ),
    v("name", "Name", name, "No reverse name"),
  ];
}

function domainVitals(r: DomainCheckResult): Vital[] {
  const ctx = r.context;
  const res = r.geoResolution;
  const rank = ok(r.sources, "tranco")?.details?.rank;
  const created = day(ctx?.createdAt);

  // Age, not category, in the middle slot. The hero's class is the content
  // category whenever there is one, so a category slot printed the hero's
  // mark a second time a few lines under it; the categories still reach the
  // page as the class and its caption. Age is the domain's strongest single
  // signal and nothing above the strip sets it as a mark.
  return [
    v(
      "country",
      "Country",
      got(res?.country?.value, place(res?.country?.value, res?.city?.value, res?.region?.value)),
      "Not located",
      { countryCode: res?.countryCode },
    ),
    v(
      "age",
      "Age",
      ctx?.ageDays === undefined
        ? undefined
        : { ...ageMark(ctx.ageDays), sub: parts(created && `registered ${created}`, ctx.registrar) || undefined },
      { value: "Unknown", sub: "no registration date" },
    ),
    v(
      "reach",
      "Reach",
      got(
        typeof rank === "number" && `Rank ${rank.toLocaleString("en-US")}`,
        "Tranco top million",
      ),
      { value: "Unranked", sub: "outside the Tranco top million" },
      { quiet: { lead: "Rank " } },
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

/** Rows the timeline tile owns on `/check`. The active-scan page has no
 *  timeline, so it keeps them. */
const DATE_FIELDS = new Set(["created", "expires", "first", "last"]);

export function buildIdentity(
  r: AnyResult,
  opts: { omitDates?: boolean } = {},
): IdentityRecord {
  const rec = identityOf(r);
  return opts.omitDates
    ? { ...rec, fields: rec.fields.filter((f) => !DATE_FIELDS.has(f.key)) }
    : rec;
}

function identityOf(r: AnyResult): IdentityRecord {
  const kind = buildSubjectRecord(r).class.label;
  if (isHashResult(r)) return { kind, vitals: hashVitals(r), fields: hashFields(r) };
  if (isDomainResult(r)) return { kind, vitals: domainVitals(r), fields: domainFields(r) };
  return { kind, vitals: ipVitals(r), fields: ipFields(r) };
}
