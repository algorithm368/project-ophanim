import type {
  AnyCheckResult,
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
  IndicatorType,
  PassiveDnsRecord,
  RelatedIndicator,
} from "@/lib/ti/types";
import { parseIPv4 } from "@/lib/ip";

/** A non-routable IPv4 (loopback / RFC1918 / CGNAT / …) is never a useful pivot;
 *  sandbox + reputation feeds sometimes report 127.0.0.1 and the like. Domains
 *  and IPv6 are always kept. */
function isRoutableRelation(r: RelatedIndicator): boolean {
  if (r.type !== "ip") return true;
  const p = parseIPv4(r.value);
  return !p || (!p.isPrivate && !p.isReserved);
}

export type { IndicatorType, RelatedIndicator };

function isDomainResult(
  r: AnyCheckResult,
): r is DomainCheckResult {
  return "domain" in r;
}

function isHashResult(
  r: AnyCheckResult,
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

/**
 * Merge relations that point at the same value (case-insensitive), preserving
 * first-seen order. Unlike `dedupe`, this keeps corroboration: it unions the
 * reporting `sources` across duplicates and recomputes the trust tier. A pivot
 * is `confirmed` when any contributor already marked it confirmed (e.g. Triage
 * extracted it from the malware config) or when two or more distinct sources
 * report it; otherwise it stays `observed`. Relations with no tier at all (DNS /
 * infra pivots on IP/domain results) pass through untiered.
 */
export function mergeRelations(nodes: RelatedIndicator[]): RelatedIndicator[] {
  const byKey = new Map<string, RelatedIndicator>();
  const order: string[] = [];
  for (const n of nodes) {
    const key = n.value.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      order.push(key);
      byKey.set(key, { ...n, sources: n.sources ? [...n.sources] : undefined });
      continue;
    }
    // Union sources.
    if (n.sources?.length) {
      const merged = new Set([...(existing.sources ?? []), ...n.sources]);
      existing.sources = [...merged];
    }
    // Keep the first non-empty relation label.
    if (!existing.relation && n.relation) existing.relation = n.relation;
    // Strongest tier wins: confirmed > observed > undefined.
    if (n.tier === "confirmed") existing.tier = "confirmed";
    else if (n.tier === "observed" && existing.tier !== "confirmed")
      existing.tier = "observed";
  }
  // Promote to confirmed when corroborated by two or more distinct sources.
  const out: RelatedIndicator[] = [];
  for (const key of order) {
    const rel = byKey.get(key)!;
    if (rel.tier && (rel.sources?.length ?? 0) >= 2) rel.tier = "confirmed";
    out.push(rel);
  }
  return out;
}

/** Passive-DNS resolutions as pivots: for an IP lookup the records are domains
 *  (relation "hosted"); for a domain lookup they are IPs (relation "resolved"). */
function passiveDnsRelations(
  records: PassiveDnsRecord[] | undefined,
  cap = 12,
): RelatedIndicator[] {
  const out: RelatedIndicator[] = [];
  for (const r of (records ?? []).slice(0, cap)) {
    out.push({
      value: r.value,
      type: r.type,
      relation: r.type === "domain" ? "hosted" : "resolved",
    });
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
  out.push(...passiveDnsRelations(result.passiveDns));
  return dedupe(out);
}

export function domainRelations(result: DomainCheckResult): RelatedIndicator[] {
  const ctx = result.context;
  const out: RelatedIndicator[] = [];
  for (const ip of (ctx?.resolvedIps ?? []).slice(0, 6))
    out.push({ value: ip, type: "ip", relation: "A" });
  for (const v6 of (ctx?.ipv6 ?? []).slice(0, 6))
    out.push({ value: v6, type: "ip", relation: "AAAA" });
  for (const cn of (ctx?.cname ?? []).slice(0, 4))
    out.push({ value: cn, type: "domain", relation: "CNAME" });
  for (const ns of (ctx?.nameservers ?? []).slice(0, 4))
    out.push({ value: ns, type: "domain", relation: "NS" });
  for (const mx of (ctx?.mx ?? []).slice(0, 4))
    out.push({ value: mx, type: "domain", relation: "MX" });
  for (const ptr of (ctx?.reverse ?? []).slice(0, 4))
    out.push({ value: ptr, type: "domain", relation: "rDNS" });
  out.push(...passiveDnsRelations(result.passiveDns));
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
  result: AnyCheckResult,
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
  result: AnyCheckResult,
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
  // Merge context-derived + source-contributed relations by lowercased value
  // (unioning sources + tier for corroboration), then drop any entry that points
  // back at the focus itself.
  const focusKey = value.toLowerCase();
  const merged = mergeRelations([
    ...contextual,
    ...sourceRelations(result),
  ]).filter((r) => r.value.toLowerCase() !== focusKey && isRoutableRelation(r));
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
  communicating: {
    label: "Communicating samples",
    description: "Malware samples seen communicating with this indicator",
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
  sharedCert: {
    label: "Shares a certificate (SAN)",
    description: "Other domains named on a certificate with this one",
  },
  A: {
    label: "Resolves to (A)",
    description: "IP addresses this domain resolves to",
  },
  AAAA: {
    label: "Resolves to (AAAA)",
    description: "IPv6 addresses this domain resolves to",
  },
  CNAME: {
    label: "Canonical name (CNAME)",
    description: "Canonical hostnames this domain points to",
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
  "communicating",
  "similar",
  "distribution",
  "hosted",
  "A",
  "AAAA",
  "resolved",
  "CNAME",
  "NS",
  "MX",
  "rDNS",
  "host",
  "sharedCert",
];

/** A file's other digests are shown in the profile card, not as "connections". */
export const DIGEST_RELATIONS = new Set(["MD5", "SHA-1", "SHA-256"]);

/** Short relation label for the tiered hash table (the tier column already
 *  distinguishes confirmed C2 from observed contact). Falls back to the raw
 *  relation string. */
export const RELATION_SHORT: Record<string, string> = {
  contacts: "C2 / network",
  communicating: "communicating",
  drops: "drops",
  parent: "parent sample",
  similar: "similar sample",
  distribution: "distribution",
};

const TIER_RANK: Record<string, number> = { confirmed: 0, observed: 1 };

/** Order relations for the SIEM-style hash table: confirmed tier first, then
 *  observed, then untiered; within a tier by RELATION_ORDER, then value. Does
 *  not mutate the input. */
export function sortRelationsForTable(
  related: RelatedIndicator[],
): RelatedIndicator[] {
  const relRank = (r: string) => {
    const i = RELATION_ORDER.indexOf(r);
    return i === -1 ? RELATION_ORDER.length : i;
  };
  return [...related].sort((a, b) => {
    const ta = TIER_RANK[a.tier ?? ""] ?? 2;
    const tb = TIER_RANK[b.tier ?? ""] ?? 2;
    if (ta !== tb) return ta - tb;
    const ra = relRank(a.relation);
    const rb = relRank(b.relation);
    if (ra !== rb) return ra - rb;
    return a.value.localeCompare(b.value);
  });
}
