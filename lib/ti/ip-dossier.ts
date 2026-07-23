// Pure data builder for the IP Dossier card: turns an already-fetched
// CheckResult into a small set of self-hiding groups/fields for display.
// No network, no I/O, no React here — see components for rendering.
import type { CheckResult, GeoContext, SourceResult } from "./types";
import { cloudProvider } from "./cloud";

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
