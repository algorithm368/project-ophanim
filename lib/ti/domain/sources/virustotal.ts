import type {
  CertificateRecord,
  DomainContext,
  RelatedIndicator,
  SourceFinding,
  TiSource,
} from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { apiKey } from "../../keys";
import { vtDefinitive } from "../../vt-verdict";
import {
  communicatingSamples,
  relationshipIds,
  resolutionIp,
  type VtRelationships,
} from "../../vt-relationships";
import { crossApexSans } from "../san-pivots";

interface VtHttpsCertificate {
  subject?: { CN?: string };
  issuer?: { O?: string; CN?: string };
  validity?: { not_before?: string; not_after?: string };
  extensions?: { subject_alternative_name?: string[] };
}

interface VtDnsRecord {
  type?: string;
  value?: string;
  flag?: number;
  tag?: string;
}

/** VT timestamps are "YYYY-MM-DD HH:MM:SS" UTC; normalize to ISO for the cert card. */
function vtCertDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The domain's last-served HTTPS cert → one normalized record, plus the SAN
 *  names split into in-apex subdomains and cross-apex shared-cert domains. */
export function vtCertificate(
  cert: VtHttpsCertificate | undefined,
  apex: string,
): {
  certificate?: CertificateRecord;
  subdomains: string[];
  sharedDomains: string[];
} {
  if (!cert) return { subdomains: [], sharedDomains: [] };
  const apexLc = apex.toLowerCase();
  const sans = [
    ...new Set(
      (cert.extensions?.subject_alternative_name ?? [])
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const subdomains = sans
    .map((n) => n.replace(/^\*\./, ""))
    .filter((n) => n !== apexLc && n.endsWith(`.${apexLc}`));
  const certificate: CertificateRecord = {
    issuer: cert.issuer?.O || cert.issuer?.CN || "Unknown CA",
    commonName: cert.subject?.CN,
    sans,
    firstSeen: vtCertDate(cert.validity?.not_before),
    notAfter: vtCertDate(cert.validity?.not_after),
  };
  return {
    certificate,
    subdomains: [...new Set(subdomains)],
    sharedDomains: crossApexSans(sans, apex),
  };
}

/** VT last_dns_records → the domain-context rows the profile card renders. */
export function vtDnsContext(records: VtDnsRecord[] | undefined): DomainContext {
  const ctx: DomainContext = {};
  const pick = (type: string) =>
    (records ?? [])
      .filter((r) => r.type === type && r.value)
      .map((r) => r.value as string);
  const a = pick("A");
  const aaaa = pick("AAAA");
  const mx = pick("MX");
  const ns = pick("NS");
  const caa = (records ?? [])
    .filter((r) => r.type === "CAA" && r.value)
    .map((r) => `${r.flag ?? 0} ${r.tag ?? "issue"} "${r.value}"`);
  const cname = pick("CNAME");
  const txt = pick("TXT");
  const soa = pick("SOA")[0];
  if (a.length) ctx.resolvedIps = [...new Set(a)];
  if (aaaa.length) ctx.ipv6 = [...new Set(aaaa)];
  if (mx.length) ctx.mx = [...new Set(mx)];
  if (ns.length) ctx.nameservers = [...new Set(ns.map((n) => n.toLowerCase()))];
  if (caa.length) ctx.caa = caa;
  if (cname.length) ctx.cname = [...new Set(cname)];
  if (txt.length) ctx.txt = txt;
  if (soa) ctx.soa = soa;
  return ctx;
}

/**
 * Passive-DNS resolved IPs + communicating malware samples from the inline
 * `?relationships=` block. Resolution items carry only an `${ip}${host_name}`
 * id (no inline attributes), so the IP is recovered by stripping the domain.
 */
export function domainRelationsFromVt(
  domain: string,
  rels: VtRelationships | undefined,
): RelatedIndicator[] {
  const resolved = relationshipIds(rels, "resolutions", 8)
    .map((id) => resolutionIp(id, domain))
    .filter((v): v is string => Boolean(v))
    .map((value) => ({ value, type: "ip" as const, relation: "resolved" }));
  return [...resolved, ...communicatingSamples(rels)];
}

interface VtDomainResponse {
  data?: {
    attributes?: {
      last_analysis_stats?: {
        harmless?: number;
        malicious?: number;
        suspicious?: number;
        undetected?: number;
        timeout?: number;
      };
      reputation?: number;
      categories?: Record<string, string>;
      registrar?: string;
      creation_date?: number;
      tags?: string[];
      last_https_certificate?: VtHttpsCertificate;
      last_dns_records?: VtDnsRecord[];
    };
    /** Inline relationship pivots fetched via the `?relationships=` param. */
    relationships?: VtRelationships;
  };
  error?: { message?: string };
}

// VT content categories are vendor-specific and messy ("searchengines",
// "Information Technology (alphaMountain.ai)"). Clean + merge them into a small
// set of human labels describing what the domain is.
const CATEGORY_ALIASES: Record<string, string> = {
  // search
  searchengines: "Search engines",
  searchenginesportals: "Search engines",
  searchenginesandportals: "Search engines",
  // it / computers
  informationtechnology: "Information technology",
  computersandtechnology: "Information technology",
  computertechnology: "Information technology",
  technology: "Information technology",
  // storage / hosting
  onlinestorage: "Online storage",
  contentserver: "Online storage",
  // news
  news: "News & media",
  newsandmedia: "News & media",
  newsmedia: "News & media",
  // media
  radiomusic: "Radio & music",
  streamingmedia: "Streaming media",
  // social
  socialnetworks: "Social networking",
  socialnetworking: "Social networking",
  // education / reference (often split across many near-identical labels)
  education: "Education & reference",
  educationreference: "Education & reference",
  educationalmaterials: "Education & reference",
  educationalinstitutions: "Education & reference",
  reference: "Education & reference",
  // commerce / finance
  shopping: "Shopping",
  ecommerce: "Shopping",
  business: "Business",
  finance: "Finance",
  financialservices: "Finance",
  // misc
  gambling: "Gambling",
  entertainment: "Entertainment",
  advertisements: "Advertising",
  advertising: "Advertising",
};

// Descriptive categories ("what it does") should outrank broad/infrastructure
// ones, so e.g. google.com leads with "Search engines" over "Information
// technology". Higher number = surfaced first; unknown labels sit in the middle.
const CATEGORY_PRIORITY: Record<string, number> = {
  "Search engines": 100,
  "Social networking": 95,
  "News & media": 90,
  Shopping: 88,
  Finance: 86,
  Gambling: 85,
  Entertainment: 80,
  "Radio & music": 78,
  "Streaming media": 78,
  "Education & reference": 75,
  "Online storage": 30,
  Advertising: 25,
  Business: 20,
  "Information technology": 10,
};
const DEFAULT_PRIORITY = 50;

function priorityOf(label: string): number {
  return CATEGORY_PRIORITY[label] ?? DEFAULT_PRIORITY;
}

/** VT vendor stats → 0-100 (domain weighting: 10× malicious + 3× suspicious). */
export function vtScore(malicious: number, suspicious: number): number {
  return Math.min(100, malicious * 10 + suspicious * 3);
}

/**
 * Drop the trailing "(vendor)" annotations VirusTotal appends to a category
 * label, e.g. "Information Technology (alphaMountain.ai)". More than one can be
 * present, so this loops.
 *
 * It replaces a regex whose lazy quantifier ran against an end anchor and so
 * backtracked super-linearly (typescript:S8786). A first attempt at a
 * deterministic character class was still flagged, because the optional leading
 * whitespace was rescanned from every offset, so this walks the string instead:
 * endsWith / lastIndexOf are each one pass.
 *
 * The one behavioural difference from the original is unbalanced input:
 * "Foo (a (b)" used to collapse to "Foo" and now yields "Foo (a", because the
 * inner group is taken on its own and the dangling "(" is left alone. VT labels
 * are balanced.
 */
function stripVendorSuffix(raw: string): string {
  let out = raw.trimEnd();
  while (out.endsWith(")")) {
    const open = out.lastIndexOf("(");
    // No opener: leave it rather than guess. (Being the last "(", `open` can
    // never have another one nested after it.)
    if (open === -1) return out;
    out = out.slice(0, open).trimEnd();
  }
  return out;
}

export function normalizeCategories(map: Record<string, string>): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const raw of Object.values(map)) {
    const cleaned = stripVendorSuffix(raw).trim().toLowerCase();
    if (!cleaned) continue;
    const key = cleaned.replace(/[^a-z0-9]/g, "");
    const label =
      CATEGORY_ALIASES[key] ?? cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    const dedupeKey = label.toLowerCase();
    const entry = counts.get(dedupeKey) ?? { label, n: 0 };
    entry.n += 1;
    counts.set(dedupeKey, entry);
  }
  return Array.from(counts.values())
    .sort(
      (a, b) =>
        priorityOf(b.label) - priorityOf(a.label) ||
        b.n - a.n ||
        a.label.localeCompare(b.label),
    )
    .map((c) => c.label)
    .slice(0, 4);
}

/** VirusTotal v3 - multi-engine domain reputation (free API key required). */
export const virusTotalDomainSource: TiSource = {
  meta: {
    id: "virustotal",
    name: "VirusTotal",
    url: "https://www.virustotal.com",
    category: "reputation",
    requiresKey: true,
    weight: 1,
    keyEnv: "VIRUSTOTAL_API_KEY",
  },
  isEnabled: () => Boolean(apiKey("VIRUSTOTAL_API_KEY")),
  async check(domain, signal): Promise<SourceFinding> {
    const key = apiKey("VIRUSTOTAL_API_KEY");
    if (!key) return { status: "skipped" };
    try {
      const headers = { "x-apikey": key };
      // Single request: resolved-IP + communicating-sample pivots ride along on
      // the main GET via ?relationships=, replacing the separate /resolutions
      // call.
      const { ok, status, data } = await getJson<VtDomainResponse>(
        `https://www.virustotal.com/api/v3/domains/${domain}?relationships=resolutions,communicating_files`,
        signal,
        headers,
      );
      if (!ok || !data?.data?.attributes) {
        return {
          status: "error",
          error: data?.error?.message ?? `HTTP ${status}`,
        };
      }

      const attr = data.data.attributes;
      const stats = attr.last_analysis_stats ?? {};
      const malicious = stats.malicious ?? 0;
      const suspicious = stats.suspicious ?? 0;
      const total =
        (stats.harmless ?? 0) +
        malicious +
        suspicious +
        (stats.undetected ?? 0) +
        (stats.timeout ?? 0);

      const score = vtScore(malicious, suspicious);
      // Content categories describe what the domain is - keep them out of the
      // threat-signal list and surface them as context instead.
      const contentCategories = normalizeCategories(attr.categories ?? {});
      const relations = domainRelationsFromVt(domain, data.data.relationships);

      // last_https_certificate -> Certificates card; last_dns_records -> the
      // domain-profile DNS rows. Both ride along on the main GET (no extra call).
      const apex = domain.toLowerCase();
      const { certificate, subdomains, sharedDomains } = vtCertificate(
        attr.last_https_certificate,
        apex,
      );
      const dnsContext = vtDnsContext(attr.last_dns_records);
      for (const value of sharedDomains)
        relations.push({ value, type: "domain", relation: "sharedCert" });

      return {
        status: "ok",
        malicious: vtDefinitive(malicious, total),
        score,
        summary: `${malicious}/${total} vendors flagged malicious${
          suspicious ? `, ${suspicious} suspicious` : ""
        }`,
        domainContext: { categories: contentCategories, ...dnsContext },
        certificates: certificate ? [certificate] : undefined,
        subdomains: subdomains.length ? subdomains : undefined,
        details: {
          maliciousVendors: malicious,
          suspiciousVendors: suspicious,
          harmlessVendors: stats.harmless ?? 0,
          totalVendors: total,
          reputation: attr.reputation,
          registrar: attr.registrar,
          categories: attr.categories,
        },
        relations: relations.length ? relations : undefined,
        raw: data,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
