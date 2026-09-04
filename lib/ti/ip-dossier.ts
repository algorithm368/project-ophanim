// Pure data builder for the IP Dossier card: turns an already-fetched
// CheckResult into a small set of self-hiding groups/fields for display.
// No network, no I/O, no React here — see components for rendering.
import type { CheckResult, GeoContext, SourceResult } from "./types";
import { cloudProvider } from "./cloud";
import { shodanHostInfo, PORT_SERVICE } from "./shodan";
import { maliciousTags } from "./sources/shodan-internetdb";
import { cpeLabel } from "@/lib/cpe";
import { relationsFor } from "@/lib/relations";
import { count } from "@/lib/text";

export type DossierField = { label: string; value: string; hint?: string; mono?: boolean };
export type DossierGroup = { id: string; title: string; fields: DossierField[] };
export type IpDossier = { groups: DossierGroup[]; footer: string };

/** Find a settled source result by its registry id. */
export function findFinding(result: CheckResult, id: string): SourceResult | undefined {
  return result.sources.find((s) => s.source.id === id);
}

/** Compact unicode sparkline for 0-100 series (reputation trend). */
const BLOCKS = "▁▂▃▄▅▆▇█";
export function sparkline(values: number[]): string {
  return values
    .map((v) => BLOCKS[Math.max(0, Math.min(7, Math.round((v / 100) * 7)))])
    .join("");
}

function assignmentType(geo?: GeoContext): string {
  if (!geo) return "Unknown";
  if (geo.isProxy) return "Anonymizing proxy / VPN";
  if (geo.isMobile) return "Mobile network";
  if (geo.isHosting) return "Hosting / Datacenter";
  return "Residential / Business endpoint";
}

/** Drop empty fields; return null if a group has nothing worth showing. */
function group(id: string, title: string, fields: (DossierField | null)[]): DossierGroup | null {
  const kept = fields.filter((f): f is DossierField => f !== null && f.value !== "");
  return kept.length ? { id, title, fields: kept } : null;
}

/** What the Tor lists say this address is, if anything. */
function anonymization(categories: string[] | undefined): string {
  if (categories?.includes("tor-exit")) return "Tor exit node";
  if (categories?.includes("tor-relay")) return "Tor relay";
  return "";
}

/**
 * The PTR record, with what verification made of it.
 *
 * A PTR with no FCrDNS data (verification never ran) has to read differently
 * from one where FCrDNS explicitly failed to confirm the forward record: the
 * latter is a classic spoofed-PTR indicator, and collapsing both to a bare
 * hostname made them indistinguishable.
 */
function reverseDnsLine(geo: CheckResult["geo"]): string {
  if (!geo?.reverse) return "";
  if (!geo.fcrdns) return geo.reverse;
  const verdict = geo.fcrdns.verified ? "verified" : "unconfirmed";
  return `${geo.reverse} (FCrDNS ${verdict})`;
}

/** The published range when a list answered, else the ASN table's guess. */
function cloudRow(
  fromRange: string | undefined,
  cidr: string | undefined,
  fromAsn: string | undefined,
): DossierField | null {
  if (fromRange) {
    return { label: "Cloud infrastructure", value: fromRange, hint: cidr };
  }
  return fromAsn ? { label: "Cloud infrastructure", value: fromAsn } : null;
}

export function buildHostClassification(result: CheckResult): DossierGroup | null {
  const geo = result.geo;
  const gn = findFinding(result, "greynoise");
  const riot = gn?.details?.riot === true ? (gn?.details?.actor as string | undefined) : undefined;
  // The provider's own published range carries the region and service; the ASN
  // table is the fallback when no list could be fetched.
  const range = findFinding(result, "cloud-range")?.details;
  const rangeLine = str(range?.provider)
    ? [str(range?.provider), [str(range?.region), str(range?.service)].filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(" ")
    : undefined;
  const cloud = cloudProvider(geo?.asn, geo?.asnOrg);
  const scanner = findFinding(result, "scanner-id")?.details;

  const anon = anonymization(findFinding(result, "tor-project")?.categories);
  const ptr = reverseDnsLine(geo);

  return group("classification", "Host classification", [
    { label: "Assignment type", value: assignmentType(geo) },
    riot ? { label: "Recognized service", value: riot } : null,
    str(scanner?.operator)
      ? {
          label: "Research scanner",
          value: `${str(scanner?.operator)}, by its own PTR`,
          hint: str(scanner?.hostname),
        }
      : null,
    cloudRow(rangeLine, str(range?.cidr), cloud?.name),
    anon ? { label: "Anonymization", value: anon } : null,
    ptr ? { label: "Reverse DNS (PTR)", value: ptr, mono: true } : null,
  ]);
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Split Shodan InternetDB's tags into threat tags (malware, compromised, c2,
 *  phishing, botnet, honeypot — the same set the adapter uses to set its own
 *  `malicious` flag) and the remaining benign infrastructure tags, so a threat
 *  tag doesn't render as neutral alongside e.g. "cloud". */
function shodanTagSplit(result: CheckResult): { threat: string[]; benign: string[] } {
  const shodan = findFinding(result, "shodan-internetdb");
  const tags = strArr(shodan?.details?.tags);
  const threat = maliciousTags(tags);
  const threatSet = new Set(threat.map((t) => t.toLowerCase()));
  const benign = tags.filter((t) => !threatSet.has(t.toLowerCase()));
  return { threat, benign };
}

export function buildExposedServices(result: CheckResult): DossierGroup | null {
  const { ports, vulns, cpes, hostnames } = shodanHostInfo(result.sources);
  const { benign: tags } = shodanTagSplit(result);

  const portList = [...ports]
    .sort((a, b) => a - b)
    .map((p) => (PORT_SERVICE[p] ? `${p} ${PORT_SERVICE[p]}` : String(p)))
    .join(", ");

  // Dedupe detected software by "name version" so repeated CPEs for the same
  // product/version collapse into one chip.
  const techs = Array.from(
    new Map(cpes.map((c) => cpeLabel(c)).map((t) => [`${t.name} ${t.version ?? ""}`, t])).values(),
  ).map((t) => (t.version ? `${t.name} ${t.version}` : t.name));

  const cveList = vulns.slice(0, 6).join(", ");

  return group("exposed", "Exposed services", [
    portList ? { label: "Open ports", value: portList, mono: true } : null,
    techs.length ? { label: "Detected software", value: techs.join(", ") } : null,
    vulns.length
      ? {
          label: "Known vulnerabilities",
          value: `${vulns.length} (${cveList}${vulns.length > 6 ? ", …" : ""})`,
          mono: true,
        }
      : null,
    tags.length ? { label: "Infrastructure tags", value: tags.join(", ") } : null,
    hostnames.length
      ? { label: "Associated hostnames", value: hostnames.slice(0, 4).join(", "), mono: true }
      : null,
  ]);
}

/** "value, qualifier", or the value alone. The qualifier is always a detail of
 *  the value, so it never appears without it. */
function withQualifier(
  value: string | undefined,
  qualifier: string | undefined,
  prefix = "",
): string {
  if (!value) return "";
  return qualifier ? `${value}, ${prefix}${qualifier}` : value;
}

/** The AS number with its holder, unless the number already spells it out. */
function asnLine(asn: string | undefined, org: string | undefined): string {
  if (!asn) return "";
  const repeats = org && asn.toLowerCase().includes(org.toLowerCase());
  return org && !repeats ? `${asn} ${org}` : asn;
}

export function buildNetworkProvenance(result: CheckResult): DossierGroup | null {
  const geo = result.geo;
  const pdb = findFinding(result, "peeringdb")?.details;
  const rdap = findFinding(result, "rdap-ip")?.details;
  const ripe = findFinding(result, "ripestat")?.details;

  const asnOrg = geo?.asnOrg?.trim();
  const asn = asnLine(geo?.asn?.trim(), asnOrg);
  const netClass = withQualifier(str(pdb?.networkClass), str(pdb?.trafficLevel));
  const org = geo?.org && geo.org !== geo.isp && geo.org !== geo.asnOrg ? geo.org : "";
  const allocation = withQualifier(str(rdap?.networkName), str(rdap?.range));
  const prefix = withQualifier(str(ripe?.prefix), str(ripe?.rpkiStatus), "RPKI ");
  const dshield = findFinding(result, "dshield")?.details;
  // RDAP is the authority, but it often omits the contact entirely and DShield
  // carries one for the announcing network.
  const abuse =
    withQualifier(str(rdap?.abuseContact), str(rdap?.abuseOrg)) ||
    str(dshield?.abuseContact) ||
    "";

  return group("provenance", "Network provenance", [
    asn ? { label: "Autonomous system", value: asn, mono: true } : null,
    netClass ? { label: "Network class", value: netClass } : null,
    geo?.isp ? { label: "Internet provider", value: geo.isp } : null,
    org ? { label: "Organization", value: org } : null,
    allocation ? { label: "Allocation", value: allocation, mono: true } : null,
    prefix ? { label: "Announced prefix", value: prefix, mono: true } : null,
    abuse ? { label: "Abuse contact", value: abuse, mono: true } : null,
    str(rdap?.allocationCountry)
      ? { label: "Allocation country", value: str(rdap?.allocationCountry)! }
      : null,
  ]);
}

function isoDate(s: string): string {
  return s.slice(0, 10);
}

/**
 * Blocklist listings, keyed off each source's raw listing evidence rather than
 * its `malicious` flag: dnsbl/blocklist-de/ipsum all gate `malicious` behind a
 * consensus threshold (>=3 zones, >=5 attacks, >=3 feeds), so a sub-threshold
 * listing (e.g. 2 DNSBL zones) previously produced no row at all even though
 * the source did report a listing. spamhaus-drop is intentionally excluded
 * here: it never sets `malicious` by design, because a DROP listing is a
 * statement about the netblock rather than the address. It is registered and
 * does return findings; lib/ti/subject-record.ts reads its
 * "criminal-netblock" category as an identity claim.
 */
function blocklistEvidence(result: CheckResult): string[] {
  const out: string[] = [];

  const listedOn = strArr(findFinding(result, "dnsbl")?.details?.listedOn);
  if (listedOn.length) out.push(`DNS blocklists x${listedOn.length}`);

  const attacks = findFinding(result, "blocklist-de")?.details?.attacks;
  if (typeof attacks === "number" && attacks > 0) out.push(`blocklist.de x${attacks}`);

  const blocklistCount = findFinding(result, "ipsum")?.details?.blocklistCount;
  if (typeof blocklistCount === "number" && blocklistCount > 0) out.push(`IPsum x${blocklistCount}`);

  if (findFinding(result, "et-open")?.malicious === true) out.push("ET Open");

  return out;
}

/**
 * "Since <date> <sparkline> rising|stable/declining", or "" when there are
 * fewer than two snapshots to draw a trend from.
 *
 * Lifted out of buildThreatActivity, which the endpoint guards pushed to a
 * cognitive complexity of 16 against a limit of 15 (typescript:S3776). Naming
 * the direction also unnests the ternary that used to sit inside the template
 * literal (typescript:S3358).
 */
function reputationTrend(history: CheckResult["history"]): string {
  const snapshots = history ?? [];
  const oldest = snapshots[0];
  const newest = snapshots.at(-1);
  if (snapshots.length < 2 || !oldest || !newest) return "";
  const direction =
    newest.riskScore > oldest.riskScore ? "rising" : "stable/declining";
  const spark = sparkline(snapshots.map((h) => h.riskScore));
  return `Since ${isoDate(oldest.checkedAt)} ${spark} ${direction}`;
}

export function buildThreatActivity(result: CheckResult): DossierGroup | null {
  const gn = findFinding(result, "greynoise");
  const scanning =
    gn?.malicious === true || gn?.categories?.includes("internet-scanner")
      ? gn?.summary || gn?.categories?.join(", ") || "Observed scanning"
      : "";

  const tf = findFinding(result, "threatfox");
  // `categories` is [...threatTypes, ...malwares, ...tags], so threat types
  // (botnet_cc, payload_delivery) can crowd real family names out of a plain
  // slice(0, 3). `details.malware` is the adapter's own deduped, printable
  // malware-family list — prefer it, falling back to the old behavior only
  // when it is absent.
  const tfMalware = strArr(tf?.details?.malware);
  const malware = (tfMalware.length ? tfMalware : (tf?.categories ?? []))
    .slice(0, 3)
    .join(", ");

  const feodo = findFinding(result, "feodo");
  const c2 = feodo?.malicious === true ? `${str(feodo.details?.malware) ?? "Botnet"} C2` : "";

  const listed = blocklistEvidence(result);

  // DShield is the only source that dates a listing across many feeds at once,
  // and "is this still live" is the question the listing row cannot answer.
  const ds = findFinding(result, "dshield")?.details;
  const feeds = strArr(ds?.feeds);
  const feedFirst = str(ds?.feedFirstSeen);
  const feedLast = str(findFinding(result, "dshield")?.lastSeen);
  const tracked =
    feeds.length && feedFirst && feedLast
      ? `${count(feeds.length, "feed")}, ${isoDate(feedFirst)} to ${isoDate(feedLast)}`
      : "";

  const { threat: shodanThreatTags } = shodanTagSplit(result);
  const hostTags = shodanThreatTags.length ? shodanThreatTags.join(", ") : "";

  const rep = reputationTrend(result.history);

  return group("threat", "Threat activity", [
    scanning ? { label: "Observed activity", value: scanning } : null,
    malware ? { label: "Malware association", value: malware } : null,
    c2 ? { label: "Command and control", value: c2 } : null,
    listed.length ? { label: "Blocklist listings", value: listed.join(", ") } : null,
    tracked
      ? { label: "Feed history", value: tracked, hint: feeds.join(", "), mono: true }
      : null,
    hostTags ? { label: "Flagged host tags", value: hostTags } : null,
    rep ? { label: "Reputation history", value: rep, mono: true } : null,
  ]);
}

export function buildRelationships(result: CheckResult): DossierGroup | null {
  const rev = findFinding(result, "reverse-ip")?.details;
  const domainCount = typeof rev?.domainCount === "number" ? rev.domainCount : 0;
  const example = strArr(rev?.domains)[0];
  const eg = example ? `, e.g. ${example}` : "";
  const pdnsCount = result.passiveDns?.length ?? 0;
  const related = relationsFor(result).related.length;

  return group("relationships", "Relationships", [
    domainCount
      ? {
          label: "Hosted domains",
          value: `${domainCount} domain${domainCount === 1 ? "" : "s"}${eg}`,
        }
      : null,
    pdnsCount
      ? { label: "Passive DNS", value: `${pdnsCount} historical resolution${pdnsCount === 1 ? "" : "s"}` }
      : null,
    related
      ? { label: "Related indicators", value: count(related, "linked IOC") }
      : null,
  ]);
}

export function buildIpDossier(result: CheckResult): IpDossier {
  const groups = [
    buildHostClassification(result),
    buildExposedServices(result),
    buildThreatActivity(result),
    buildRelationships(result),
    buildNetworkProvenance(result),
  ].filter((g): g is DossierGroup => g !== null);

  const responded = result.sources.filter((s) => s.status === "ok").length;
  const footer = `Enriched from ${responded} source${responded === 1 ? "" : "s"}, checked ${new Date(
    result.checkedAt,
  ).toLocaleString()}`;

  return { groups, footer };
}
