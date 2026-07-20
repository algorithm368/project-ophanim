import type { IndicatorType, RelatedIndicator } from "./types";

/**
 * Helpers for VirusTotal v3 *inline* relationships (the `?relationships=` query
 * param on a main object GET). Inline relationship items carry only `type` and
 * `id` — never the full `attributes` you'd get from the dedicated relationship
 * endpoints — so everything here works off ids alone. Collapsing the old N+1
 * fan-out into a single GET keeps us well under the free key's 500/day, 4/min.
 */

interface VtRelItem {
  type?: string;
  id?: string;
}
interface VtRelList {
  data?: VtRelItem[];
}
export type VtRelationships = Record<string, VtRelList | undefined>;

/** Distinct, capped related-object ids VT returned for one relationship kind. */
export function relationshipIds(
  rels: VtRelationships | undefined,
  kind: string,
  cap = 6,
): string[] {
  const data = rels?.[kind]?.data;
  if (!Array.isArray(data)) return [];
  return [
    ...new Set(
      data
        .map((d) => d.id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ].slice(0, cap);
}

/**
 * File relationship kinds we surface as pivots. `contacted_urls` is deliberately
 * omitted: inline it returns only an opaque url-id (a sha256 of the URL) with no
 * host or URL text, so there is nothing useful to pivot on. `communicating_files`
 * is NOT a valid file relationship (VT 400s on it) — it exists only on IP/domain.
 */
const FILE_RELS: { kind: string; type: IndicatorType; relation: string }[] = [
  { kind: "contacted_ips", type: "ip", relation: "contacts" },
  { kind: "contacted_domains", type: "domain", relation: "contacts" },
  { kind: "dropped_files", type: "hash", relation: "drops" },
  { kind: "execution_parents", type: "hash", relation: "parent" },
];

/** The file's contacted/dropped/parent pivots from one inline `relationships`. */
export function fileRelationsFromVt(
  rels: VtRelationships | undefined,
  cap = 6,
): RelatedIndicator[] {
  const out: RelatedIndicator[] = [];
  for (const r of FILE_RELS)
    for (const value of relationshipIds(rels, r.kind, cap))
      out.push({
        value,
        type: r.type,
        relation: r.relation,
        sources: ["virustotal"],
        tier: "observed",
      });
  return out;
}

/** Malware samples (hashes) VT saw communicating with an IP or domain. */
export function communicatingSamples(
  rels: VtRelationships | undefined,
  cap = 6,
): RelatedIndicator[] {
  return relationshipIds(rels, "communicating_files", cap).map((value) => ({
    value,
    type: "hash" as IndicatorType,
    relation: "communicating",
  }));
}

interface VtAnalysisResult {
  category?: string;
  result?: string | null;
}

/**
 * Per-engine `last_analysis_results` → the distinct malware labels the engines
 * assigned (e.g. "Trojan.Win32.Emotet"), most-frequent first. Only "malicious"
 * verdicts carry a meaningful label; harmless/undetected entries have none.
 */
export function detectionNames(
  results: Record<string, VtAnalysisResult> | undefined,
  cap = 12,
): string[] {
  if (!results) return [];
  const counts = new Map<string, number>();
  for (const r of Object.values(results)) {
    if (r.category !== "malicious" || !r.result) continue;
    counts.set(r.result, (counts.get(r.result) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label)
    .slice(0, cap);
}

/**
 * VT resolution objects have `id = ${ip}${host_name}` (plain concatenation, no
 * separator) and carry no inline attributes, so recover the counterpart of a
 * lookup by stripping the known side.
 */
export function resolutionDomain(id: string, ip: string): string | undefined {
  if (!id.startsWith(ip)) return undefined;
  return id.slice(ip.length) || undefined;
}
export function resolutionIp(id: string, domain: string): string | undefined {
  if (!id.endsWith(domain)) return undefined;
  return id.slice(0, id.length - domain.length) || undefined;
}
