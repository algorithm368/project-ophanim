export type SourceCategory =
  | "reputation"
  | "blocklist"
  | "scanner"
  | "dnsbl"
  | "context";

export type Verdict = "clean" | "low" | "suspicious" | "malicious" | "unknown";

export type SourceStatus =
  | "ok"
  | "error"
  | "timeout"
  | "skipped"
  | "rate_limited";

export type IndicatorType = "ip" | "domain" | "hash";

/** One indicator reachable from a result, with the relationship that links them. */
export interface RelatedIndicator {
  value: string;
  type: IndicatorType;
  /** Short edge label, e.g. "rDNS", "A", "hosted", "contacts". */
  relation: string;
  /** Source ids that reported this pivot, for provenance + corroboration.
   *  Unioned across sources when the same value is merged. */
  sources?: string[];
  /**
   * Trust tier for malware pivots (hash results). `confirmed` = extracted C2
   * config, or corroborated by two or more sources; `observed` = single-source
   * sandbox contact that may include benign noise. Left undefined for DNS/infra
   * relations on IP/domain results, which are not tiered.
   */
  tier?: "confirmed" | "observed";
}

export interface SourceMeta {
  id: string;
  name: string;
  url: string;
  category: SourceCategory;
  requiresKey: boolean;
  /**
   * How much this source's score counts toward the aggregate risk (0-1).
   * Higher = more authoritative/reliable for IP maliciousness. Context-only
   * sources that emit no score use 0.
   */
  weight: number;
  /** Env var that holds the API key, surfaced in the UI/docs. */
  keyEnv?: string;
  /** Per-source request timeout (ms). Falls back to the orchestrator default. */
  timeoutMs?: number;
}

/**
 * Consensus over the unfiltered DoH resolver pool for a domain's A record.
 * Context-only: describes how strongly resolvers agree on the resolved IP set,
 * never a malicious verdict. A resolver that times out is a non-vote (excluded
 * from `respondingResolvers`), not a disagreement.
 */
export interface ResolverConsensus {
  /** Resolvers that returned an answer set (empty set counts; timeout does not). */
  respondingResolvers: number;
  /** Resolvers queried. */
  totalResolvers: number;
  /** The A-record IP set returned by the plurality of responders. */
  consensusIps: string[];
  /** How many responders returned the consensus set. */
  agreeCount: number;
  /** agreeCount / respondingResolvers, 0..1. */
  confidence: number;
  /** high = all responders agree, medium = strict majority, low = otherwise. */
  bucket: "high" | "medium" | "low";
  /** Distinct answer sets with counts, most common first. */
  variants: { ips: string[]; count: number }[];
}

/** Registration + DNS context for a domain (contributed by RDAP/DNS sources). */
export interface DomainContext {
  /** Content categories - what the domain is, e.g. "Search engines" (from VirusTotal). */
  categories?: string[];
  registrar?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  /** Days since registration, when known. */
  ageDays?: number;
  /** EPP/registry status codes (e.g. clientHold, pendingDelete). */
  statuses?: string[];
  nameservers?: string[];
  /** IPv4 addresses the apex resolves to. */
  resolvedIps?: string[];
  ipv6?: string[];
  /** True when the resolver returned NXDOMAIN — the name does not exist in DNS. */
  nxdomain?: boolean;
  mx?: string[];
  /** PTR hostnames for the resolved IPs. */
  reverse?: string[];
  /** DNSSEC posture from the resolver's AD flag. */
  dnssec?: "signed" | "unsigned" | "unknown";
  txt?: string[];
  /** SPF record extracted from TXT. */
  spf?: string;
  /** DMARC record from the _dmarc subdomain. */
  dmarc?: string;
  caa?: string[];
  soa?: string;
  cname?: string[];
  /** Consensus over the unfiltered DoH resolver pool for the A record. */
  resolverConsensus?: ResolverConsensus;
}

/** File identity + malware metadata for a hash (contributed by file sources). */
export interface HashContext {
  md5?: string;
  sha1?: string;
  sha256?: string;
  /** Best-known file name. */
  fileName?: string;
  /** Other names the sample has been seen under. */
  fileNames?: string[];
  /** File type, e.g. "exe", "Win32 EXE", "PDF document". */
  fileType?: string;
  mimeType?: string;
  /** File size in bytes. */
  fileSize?: number;
  /** Malware family / signature, e.g. "Emotet". */
  malwareFamily?: string;
  /** Vendor consensus threat label, e.g. "trojan.emotet/heur". */
  threatLabel?: string;
  firstSeen?: string;
  lastSeen?: string;
  /** libmagic-style description of the file contents. */
  magic?: string;
  /** PE static import table: DLLs the binary imports, capability-revealing ones
   *  first, each with the number of functions imported from it. */
  importedDlls?: { name: string; count?: number }[];
  /** Import hash (PE imports), used to cluster related samples. */
  imphash?: string;
  /** Fuzzy hash for similarity matching. */
  ssdeep?: string;
  /** TLSH locality-sensitive hash, another similarity/clustering digest. */
  tlsh?: string;
  tags?: string[];
  /** URLs the sample has been served/downloaded from (distribution + in-the-wild). */
  distributionUrls?: string[];
  /** AV/engine detection labels, e.g. "Trojan.Win32.Emotet". */
  detectionNames?: string[];
  /** Plain-language summary of the malware family (from Malpedia). */
  familyDescription?: string;
  /** Reference URLs for deeper reading on the family (capped ~5). */
  familyRefs?: string[];
  /** High-level sandbox behaviour tags (VT vocabulary: PERSISTENCE, CRYPTO, ...),
   *  a one-glance summary of what the sample does. */
  behaviorTags?: string[];
  /** Sandbox-observed behaviors, each optionally tagged with MITRE technique ids. */
  capabilities?: { label: string; mitre?: string[] }[];
  /** Deduped ATT&CK techniques observed for this sample. */
  mitreTechniques?: { id: string; name?: string; tactic?: string }[];
  /** Multi-engine detection tally, for a first-class confidence number. */
  detectionRatio?: { malicious: number; total: number };
  /**
   * Sandbox-observed runtime artifacts, grouped for a readable "what it did"
   * readout. Each group is already deduped and capped by the source; strings are
   * display-only (never executed). Only VirusTotal Sandbox populates this today.
   */
  sandboxBehavior?: {
    /** Which sandbox produced the summary, when singular. */
    sandboxName?: string;
    /** Processes spawned and command lines executed. */
    commands?: string[];
    /** Files dropped or written to disk. */
    files?: string[];
    /** Registry keys created/set (persistence, config). */
    registry?: string[];
    /** Network contacted during detonation (dns / ip:port / url). */
    network?: string[];
  };
}

/** One TLS certificate observed in certificate-transparency logs (e.g. crt.sh). */
export interface CertificateRecord {
  /** Issuing CA, e.g. "Let's Encrypt R3". */
  issuer: string;
  /** Leaf certificate common name. */
  commonName?: string;
  /** Subject alternative names (the dNSNames the cert covers). */
  sans: string[];
  /** Earliest validity / first-seen timestamp (ISO). */
  firstSeen?: string;
  /** Expiry (notAfter, ISO). */
  notAfter?: string;
}

/**
 * One passive-DNS resolution: a historical IP<->domain mapping observed by a
 * passive-DNS provider. For an IP lookup `value` is a domain that resolved to
 * the IP; for a domain lookup `value` is an IP the domain resolved to.
 */
export interface PassiveDnsRecord {
  value: string;
  type: "domain" | "ip";
  /** First time the mapping was observed (ISO). */
  firstSeen?: string;
  /** Most recent observation (ISO). */
  lastSeen?: string;
  /** DNS record type, e.g. "A", "AAAA", "CNAME". */
  recordType?: string;
}

export type Confidence = "high" | "medium" | "low";

/** One reconciled field: winning value + how sure we are + what else was seen. */
export interface ResolvedField<T> {
  value: T;
  /** high = providers agree, low = single provider or tie. */
  confidence: Confidence;
  /** weighted 0-1 measure that drives the tier (provider-reliability aware). */
  score: number;
  /** agreeing providers / providers that reported this field (0–1). */
  agreement: number;
  /** provider ids backing the winning value. */
  sources: string[];
  /** dissenting values, when providers disagreed. */
  alternatives?: { value: T; sources: string[] }[];
}

export interface GeoFlags {
  isHosting: boolean;
  isProxy: boolean;
  isMobile: boolean;
  /** flag name -> provider ids that asserted it. */
  sources: Record<string, string[]>;
}

/** Forward-confirmed reverse DNS result for an IP. */
export interface FcrdnsResult {
  hostname: string;
  /** PTR host forward-resolves back to the original IP. */
  verified: boolean;
}

/** Reconciled geolocation. Each estimated field carries confidence. */
export interface GeoResolution {
  country?: ResolvedField<string>;
  /** ISO code paired with the winning country value. */
  countryCode?: string;
  region?: ResolvedField<string>;
  city?: ResolvedField<string>;
  coordinates?: ResolvedField<{ lat: number; lon: number }>;
  asn?: ResolvedField<string>;
  asnOrg?: ResolvedField<string>;
  isp?: ResolvedField<string>;
  flags: GeoFlags;
  /** how many providers returned any geo at all. */
  providerCount: number;
  /** blended confidence across the located fields. */
  overall?: { score: number; confidence: Confidence };
}

export interface GeoContext {
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  lat?: number;
  lon?: number;
  asn?: string;
  asnOrg?: string;
  isp?: string;
  org?: string;
  reverse?: string;
  isHosting?: boolean;
  isProxy?: boolean;
  isMobile?: boolean;
  /** Forward-confirmed reverse DNS (contributed by the reverse-dns source). */
  fcrdns?: FcrdnsResult;
}

/** Normalized output produced by a source adapter's check(). */
export interface SourceFinding {
  status: SourceStatus;
  error?: string;
  /** Definitive malicious listing (e.g. present on a botnet C2 blocklist). */
  malicious?: boolean;
  /** Normalized 0-100 risk contribution. */
  score?: number;
  /** 0-100 confidence in the score. */
  confidence?: number;
  /** An authoritative allowlist explicitly vouches for this indicator
   *  (e.g. Maltiverse "whitelist", Hybrid-Analysis whitelisted, AbuseIPDB
   *  isWhitelisted). Read by aggregateRisk() to suppress a weak floor. */
  allowlisted?: boolean;
  categories?: string[];
  lastSeen?: string;
  /** Human-readable one-liner. */
  summary?: string;
  /** Normalized extra fields worth surfacing in the UI. */
  details?: Record<string, unknown>;
  /** Original upstream payload. */
  raw?: unknown;
  /** Geo/ASN context (contributed by context sources like ip-api). */
  geo?: GeoContext;
  /** Registration/DNS context (contributed by RDAP/DNS sources). */
  domainContext?: DomainContext;
  /** File identity/malware context (contributed by file-hash sources). */
  hashContext?: HashContext;
  /**
   * Related indicators discovered while looking up this one (e.g. VirusTotal
   * "resolutions" giving the domains a IP has hosted). The graph layer collects
   * these across all sources and dedupes with the context-derived relations.
   */
  relations?: RelatedIndicator[];
  /** TLS certificates observed for this indicator (certificate transparency). */
  certificates?: CertificateRecord[];
  /** Subdomains discovered for a domain (e.g. from certificate SAN lists). */
  subdomains?: string[];
  /** Passive-DNS resolutions (historical IP<->domain mappings). */
  passiveDns?: PassiveDnsRecord[];
}

export interface SourceResult extends SourceFinding {
  source: SourceMeta;
  enabled: boolean;
  durationMs: number;
}

export interface CheckStats {
  total: number;
  queried: number;
  flagged: number;
  skipped: number;
  errored: number;
  /** Sources that hit a provider quota (HTTP 429 / "limit exceeded"), kept
   *  separate from genuine errors and from the consensus count. */
  rateLimited: number;
}

/** One point in an indicator's reputation history, recorded per fresh check. */
export interface HistorySnapshot {
  checkedAt: string;
  riskScore: number;
  verdict: Verdict;
}

/** The intermediates aggregateRisk() used to reach a score, so the narrative
 *  and UI can explain the verdict without re-deriving them. */
export interface ScoreBreakdown {
  /** Strongest weighted single signal (score * weight), rounded. */
  effectiveMax: number;
  /** Weighted consensus across scoring sources, rounded. */
  weightedAvg: number;
  /** Source id behind effectiveMax. */
  dominantSourceId?: string;
  /** A hard-listing floor actually raised the score above the blend. */
  floorApplied: boolean;
  /** Source id whose listing set the floor (only when floorApplied). */
  flooredBy?: string;
  /** The floor value applied (e.g. 75 or 50). */
  floorValue?: number;
  /** riskScore sits within BORDERLINE_BAND of a verdict cutoff. */
  borderline: boolean;
  /** A floor was withheld because an allowlist vouched for the indicator. */
  allowlistSuppressed: boolean;
  /** A forced-benign override fired (e.g. "eicar-test-file"). */
  benignOverride?: string;
}

export interface CheckResult {
  ip: string;
  checkedAt: string;
  riskScore: number;
  verdict: Verdict;
  geo?: GeoContext;
  /** Multi-provider reconciled geo with per-field confidence. */
  geoResolution?: GeoResolution;
  /** Passive-DNS resolutions: domains historically hosted on this IP. */
  passiveDns?: PassiveDnsRecord[];
  sources: SourceResult[];
  stats: CheckStats;
  /** Past reputation snapshots (oldest to newest), for the history timeline. */
  history?: HistorySnapshot[];
  /** True when this response was served from the cache rather than freshly computed. */
  cached?: boolean;
  /** How the aggregate score was reached, for the narrative + verdict UI. */
  scoreBreakdown?: ScoreBreakdown;
}

export interface DomainCheckResult {
  domain: string;
  checkedAt: string;
  riskScore: number;
  verdict: Verdict;
  context?: DomainContext;
  /** TLS certificates from certificate transparency (crt.sh). */
  certificates?: CertificateRecord[];
  /** Subdomains discovered (certificate SANs, etc.). */
  subdomains?: string[];
  /** Passive-DNS resolutions: IPs this domain has historically resolved to. */
  passiveDns?: PassiveDnsRecord[];
  sources: SourceResult[];
  stats: CheckStats;
  /** Past reputation snapshots (oldest to newest), for the history timeline. */
  history?: HistorySnapshot[];
  /** True when this response was served from the cache rather than freshly computed. */
  cached?: boolean;
  /** How the aggregate score was reached, for the narrative + verdict UI. */
  scoreBreakdown?: ScoreBreakdown;
}

export interface HashCheckResult {
  hash: string;
  algorithm: "md5" | "sha1" | "sha256";
  checkedAt: string;
  riskScore: number;
  verdict: Verdict;
  context?: HashContext;
  sources: SourceResult[];
  stats: CheckStats;
  /** Past reputation snapshots (oldest to newest), for the history timeline. */
  history?: HistorySnapshot[];
  /** True when this response was served from the cache rather than freshly computed. */
  cached?: boolean;
  /** How the aggregate score was reached, for the narrative + verdict UI. */
  scoreBreakdown?: ScoreBreakdown;
}

/** Narrow a result union by the indicator field unique to each type. */
export function isDomainResult(
  r: CheckResult | DomainCheckResult | HashCheckResult,
): r is DomainCheckResult {
  return "domain" in r;
}

export function isHashResult(
  r: CheckResult | DomainCheckResult | HashCheckResult,
): r is HashCheckResult {
  return "hash" in r;
}

export interface TiSource {
  meta: SourceMeta;
  /** True when the source can run (key present, or no key required). */
  isEnabled(): boolean;
  /** Perform the lookup. Must honor the abort signal for timeouts. */
  check(ip: string, signal: AbortSignal): Promise<SourceFinding>;
}
