import type {
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
  IndicatorType,
  RelatedIndicator,
} from "@/lib/ti/types";

export type { IndicatorType, RelatedIndicator };

function isDomainResult(
  r: CheckResult | DomainCheckResult | HashCheckResult,
): r is DomainCheckResult {
  return "domain" in r;
}

function isHashResult(
  r: CheckResult | DomainCheckResult | HashCheckResult,
): r is HashCheckResult {
  return "hash" in r;
}

function dedupe(nodes: RelatedIndicator[]): RelatedIndicator[] {
  const seen = new Set<string>();
  const out: RelatedIndicator[] = [];
  for (const n of nodes) {
    const key = n.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/** Hostnames Shodan InternetDB reports for an IP (PTR + observed vhosts). */
function shodanHostnames(result: CheckResult): string[] {
  const d = (result.sources.find((s) => s.source.id === "shodan-internetdb")
    ?.details ?? {}) as Record<string, unknown>;
  const v = d.hostnames;
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

export function ipRelations(result: CheckResult): RelatedIndicator[] {
  const out: RelatedIndicator[] = [];
  if (result.geo?.reverse)
    out.push({ value: result.geo.reverse, type: "domain", relation: "rDNS" });
  for (const h of shodanHostnames(result).slice(0, 6))
    out.push({ value: h, type: "domain", relation: "host" });
  return dedupe(out);
}

export function domainRelations(result: DomainCheckResult): RelatedIndicator[] {
  const ctx = result.context;
  const out: RelatedIndicator[] = [];
  for (const ip of (ctx?.resolvedIps ?? []).slice(0, 6))
    out.push({ value: ip, type: "ip", relation: "A" });
  for (const ns of (ctx?.nameservers ?? []).slice(0, 4))
    out.push({ value: ns, type: "domain", relation: "NS" });
  for (const mx of (ctx?.mx ?? []).slice(0, 4))
    out.push({ value: mx, type: "domain", relation: "MX" });
  return dedupe(out);
}

export function hashRelations(result: HashCheckResult): RelatedIndicator[] {
  const ctx = result.context;
  const digests: [string, string | undefined][] = [
    ["MD5", ctx?.md5],
    ["SHA-1", ctx?.sha1],
    ["SHA-256", ctx?.sha256],
  ];
  const out: RelatedIndicator[] = [];
  for (const [label, v] of digests)
    if (v && v.toLowerCase() !== result.hash.toLowerCase())
      out.push({ value: v, type: "hash", relation: label });
  return dedupe(out);
}

/** Relations contributed by each source's lookup (e.g. VirusTotal resolutions). */
function sourceRelations(
  result: CheckResult | DomainCheckResult | HashCheckResult,
): RelatedIndicator[] {
  const out: RelatedIndicator[] = [];
  for (const s of result.sources) {
    if (s.status !== "ok" || !s.relations) continue;
    for (const r of s.relations) out.push(r);
  }
  return out;
}

/** The focused indicator's own value + type, plus every indicator it links to. */
export function relationsFor(
  result: CheckResult | DomainCheckResult | HashCheckResult,
): { value: string; type: IndicatorType; related: RelatedIndicator[] } {
  let value: string;
  let type: IndicatorType;
  let contextual: RelatedIndicator[];
  if (isHashResult(result)) {
    value = result.hash;
    type = "hash";
    contextual = hashRelations(result);
  } else if (isDomainResult(result)) {
    value = result.domain;
    type = "domain";
    contextual = domainRelations(result);
  } else {
    value = result.ip;
    type = "ip";
    contextual = ipRelations(result);
  }
  // Merge context-derived + source-contributed relations, then dedupe by
  // lowercased value and drop any entry that points back at the focus itself.
  const focusKey = value.toLowerCase();
  const merged = dedupe([...contextual, ...sourceRelations(result)]).filter(
    (r) => r.value.toLowerCase() !== focusKey,
  );
  return { value, type, related: merged };
}

/** Display label + plain-language description + ordering for each relation kind,
 *  shared by the connections detail view. */
export const RELATION_META: Record<string, { label: string; description: string }> = {
  contacts: {
    label: "Contacts (C2 / network)",
    description: "C2 / network endpoints this sample contacted",
  },
  drops: { label: "Drops", description: "Files this sample dropped or downloaded" },
  parent: {
    label: "Parent samples",
    description: "Samples that bundle or drop this file",
  },
  similar: {
    label: "Similar samples",
    description: "Files structurally similar to this one",
  },
  distribution: {
    label: "Distribution hosts",
    description: "Hosts that distributed this file",
  },
  hosted: { label: "Hosted domains", description: "Domains hosted on this address" },
  A: {
    label: "Resolves to (A)",
    description: "IP addresses this domain resolves to",
  },
  resolved: {
    label: "Resolves to (passive DNS)",
    description: "IPs seen for this domain in passive DNS",
  },
  NS: {
    label: "Nameservers",
    description: "Authoritative nameservers for this domain",
  },
  MX: { label: "Mail (MX)", description: "Mail exchangers for this domain" },
  rDNS: { label: "Reverse DNS", description: "Reverse-DNS name for this address" },
  host: {
    label: "Observed hostnames",
    description: "Hostnames observed on this address",
  },
};

export const RELATION_ORDER = [
  "contacts",
  "drops",
  "parent",
  "similar",
  "distribution",
  "hosted",
  "A",
  "resolved",
  "NS",
  "MX",
  "rDNS",
  "host",
];

/** A file's other digests are shown in the profile card, not as "connections". */
export const DIGEST_RELATIONS = new Set(["MD5", "SHA-1", "SHA-256"]);

export interface RelationGroup {
  relation: string;
  label: string;
  description: string;
  items: { value: string; type: IndicatorType }[];
}

/** Shape relations for the connections detail view: drop a file's other digests,
 *  group by relation (preserving each item's type), order by RELATION_ORDER then
 *  unknown relations alphabetically, and attach the shared label/description. */
export function groupRelations(related: RelatedIndicator[]): RelationGroup[] {
  const byRelation = new Map<string, { value: string; type: IndicatorType }[]>();
  for (const r of related) {
    if (DIGEST_RELATIONS.has(r.relation)) continue;
    const items = byRelation.get(r.relation) ?? [];
    if (!items.some((i) => i.value === r.value)) {
      items.push({ value: r.value, type: r.type });
    }
    byRelation.set(r.relation, items);
  }

  const keys = [
    ...RELATION_ORDER.filter((k) => byRelation.has(k)),
    ...[...byRelation.keys()].filter((k) => !RELATION_ORDER.includes(k)).sort(),
  ];

  return keys.map((relation) => {
    const meta = RELATION_META[relation] ?? { label: relation, description: "" };
    return {
      relation,
      label: meta.label,
      description: meta.description,
      items: byRelation.get(relation) ?? [],
    };
  });
}
