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
  /** false when DoH resolvers returned differing A answer sets. */
  resolverAgreement?: boolean;
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
