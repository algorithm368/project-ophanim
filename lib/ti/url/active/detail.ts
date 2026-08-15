/**
 * The distilled form of a urlscan result.
 *
 * Stored instead of the raw payload, for the same reason `runSource` drops
 * `raw` before returning: a busy page makes hundreds of requests and sets
 * dozens of cookies, and none of that belongs in a cache entry. What is kept is
 * what an analyst reads, plus the counts needed to say honestly how much was
 * left out.
 */

/** Longest any single list is carried at. Beyond this the count still tells the
 *  truth, so a capped list never reads as the whole set. */
export const MAX_LISTED = 40;

export interface ScanCookie {
  name: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
}

/** One hop of the redirect chain. Phishing routinely arrives through several,
 *  and the hop list is often more telling than the destination. */
export interface ScanRedirect {
  from: string;
  to: string;
  status?: number;
}

export interface ScanCertificate {
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
}

export interface ScanVerdictLane {
  malicious: boolean;
  score?: number;
  categories?: string[];
  brands?: string[];
  tags?: string[];
  /** engines lane only */
  enginesTotal?: number;
  maliciousTotal?: number;
  /** community lane only */
  votesTotal?: number;
}

export interface ScanDetail {
  finalUrl?: string;
  title?: string;
  httpStatus?: string;
  mimeType?: string;
  server?: string;
  ip?: string;
  asn?: string;
  asnName?: string;
  country?: string;
  city?: string;
  domain?: string;
  apexDomain?: string;

  /** Age of the name and of its certificate. A domain registered days ago
   *  serving a certificate issued days ago is the cheapest strong phishing
   *  signal there is, and no passive source in this project reports it. */
  domainAgeDays?: number;
  apexDomainAgeDays?: number;
  tlsIssuer?: string;
  tlsValidFrom?: string;
  tlsValidDays?: number;
  tlsAgeDays?: number;
  /** Cisco Umbrella popularity rank, when the site is ranked at all. */
  umbrellaRank?: number;

  /** How much the page pulled in, and how much of it over TLS. */
  requestCount: number;
  securePercentage?: number;
  maliciousRequestCount?: number;

  redirects?: ScanRedirect[];
  domains?: string[];
  ips?: string[];
  asns?: string[];
  countries?: string[];
  servers?: string[];
  linkDomains?: string[];
  linkDomainCount?: number;
  cookies?: ScanCookie[];
  certificates?: ScanCertificate[];
  consoleMessages?: string[];

  verdicts: {
    overall: ScanVerdictLane;
    engines?: ScanVerdictLane;
    community?: ScanVerdictLane;
  };

  /** WHOIS registrar. Cloudflare only. */
  registrar?: string;
  /** WHOIS creation date, ISO. Cloudflare only, and a sharper signal than a
   *  rounded age in days: a domain created hours ago is unmistakable. */
  domainCreated?: string;
  /** WHOIS expiry, ISO. Cloudflare only. */
  domainExpires?: string;
  /** Authoritative nameservers from WHOIS. Cloudflare only. */
  nameservers?: string[];
  /** Cloudflare's own risk categories for the primary domain, e.g.
   *  "Newly Seen Domains". Cloudflare only. */
  riskCategories?: string[];
  /** Radar popularity bucket, e.g. ">200000". Cloudflare only. */
  radarRankBucket?: string;
  /** Hash of the DOM structure, for clustering pages built from one kit.
   *  Cloudflare only. */
  domStructHash?: string;
  /** Other hosts named by the site's robots.txt sitemaps. Cloudflare only. */
  siblingDomains?: string[];
  /** Whether the first DNS answer validated under DNSSEC. Cloudflare only. */
  dnssecValid?: boolean;

  /** Blocks the scan did not report, named so an empty section is never shown
   *  as if it were an observation of absence. */
  absent: string[];
}

type Json = Record<string, unknown>;

// The readers below are exported for the Cloudflare adapter, which reads a
// payload shaped like this one in most blocks and unlike it in a few. Sharing
// the readers keeps the two adapters honest about producing the same ScanDetail.
export function obj(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Cap a list, reporting its true length alongside. */
export function capped(value: unknown): { items?: string[]; total?: number } {
  if (!Array.isArray(value) || value.length === 0) return {};
  const items = value.filter((v): v is string => typeof v === "string");
  return { items: items.slice(0, MAX_LISTED), total: items.length };
}

export function lane(value: unknown): ScanVerdictLane | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Json;
  return {
    malicious: v.malicious === true,
    score: num(v.score),
    categories: Array.isArray(v.categories) ? (v.categories as string[]) : undefined,
    brands: Array.isArray(v.brands) ? (v.brands as string[]) : undefined,
    tags: Array.isArray(v.tags) ? (v.tags as string[]) : undefined,
    enginesTotal: num(v.enginesTotal),
    maliciousTotal: num(v.maliciousTotal),
    votesTotal: num(v.votesTotal),
  };
}

/** Unix seconds to ISO, tolerating the seconds/millis ambiguity in the feed. */
export function certTime(value: unknown): string | undefined {
  const seconds = num(value);
  if (seconds === undefined) return undefined;
  return new Date(seconds * 1000).toISOString();
}

export function distillResult(raw: unknown): ScanDetail {
  const root = obj(raw);
  const page = obj(root.page);
  const lists = obj(root.lists);
  const data = obj(root.data);
  const stats = obj(root.stats);
  const verdicts = obj(root.verdicts);

  const requests = Array.isArray(data.requests) ? data.requests : [];
  const cookiesRaw = Array.isArray(data.cookies) ? data.cookies : [];
  const certsRaw = Array.isArray(lists.certificates) ? lists.certificates : [];
  const consoleRaw = Array.isArray(data.console) ? data.console : [];
  const redirectsRaw = Array.isArray(data.redirects) ? data.redirects : [];

  const linkDomains = capped(lists.linkDomains);

  const detail: ScanDetail = {
    finalUrl: str(page.url),
    title: str(page.title),
    httpStatus: str(page.status),
    mimeType: str(page.mimeType),
    server: str(page.server),
    ip: str(page.ip),
    asn: str(page.asn),
    asnName: str(page.asnname),
    country: str(page.country),
    city: str(page.city),
    domain: str(page.domain),
    apexDomain: str(page.apexDomain),

    domainAgeDays: num(page.domainAgeDays),
    apexDomainAgeDays: num(page.apexDomainAgeDays),
    tlsIssuer: str(page.tlsIssuer),
    tlsValidFrom: str(page.tlsValidFrom),
    tlsValidDays: num(page.tlsValidDays),
    tlsAgeDays: num(page.tlsAgeDays),
    umbrellaRank: num(page.umbrellaRank),

    requestCount: requests.length,
    securePercentage: num(stats.securePercentage),
    maliciousRequestCount: num(stats.malicious),

    // Shape verified against a real result: {from, to, status}, not {url}.
    redirects: redirectsRaw
      .slice(0, MAX_LISTED)
      .map((r) => {
        const hop = obj(r);
        return {
          from: str(hop.from) ?? "",
          to: str(hop.to) ?? "",
          status: num(hop.status),
        };
      })
      .filter((hop) => hop.from !== "" && hop.to !== ""),
    domains: capped(lists.domains).items,
    ips: capped(lists.ips).items,
    asns: capped(lists.asns).items,
    countries: capped(lists.countries).items,
    servers: capped(lists.servers).items,
    linkDomains: linkDomains.items,
    linkDomainCount: linkDomains.total,

    cookies: cookiesRaw.slice(0, MAX_LISTED).map((c) => {
      const cookie = obj(c);
      return {
        name: str(cookie.name) ?? "",
        domain: str(cookie.domain),
        secure: cookie.secure === true,
        httpOnly: cookie.httpOnly === true,
      };
    }),
    certificates: certsRaw.slice(0, MAX_LISTED).map((c) => {
      const cert = obj(c);
      return {
        subject: str(cert.subjectName),
        issuer: str(cert.issuer),
        validFrom: certTime(cert.validFrom),
        validTo: certTime(cert.validTo),
      };
    }),
    consoleMessages: consoleRaw
      .slice(0, MAX_LISTED)
      .map((entry) => str(obj(obj(entry).message).text) ?? str(obj(entry).text))
      .filter((m): m is string => Boolean(m)),

    verdicts: {
      overall: lane(verdicts.overall) ?? { malicious: false },
      engines: lane(verdicts.engines),
      community: lane(verdicts.community),
    },

    absent: [],
  };

  // Naming the empty blocks is the point: an absent section must not be
  // rendered as though the scanner had looked and found nothing.
  const emptyChecks: [string, boolean][] = [
    ["requests", requests.length === 0],
    ["cookies", cookiesRaw.length === 0],
    ["certificates", certsRaw.length === 0],
    ["console output", consoleRaw.length === 0],
    ["page links", (linkDomains.total ?? 0) === 0],
    ["redirects", redirectsRaw.length === 0],
  ];
  detail.absent = emptyChecks.filter(([, empty]) => empty).map(([name]) => name);

  return detail;
}
