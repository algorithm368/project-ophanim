import {
  capped,
  certTime,
  lane,
  MAX_LISTED,
  num,
  obj,
  str,
  type ScanDetail,
  type ScanRedirect,
} from "./detail";

/** Hostname of a URL, or undefined when it will not parse. */
function hostOf(value: unknown): string | undefined {
  const url = str(value);
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Cloudflare has no data.redirects: the chain is consecutive history entries,
 *  so N entries mean N-1 hops and a single entry means no redirect at all. */
function chainFromHistory(history: unknown): ScanRedirect[] {
  if (!Array.isArray(history)) return [];
  const hops: ScanRedirect[] = [];
  for (let i = 0; i + 1 < history.length && hops.length < MAX_LISTED; i++) {
    const from = str(obj(history[i]).url);
    const to = str(obj(history[i + 1]).url);
    if (from && to) {
      hops.push({ from, to, status: num(obj(history[i]).statusCode) });
    }
  }
  return hops;
}

/**
 * Cloudflare result into the shared `ScanDetail`.
 *
 * A second adapter rather than branches inside the urlscan one: the payloads
 * agree on most block names and differ exactly where it matters, so one
 * function would be a thicket of conditionals. Two adapters into one shape keep
 * each readable, and the shape is the contract.
 */
export function distillCloudflareResult(raw: unknown): ScanDetail {
  const root = obj(raw);
  const page = obj(root.page);
  const lists = obj(root.lists);
  const data = obj(root.data);
  const stats = obj(root.stats);
  const processors = obj(obj(root.meta).processors);

  const requests = Array.isArray(data.requests) ? data.requests : [];
  const cookiesRaw = Array.isArray(data.cookies) ? data.cookies : [];
  const certsRaw = Array.isArray(lists.certificates) ? lists.certificates : [];
  const consoleRaw = Array.isArray(data.console) ? data.console : [];

  const whois = obj(obj(processors.whois).data);
  const scannedHost = str(page.domain);

  // Only the primary domain's risks describe the page under test; a
  // third-party asset's categories say nothing about it.
  const categoryRows = obj(processors.domainCategories).data;
  const primary = Array.isArray(categoryRows)
    ? categoryRows.find((row) => obj(row).isPrimary === true)
    : undefined;
  const primaryRisks = obj(primary).risks;
  const riskCategories = Array.isArray(primaryRisks)
    ? primaryRisks
        .map((risk) => str(obj(risk).name))
        .filter((name): name is string => Boolean(name))
    : undefined;

  const rankRows = obj(processors.radarRank).data;
  const radarRankBucket = Array.isArray(rankRows)
    ? str(obj(rankRows[0]).bucket)
    : undefined;

  const dnsRows = obj(processors.dns).data;
  const dnssecValid = Array.isArray(dnsRows)
    ? obj(dnsRows[0]).dnssec_valid === true
    : undefined;

  const robotsRows = obj(processors.robotsTxt).data;
  const siblingDomains = Array.isArray(robotsRows)
    ? [
        ...new Set(
          robotsRows
            .flatMap((row) => {
              const sitemaps = obj(row).sitemaps;
              return Array.isArray(sitemaps) ? sitemaps : [];
            })
            .map(hostOf)
            .filter(
              (host): host is string => Boolean(host) && host !== scannedHost,
            ),
        ),
      ]
    : undefined;

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
    domain: scannedHost,
    apexDomain: str(page.apexDomain),

    // Cloudflare reports no domainAgeDays; the WHOIS creation date below is the
    // better signal anyway, since it is an instant rather than a rounded count.
    tlsIssuer: str(page.tlsIssuer),
    tlsValidFrom: str(page.tlsValidFrom),
    tlsValidDays: num(page.tlsValidDays),
    tlsAgeDays: num(page.tlsAgeDays),

    requestCount: requests.length,
    securePercentage: num(stats.securePercentage),
    maliciousRequestCount: num(stats.malicious),

    redirects: chainFromHistory(page.history),
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

    // Cloudflare publishes one lane. The urlscan-only lanes stay unset rather
    // than being invented as false, which would read as a scanner's verdict.
    verdicts: {
      overall: lane(obj(root.verdicts).overall) ?? { malicious: false },
    },

    registrar: str(whois.registrar),
    domainCreated: str(whois.created_date),
    domainExpires: str(whois.expiration_date),
    nameservers: Array.isArray(whois.nameservers)
      ? (whois.nameservers as string[]).slice(0, MAX_LISTED)
      : undefined,
    riskCategories,
    radarRankBucket,
    domStructHash: str(page.domStructHash),
    siblingDomains,
    dnssecValid,

    absent: [],
  };

  const emptyChecks: [string, boolean][] = [
    ["requests", requests.length === 0],
    ["cookies", cookiesRaw.length === 0],
    ["certificates", certsRaw.length === 0],
    ["console output", consoleRaw.length === 0],
    ["page links", (linkDomains.total ?? 0) === 0],
  ];
  detail.absent = emptyChecks.filter(([, empty]) => empty).map(([name]) => name);

  return detail;
}
