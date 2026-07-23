// Pure data builder for the IP Dossier card: turns an already-fetched
// CheckResult into a small set of self-hiding groups/fields for display.
// No network, no I/O, no React here — see components for rendering.
import type { CheckResult, GeoContext, SourceResult } from "./types";
import { cloudProvider } from "./cloud";
import { shodanHostInfo, PORT_SERVICE } from "./shodan";
import { cpeLabel } from "@/lib/cpe";

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

export function buildHostClassification(result: CheckResult): DossierGroup | null {
  const geo = result.geo;
  const gn = findFinding(result, "greynoise");
  const riot = gn?.details?.riot === true ? (gn?.details?.actor as string | undefined) : undefined;
  const cloud = cloudProvider(geo?.asn, geo?.asnOrg);

  const tor = findFinding(result, "tor-project");
  const anon = tor?.categories?.includes("tor-exit")
    ? "Tor exit node"
    : tor?.categories?.includes("tor-relay")
      ? "Tor relay"
      : "";

  const ptr = geo?.reverse
    ? geo.fcrdns?.verified
      ? `${geo.reverse} (FCrDNS verified)`
      : geo.reverse
    : "";

  return group("classification", "Host classification", [
    { label: "Assignment type", value: assignmentType(geo) },
    riot ? { label: "Recognized service", value: riot } : null,
    cloud ? { label: "Cloud infrastructure", value: cloud.name } : null,
    anon ? { label: "Anonymization", value: anon } : null,
    ptr ? { label: "Reverse DNS (PTR)", value: ptr, mono: true } : null,
  ]);
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function buildExposedServices(result: CheckResult): DossierGroup | null {
  const { ports, vulns, cpes, hostnames } = shodanHostInfo(result.sources);
  const shodan = findFinding(result, "shodan-internetdb");
  const tags = strArr(shodan?.details?.tags);

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

export function buildNetworkProvenance(result: CheckResult): DossierGroup | null {
  const geo = result.geo;
  const pdb = findFinding(result, "peeringdb")?.details;
  const rdap = findFinding(result, "rdap-ip")?.details;
  const ripe = findFinding(result, "ripestat")?.details;

  const asn = geo?.asn ? `${geo.asn}${geo.asnOrg ? ` ${geo.asnOrg}` : ""}` : "";
  const netClass = str(pdb?.networkClass)
    ? `${str(pdb?.networkClass)}${str(pdb?.trafficLevel) ? `, ${str(pdb?.trafficLevel)}` : ""}`
    : "";
  const org = geo?.org && geo.org !== geo.isp && geo.org !== geo.asnOrg ? geo.org : "";
  const allocation = str(rdap?.networkName)
    ? `${str(rdap?.networkName)}${str(rdap?.range) ? `, ${str(rdap?.range)}` : ""}`
    : "";
  const prefix = str(ripe?.prefix)
    ? `${str(ripe?.prefix)}${str(ripe?.rpkiStatus) ? `, RPKI ${str(ripe?.rpkiStatus)}` : ""}`
    : "";
  const abuse = str(rdap?.abuseContact)
    ? `${str(rdap?.abuseContact)}${str(rdap?.abuseOrg) ? `, ${str(rdap?.abuseOrg)}` : ""}`
    : "";

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
