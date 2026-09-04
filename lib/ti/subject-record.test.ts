import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSeen, seenRange } from "@/lib/ti/subject-record";
import type { CheckStats, SourceResult } from "@/lib/ti/types";

/** A settled source row. Every field the resolvers read is optional, so tests
 *  set only what they are about. */
export function src(opts: {
  id: string;
  status?: SourceResult["status"];
  categories?: string[];
  details?: Record<string, unknown>;
  lastSeen?: string;
  score?: number;
  malicious?: boolean;
  weight?: number;
  requiresKey?: boolean;
}): SourceResult {
  return {
    source: {
      id: opts.id,
      name: opts.id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: opts.requiresKey ?? false,
      weight: opts.weight ?? 1,
    },
    enabled: true,
    durationMs: 1,
    status: opts.status ?? "ok",
    categories: opts.categories,
    details: opts.details,
    lastSeen: opts.lastSeen,
    score: opts.score,
    malicious: opts.malicious,
  };
}

/** CheckStats is required on every result type and no resolver reads it, so
 *  the fixtures fill it honestly rather than casting around it. */
export function stats(n: number): CheckStats {
  return { total: n, queried: n, flagged: 0, skipped: 0, errored: 0, rateLimited: 0 };
}

describe("parseSeen", () => {
  // CI runs ubuntu-latest with no TZ set, i.e. UTC, where Date.parse's local-time
  // fallback for a zone-less string coincides with the UTC reading: the bug this
  // suite exists to catch cannot reproduce there. Pinning a non-UTC, non-DST zone
  // for just this block makes the local-time fallback actually disagree with UTC,
  // so deleting the ZONELESS branch in parseSeen fails these tests everywhere,
  // not only on a developer's non-UTC machine. Scoped to this describe (not the
  // file, not vitest.config.ts, not the CI workflow) so no other date-dependent
  // test changes behaviour.
  let previousTz: string | undefined;

  beforeAll(() => {
    previousTz = process.env.TZ;
    process.env.TZ = "Asia/Bangkok"; // UTC+7, no DST, so no seasonal ambiguity.
  });

  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it("reads a zone-less timestamp as UTC, not as local time", () => {
    // Onionoo's shape. Date.parse reads this as local, which is the live bug:
    // on sin1 the Tor timestamp lands seven hours out and nothing logs it.
    expect(parseSeen("2026-08-30 01:00:00")).toBe(Date.UTC(2026, 7, 30, 1, 0, 0));
  });

  it("agrees with the same instant written the URLhaus way", () => {
    expect(parseSeen("2026-08-30 01:00:00 UTC")).toBe(parseSeen("2026-08-30 01:00:00"));
  });

  it("still reads a proper ISO string with an offset", () => {
    expect(parseSeen("2026-08-30T08:00:00+07:00")).toBe(Date.UTC(2026, 7, 30, 1, 0, 0));
  });

  it("discards what it cannot place rather than rendering it", () => {
    expect(parseSeen(undefined)).toBeUndefined();
    expect(parseSeen("")).toBeUndefined();
    expect(parseSeen("not a date")).toBeUndefined();
    expect(parseSeen("1970-01-01T00:00:00Z")).toBeUndefined();
  });
});

describe("seenRange", () => {
  it("takes the latest lastSeen across sources", () => {
    const range = seenRange([
      src({ id: "abuseipdb", lastSeen: "2026-08-01T00:00:00Z" }),
      src({ id: "otx", lastSeen: "2026-08-30T00:00:00Z" }),
    ]);
    expect(range).toEqual({ first: undefined, last: "2026-08-30" });
  });

  it("finds first-seen where the two sources that carry it put it", () => {
    const range = seenRange([
      src({ id: "feodo", details: { firstSeen: "2026-02-11 09:00:00" } }),
      src({ id: "dshield", details: { feedFirstSeen: "2026-03-01" } }),
      src({ id: "otx", lastSeen: "2026-08-30T00:00:00Z" }),
    ]);
    expect(range).toEqual({ first: "2026-02-11", last: "2026-08-30" });
  });

  it("reads the hash context when one is given", () => {
    expect(
      seenRange([], { firstSeen: "2025-01-05T00:00:00Z", lastSeen: "2026-01-05T00:00:00Z" }),
    ).toEqual({ first: "2025-01-05", last: "2026-01-05" });
  });

  it("ignores a source that did not answer", () => {
    expect(
      seenRange([src({ id: "otx", status: "timeout", lastSeen: "2026-08-30T00:00:00Z" })]),
    ).toBeUndefined();
  });

  it("is undefined when nothing carries a usable date", () => {
    expect(seenRange([src({ id: "otx" })])).toBeUndefined();
  });
});

import { infraClaim } from "@/lib/ti/subject-record";
import type { CheckResult, DomainCheckResult } from "@/lib/ti/types";

function ipResult(
  sources: SourceResult[],
  geo?: CheckResult["geo"],
  geoResolution?: CheckResult["geoResolution"],
): CheckResult {
  return {
    ip: "185.220.101.42",
    checkedAt: "2026-09-03T00:00:00Z",
    riskScore: 0,
    verdict: "unknown",
    geo,
    geoResolution,
    sources,
    stats: stats(sources.length),
  } as CheckResult;
}

/** A minimal GeoResolution carrying only what the free-source guard reads:
 *  which provider ids backed the winning `asn` value. */
function geoResolutionWithAsn(backers: string[]): NonNullable<CheckResult["geoResolution"]> {
  return {
    asn: { value: "AS8075", confidence: "high", score: 1, agreement: 1, sources: backers },
    flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
    providerCount: backers.length,
  };
}

describe("infraClaim", () => {
  it("prefers the provider's own published prefix list", () => {
    const claim = infraClaim(
      ipResult(
        [
          src({
            id: "cloud-range",
            details: {
              provider: "Amazon Web Services",
              region: "eu-west-1",
              service: "EC2",
              cidr: "3.248.0.0/13",
            },
          }),
        ],
        { asn: "AS16509", asnOrg: "AMAZON-02" },
      ),
    );
    expect(claim).toEqual({
      label: "Amazon Web Services, eu-west-1, EC2",
      sources: ["cloud-range"],
    });
  });

  it("falls back to the ASN table, which is a fact", () => {
    // No geoResolution: nothing to check provenance against, so the rung is
    // allowed through rather than gutted for callers that never reconcile.
    const claim = infraClaim(ipResult([], { asn: "AS8075", asnOrg: "MICROSOFT-CORP" }));
    expect(claim).toEqual({ label: "Microsoft Azure", sources: ["asn table"] });
  });

  it("keeps the ASN table claim when a free source backs the winning asn", () => {
    // geo.asn is the winner of a weighted reconciliation, not one source's
    // field (lib/ti/geo/reconcile.ts). ripestat is free and is one of the
    // backers of the winning value here, so the claim stands.
    const claim = infraClaim(
      ipResult(
        [
          src({ id: "ripestat", requiresKey: false }),
          src({ id: "ipinfo", requiresKey: true }),
        ],
        { asn: "AS8075", asnOrg: "MICROSOFT-CORP" },
        geoResolutionWithAsn(["ripestat", "ipinfo"]),
      ),
    );
    expect(claim).toEqual({ label: "Microsoft Azure", sources: ["asn table"] });
  });

  it("#37 again: declines the ASN table claim when only key-gated sources back it", () => {
    // ipinfo (0.85) and ipgeolocation (0.75) both require a key and both
    // outweigh free ip-api (0.8) individually or combined, so on a day only
    // they answer, the "fact" this rung would render is itself a key-gated
    // pick. Nothing else in the ladder can place this indicator either, so
    // the whole claim is null rather than a name backed by quota.
    const claim = infraClaim(
      ipResult(
        [
          src({ id: "ipinfo", requiresKey: true }),
          src({ id: "ipgeolocation", requiresKey: true }),
        ],
        { asn: "AS8075", asnOrg: "MICROSOFT-CORP" },
        geoResolutionWithAsn(["ipinfo", "ipgeolocation"]),
      ),
    );
    expect(claim).toBeNull();
  });

  it("never names a provider it only inferred from the org string", () => {
    // No ASN, so cloudProvider can only match the org regex. #59: a correct
    // generic beats a confident wrong logo (jAWSon, strAWSon, hAWSley).
    const claim = infraClaim(ipResult([], { asnOrg: "Hetzner Online GmbH" }));
    expect(claim).toEqual({ label: "Hosting", sources: ["asn org name"] });
  });

  it("reads a CDN tag from Shodan before falling through to PeeringDB", () => {
    const claim = infraClaim(
      ipResult([src({ id: "shodan-internetdb", details: { tags: ["cdn", "https"] } })]),
    );
    expect(claim).toEqual({ label: "CDN edge", sources: ["shodan-internetdb"] });
  });

  it("names the network from PeeringDB", () => {
    const claim = infraClaim(
      ipResult([
        src({
          id: "peeringdb",
          details: { networkClass: "Content", peeringName: "Fastly" },
        }),
      ]),
    );
    expect(claim).toEqual({ label: "Content, Fastly", sources: ["peeringdb"] });
  });

  it("ends at the geo flags, and does not claim a residential address is infra", () => {
    expect(infraClaim(ipResult([], { isHosting: true }))).toEqual({
      label: "Hosting / Datacenter",
      sources: ["geo flags"],
    });
    // isProxy belongs to the threat ladder; isMobile and residential are not
    // "who runs the box" claims, so infra declines them.
    expect(infraClaim(ipResult([], { isProxy: true }))).toBeNull();
    expect(infraClaim(ipResult([], { country: "Thailand" }))).toBeNull();
  });

  it("says a domain is behind a provider, not that it is one", () => {
    // #59: the same prefix match is a different claim for a domain. On an IP it
    // means this address is the edge; on a domain it means the origin is not
    // visible from here.
    const domain: DomainCheckResult = {
      domain: "example.test",
      checkedAt: "2026-09-03T00:00:00Z",
      riskScore: 0,
      verdict: "unknown",
      sources: [
        src({ id: "cloud-range", details: { provider: "Cloudflare", cidr: "104.16.0.0/13" } }),
      ],
      stats: stats(1),
    } as DomainCheckResult;
    expect(infraClaim(domain)).toEqual({
      label: "Behind Cloudflare",
      sources: ["cloud-range"],
    });
  });

  it("is null when nothing free could place the network", () => {
    expect(infraClaim(ipResult([]))).toBeNull();
  });
});

import { threatClaim } from "@/lib/ti/subject-record";

/** A minimal GeoResolution carrying only what the free-source guard reads for
 *  isProxy: which provider ids backed the winning flag. */
function geoResolutionWithProxy(backers: string[]): NonNullable<CheckResult["geoResolution"]> {
  return {
    flags: { isHosting: false, isProxy: true, isMobile: false, sources: { isProxy: backers } },
    providerCount: backers.length,
  };
}

describe("threatClaim, IP rungs", () => {
  it("names the family Feodo already knows", () => {
    expect(
      threatClaim(
        ipResult([
          src({
            id: "feodo",
            malicious: true,
            categories: ["botnet-c2", "Dridex"],
            details: { malware: "Dridex", port: 443, status: "online" },
          }),
        ]),
      ),
    ).toEqual({ label: "Dridex C2", sources: ["feodo"] });
  });

  it("falls back to a bare C2 when Feodo has no family for the hit", () => {
    expect(
      threatClaim(ipResult([src({ id: "feodo", malicious: true, details: { port: 443 } })])),
    ).toEqual({ label: "Botnet C2", sources: ["feodo"] });
  });

  it("tells an exit node from a relay", () => {
    expect(
      threatClaim(ipResult([src({ id: "tor-project", details: { role: "exit" } })])),
    ).toEqual({ label: "Tor exit node", sources: ["tor-project"] });
    expect(
      threatClaim(ipResult([src({ id: "tor-project", details: { role: "relay" } })])),
    ).toEqual({ label: "Tor relay", sources: ["tor-project"] });
  });

  it("names the scanner operator the host's own PTR gave up", () => {
    expect(
      threatClaim(
        ipResult([
          src({
            id: "scanner-id",
            weight: 0,
            details: { operator: "Censys", hostname: "scanner.censys.io" },
          }),
        ]),
      ),
    ).toEqual({ label: "Research scanner, Censys", sources: ["scanner-id"] });
  });

  it("reads only the tags Shodan treats as marking the host itself", () => {
    expect(
      threatClaim(
        ipResult([src({ id: "shodan-internetdb", details: { tags: ["honeypot", "cdn"] } })]),
      ),
    ).toEqual({ label: "Honeypot", sources: ["shodan-internetdb"] });
    // "cdn" alone is infrastructure, not a threat claim.
    expect(
      threatClaim(ipResult([src({ id: "shodan-internetdb", details: { tags: ["cdn"] } })])),
    ).toBeNull();
  });

  it("reads the netblock and compromised-host rungs", () => {
    expect(
      threatClaim(ipResult([src({ id: "spamhaus-drop", categories: ["criminal-netblock"] })])),
    ).toEqual({ label: "Criminal netblock", sources: ["spamhaus-drop"] });
    expect(
      threatClaim(ipResult([src({ id: "et-open", categories: ["compromised", "et-open"] })])),
    ).toEqual({ label: "Compromised host", sources: ["et-open"] });
  });

  it("reads the proxy flag the infra ladder declined", () => {
    expect(threatClaim(ipResult([], { isProxy: true }))).toEqual({
      label: "Anonymizer",
      sources: ["geo flags"],
    });
  });

  it("ignores a source that timed out", () => {
    expect(
      threatClaim(
        ipResult([src({ id: "feodo", status: "timeout", details: { malware: "Dridex" } })]),
      ),
    ).toBeNull();
  });

  it("#37 again: declines the Anonymizer claim when isProxy is backed only by key-gated sources", () => {
    // Mirrors fromAsnTable's guard: geo.isProxy is a reconciled flag, not one
    // source's field, and a key-gated provider can outvote every free one. If
    // fromProxyFlag's guard were removed this would wrongly return Anonymizer.
    const claim = threatClaim(
      ipResult(
        [src({ id: "ipinfo", requiresKey: true })],
        { isProxy: true },
        geoResolutionWithProxy(["ipinfo"]),
      ),
    );
    expect(claim).toBeNull();
  });
});

import { lastResortClaim } from "@/lib/ti/subject-record";
import type { HashCheckResult } from "@/lib/ti/types";

function domainResult(
  sources: SourceResult[],
  context?: DomainCheckResult["context"],
): DomainCheckResult {
  return {
    domain: "example.test",
    checkedAt: "2026-09-03T00:00:00Z",
    riskScore: 0,
    verdict: "unknown",
    context,
    sources,
    stats: stats(sources.length),
  } as DomainCheckResult;
}

function hashResult(
  sources: SourceResult[],
  context?: HashCheckResult["context"],
): HashCheckResult {
  return {
    hash: "a".repeat(64),
    algorithm: "sha256",
    checkedAt: "2026-09-03T00:00:00Z",
    riskScore: 0,
    verdict: "unknown",
    context,
    sources,
    stats: stats(sources.length),
  } as HashCheckResult;
}

describe("threatClaim, domain rungs", () => {
  it("reads OpenPhish, which only ever says one thing", () => {
    expect(threatClaim(domainResult([src({ id: "openphish", categories: ["phishing"] })]))).toEqual(
      { label: "Phishing page", sources: ["openphish"] },
    );
  });

  it("reads the Spamhaus DBL meaning rather than its return code", () => {
    expect(
      threatClaim(
        domainResult([
          src({ id: "spamhaus-dbl", categories: ["botnet C2 domain"], details: { codes: ["127.0.1.6"] } }),
        ]),
      ),
    ).toEqual({ label: "Botnet C2 domain", sources: ["spamhaus-dbl"] });
  });

  it("reads a Quad9 block and a registry hold", () => {
    expect(threatClaim(domainResult([src({ id: "quad9", categories: ["dns-blocked"] })]))).toEqual({
      label: "Blocked by Quad9",
      sources: ["quad9"],
    });
    expect(threatClaim(domainResult([src({ id: "rdap", categories: ["registry-hold"] })]))).toEqual({
      label: "Registry hold",
      sources: ["rdap"],
    });
  });
});

describe("threatClaim, hash rungs", () => {
  it("reads Team Cymru's malware hash registry", () => {
    expect(
      threatClaim(hashResult([src({ id: "cymru-mhr", malicious: true, score: 80 })])),
    ).toEqual({ label: "Known malware, Team Cymru MHR", sources: ["cymru-mhr"] });
  });

  it("names what flagged the file in the known-files database", () => {
    expect(
      threatClaim(
        hashResult([src({ id: "hashlookup", malicious: true, categories: ["Kaspersky"] })]),
      ),
    ).toEqual({ label: "Known malicious, Kaspersky", sources: ["hashlookup"] });
  });

  it("answers the clean side, which no other free source does", () => {
    expect(
      threatClaim(hashResult([src({ id: "hashlookup", score: 0, details: { source: "NSRL" } })])),
    ).toEqual({ label: "Known legitimate file, NSRL", sources: ["hashlookup"] });
  });
});

describe("lastResortClaim", () => {
  it("vouches for a domain in the Tranco top million", () => {
    expect(
      lastResortClaim(domainResult([src({ id: "tranco", details: { rank: 412, vouched: true } })])),
    ).toEqual({ label: "Popular domain, Tranco rank 412", sources: ["tranco"] });
  });

  it("falls through to the registration-age classifier", () => {
    expect(lastResortClaim(domainResult([], { ageDays: 3, resolvedIps: ["1.2.3.4"] }))).toEqual({
      label: "Newly registered",
      sources: ["registration age"],
    });
  });

  it("falls through to the file classifier", () => {
    expect(lastResortClaim(hashResult([], { fileType: "PDF document" }))).toEqual({
      label: "PDF document",
      sources: ["file metadata"],
    });
  });

  it("falls through to the geo classifier for an IP", () => {
    expect(lastResortClaim(ipResult([], { isMobile: true }))).toEqual({
      label: "Mobile network",
      sources: ["geo flags"],
    });
  });
});

import { buildSubjectRecord } from "@/lib/ti/subject-record";

describe("buildSubjectRecord", () => {
  it("surfaces both axes for the case that motivated the split", () => {
    // 71.6.146.185, a Shodan census host. The people it scanned filed abuse
    // reports, so today the scanner identification and the brute-force tally
    // tie and one true fact loses. Split, both survive.
    const ip = ipResult(
      [
        src({
          id: "abuseipdb",
          score: 100,
          malicious: true,
          requiresKey: true,
          categories: ["Brute-Force", "Port Scan", "Data Center/Web Hosting/Transit"],
        }),
        src({ id: "otx", score: 100, requiresKey: true, categories: ["Brute-Force"] }),
        src({ id: "greynoise", score: 0, requiresKey: true, categories: ["internet-scanner", "benign"] }),
        src({ id: "scanner-id", score: 0, weight: 0, details: { operator: "Shodan.io" } }),
      ],
      { isHosting: true },
    );
    // abuseipdb's hard malicious listing floors real aggregation at 75
    // (aggregateRisk), which this hand-built fixture does not run; set the
    // verdict threatTypeOf needs to actually weigh the ballot below, the same
    // way the flagged-sprite test further down mutates it after construction.
    ip.verdict = "malicious";
    const rec = buildSubjectRecord(ip);
    expect(rec.class).toEqual({
      label: "Research scanner, Shodan.io",
      sources: ["scanner-id"],
    });
    expect(rec.reportedFor?.label).toBe("brute force");
    expect(rec.reportedFor?.sources).toEqual(expect.arrayContaining(["abuseipdb", "otx"]));
  });

  it("keeps the threat identity in class and the provider in hostedOn", () => {
    const rec = buildSubjectRecord(
      ipResult(
        [
          src({ id: "feodo", malicious: true, details: { malware: "Dridex" } }),
          src({
            id: "cloud-range",
            details: { provider: "Amazon Web Services", region: "eu-west-1" },
          }),
        ],
        { asn: "AS16509", asnOrg: "AMAZON-02" },
      ),
    );
    expect(rec.class.label).toBe("Dridex C2");
    expect(rec.hostedOn?.label).toBe("Amazon Web Services, eu-west-1");
    // Infra first for the picture: something physically an EC2 instance is more
    // truly an AWS box than a C2, and the C2 is the line beside it.
    expect(rec.sprite).toEqual({ body: "hosting", mark: "aws", flagged: false });
  });

  it("never renders the same fact on two rows", () => {
    const rec = buildSubjectRecord(
      ipResult([], { asn: "AS8075", asnOrg: "MICROSOFT-CORP" }),
    );
    expect(rec.class.label).toBe("Microsoft Azure");
    expect(rec.hostedOn).toBeUndefined();
  });

  it("puts horns on a flagged verdict and nothing on a clean one", () => {
    const flagged = ipResult([src({ id: "feodo", malicious: true })]);
    flagged.verdict = "malicious";
    expect(buildSubjectRecord(flagged).sprite).toEqual({ body: "c2", flagged: true });

    const clean = ipResult([]);
    clean.verdict = "clean";
    expect(buildSubjectRecord(clean).sprite.flagged).toBe(false);
  });

  it("falls back to the type's own body when nothing identified it", () => {
    expect(buildSubjectRecord(ipResult([])).sprite.body).toBe("hosting");
    expect(buildSubjectRecord(domainResult([])).sprite.body).toBe("site");
    expect(buildSubjectRecord(hashResult([])).sprite.body).toBe("file");
  });

  it("does not change the picture when every key-gated source fails", () => {
    // The rule the sprite set is built on: an icon may not change shape because
    // of how much the tool was used earlier that day (#37).
    const sources = [
      src({ id: "cloud-range", details: { provider: "Amazon Web Services" } }),
      src({ id: "scanner-id", details: { operator: "Censys" } }),
    ];
    const withKeys = [
      ...sources,
      src({ id: "greynoise", requiresKey: true, categories: ["internet-scanner"] }),
      src({ id: "virustotal", requiresKey: true, score: 60 }),
    ];
    const withoutKeys = [
      ...sources,
      src({ id: "greynoise", requiresKey: true, status: "rate_limited" }),
      src({ id: "virustotal", requiresKey: true, status: "error" }),
    ];
    expect(buildSubjectRecord(ipResult(withoutKeys)).sprite).toEqual(
      buildSubjectRecord(ipResult(withKeys)).sprite,
    );
    expect(buildSubjectRecord(ipResult(withoutKeys)).class).toEqual(
      buildSubjectRecord(ipResult(withKeys)).class,
    );
  });

  it("says so rather than leaving a gap", () => {
    const rec = buildSubjectRecord(ipResult([]));
    expect(rec.class.label).toBe("Unknown type");
    expect(rec.reportedFor).toBeUndefined();
    expect(rec.subject).toBe("185.220.101.42");
  });

  it("carries the algorithm as the hash qualifier", () => {
    expect(buildSubjectRecord(hashResult([])).qualifier).toBe("SHA-256");
  });
});
