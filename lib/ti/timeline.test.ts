import { describe, expect, it } from "vitest";
import { buildTimeline, phaseSpan } from "@/lib/ti/timeline";
import type {
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
  SourceResult,
} from "@/lib/ti/types";
import { src, stats } from "@/lib/ti/subject-record.test";

const NOW = new Date(Date.UTC(2026, 9, 4, 12));

function domain(sources: SourceResult[]): DomainCheckResult {
  return {
    domain: "cdn-update-check.net",
    checkedAt: NOW.toISOString(),
    riskScore: 88,
    verdict: "malicious",
    sources,
    stats: stats(sources.length),
  };
}

function ip(sources: SourceResult[]): CheckResult {
  return {
    ip: "185.220.101.4",
    checkedAt: NOW.toISOString(),
    riskScore: 90,
    verdict: "malicious",
    sources,
    stats: stats(sources.length),
  } as CheckResult;
}

function hash(sources: SourceResult[]): HashCheckResult {
  return {
    hash: "a".repeat(64),
    algorithm: "sha256",
    checkedAt: NOW.toISOString(),
    riskScore: 95,
    verdict: "malicious",
    sources,
    stats: stats(sources.length),
  } as HashCheckResult;
}

const rdap = (createdAt: string, expiresAt?: string) =>
  src({ id: "rdap", domainContext: { createdAt, expiresAt, registrar: "NameCheap" } });

const pdns = (...rows: [string, string, string][]): SourceResult => ({
  ...src({ id: "mnemonic-pdns" }),
  passiveDns: rows.map(([value, firstSeen, lastSeen]) => ({ value, type: "ip", firstSeen, lastSeen })),
});

const cert = (firstSeen: string): SourceResult => ({
  ...src({ id: "certspotter" }),
  certificates: [{ issuer: "Let's Encrypt R11", sans: [], firstSeen }],
});

const listing = (id: string, firstSeen: string, lastSeen: string, categories: string[]) =>
  src({ id, malicious: true, details: { firstSeen }, lastSeen, categories });

/** The made-up domain from the mocks. */
const story = () =>
  domain([
    rdap("2023-04-12T00:00:00Z", "2027-04-12T00:00:00Z"),
    pdns(["185.220.101.4", "2024-11-02T10:00:00Z", "2026-09-01T00:00:00Z"]),
    cert("2024-11-03T00:00:00Z"),
    listing("urlhaus", "2025-01-19 08:00:00", "2025-01-19 08:00:00", ["malware_download", "emotet"]),
    listing("threatfox", "2025-02-01 00:00:00 UTC", "2026-09-30 12:00:00 UTC", ["botnet_cc"]),
  ]);

describe("buildTimeline events", () => {
  it("tells a domain's life in date order, one row per kind", () => {
    const t = buildTimeline(story(), NOW);
    expect(t.events.map((e) => [e.kind, e.at, e.source])).toEqual([
      ["registered", "2023-04-12", "rdap"],
      ["first-resolved", "2024-11-02", "mnemonic-pdns"],
      ["cert-issued", "2024-11-03", "certspotter"],
      ["listed", "2025-01-19", "urlhaus"],
      ["last-resolved", "2026-09-01", "mnemonic-pdns"],
      ["last-reported", "2026-09-30", "threatfox"],
      ["expires", "2027-04-12", "rdap"],
    ]);
    expect(t.now).toBe("2026-10-04");
    expect(t.sourceCount).toBe(5);
  });

  it("folds the other sources into `also`, earliest wins for first kinds, latest for last", () => {
    const t = buildTimeline(story(), NOW);
    const listed = t.events.find((e) => e.kind === "listed");
    const reported = t.events.find((e) => e.kind === "last-reported");
    expect(listed?.also).toEqual([{ source: "threatfox", at: "2025-02-01" }]);
    expect(reported?.also).toEqual([{ source: "urlhaus", at: "2025-01-19" }]);
  });

  it("colours only listings and reports, and marks future dates", () => {
    const tones = Object.fromEntries(buildTimeline(story(), NOW).events.map((e) => [e.kind, e.tone]));
    expect(tones).toEqual({
      registered: "neutral",
      "first-resolved": "neutral",
      "cert-issued": "neutral",
      listed: "adverse",
      "last-resolved": "neutral",
      "last-reported": "adverse",
      expires: "future",
    });
  });

  it("carries a short detail where the source gives one", () => {
    const by = Object.fromEntries(buildTimeline(story(), NOW).events.map((e) => [e.kind, e.detail]));
    expect(by.registered).toBe("via NameCheap");
    expect(by["first-resolved"]).toBe("to 185.220.101.4");
    expect(by["cert-issued"]).toBe("Let's Encrypt R11");
    expect(by.listed).toBe("malware_download, emotet");
  });

  it("counts a source once per kind, by its own earliest row", () => {
    const t = buildTimeline(
      domain([
        pdns(
          ["1.2.3.4", "2024-01-01T00:00:00Z", "2024-02-01T00:00:00Z"],
          ["5.6.7.8", "2023-06-01T00:00:00Z", "2024-03-01T00:00:00Z"],
        ),
      ]),
      NOW,
    );
    const first = t.events.find((e) => e.kind === "first-resolved");
    expect(first).toMatchObject({ at: "2023-06-01", detail: "to 5.6.7.8", also: [] });
  });

  it("files a malicious listing source as listed, any other source as seen (IP)", () => {
    const t = buildTimeline(
      ip([
        src({ id: "rdap-ip", domainContext: { createdAt: "1998-01-01T00:00:00Z" } }),
        listing("feodo", "2025-06-01 00:00:00", "2026-10-01 00:00:00", ["botnet-c2"]),
        src({ id: "dshield", details: { feedFirstSeen: "2025-03-01" }, lastSeen: "2026-09-28" }),
        src({ id: "abuseipdb", malicious: true, lastSeen: "2026-10-03T00:00:00+00:00" }),
      ]),
      NOW,
    );
    expect(t.events.map((e) => [e.kind, e.at, e.source])).toEqual([
      ["first-seen", "2025-03-01", "dshield"],
      ["listed", "2025-06-01", "feodo"],
      ["last-seen", "2026-09-28", "dshield"],
      ["last-reported", "2026-10-03", "abuseipdb"],
    ]);
  });

  it("reads a hash's dates from hashContext, and lists only malicious listing sources", () => {
    const t = buildTimeline(
      hash([
        src({ id: "virustotal", malicious: true, hashContext: { firstSeen: "2025-02-07T09:00:00Z", lastSeen: "2026-03-01T00:00:00Z" } }),
        src({ id: "malwarebazaar", malicious: true, hashContext: { firstSeen: "2025-02-07 12:00:00", lastSeen: "2025-08-01 00:00:00" } }),
        src({ id: "kaspersky-opentip", hashContext: { firstSeen: "2025-03-01T00:00:00Z" } }),
      ]),
      NOW,
    );
    expect(t.events.map((e) => [e.kind, e.at, e.source, e.also.length])).toEqual([
      ["first-seen", "2025-02-07", "virustotal", 2],
      ["listed", "2025-02-07", "malwarebazaar", 0],
      ["last-seen", "2026-03-01", "virustotal", 1],
    ]);
  });

  it("ignores sources that did not answer and dates that do not parse", () => {
    const t = buildTimeline(
      ip([
        src({ id: "greynoise", status: "error", lastSeen: "2026-01-01" }),
        src({ id: "dshield", details: { feedFirstSeen: "not a date" }, lastSeen: "1985-01-01" }),
      ]),
      NOW,
    );
    expect(t.events).toEqual([]);
  });

  it("answers an empty timeline for an undated result", () => {
    expect(buildTimeline(hash([]), NOW)).toEqual({
      now: "2026-10-04",
      events: [],
      gaps: [],
      phases: [],
      sourceCount: 0,
    });
  });

  it("defaults now to the result's checkedAt", () => {
    expect(buildTimeline(story()).now).toBe("2026-10-04");
  });
});

describe("buildTimeline gaps", () => {
  it("marks every stretch of six calendar months or more", () => {
    expect(buildTimeline(story(), NOW).gaps).toEqual([
      { after: "registered", months: 18 },
      { after: "listed", months: 19 },
      { after: "last-reported", months: 6 },
    ]);
  });
});

describe("timeline date boundaries", () => {
  it("caps observations one calendar year after checkedAt, while allowing later expiries", () => {
    const r = domain([
      rdap("2027-10-05T12:00:00Z", "2035-01-01T00:00:00Z"),
      pdns(["1.2.3.4", "2027-10-04T12:00:00Z", "2027-10-04T12:00:01Z"]),
    ]);
    expect(buildTimeline(r).events.map((e) => [e.kind, e.at, e.tone])).toEqual([
      ["first-resolved", "2027-10-04", "future"],
      ["expires", "2035-01-01", "future"],
    ]);
  });

  it("accepts observations relative to an injected future clock", () => {
    const r = hash([src({ id: "virustotal", hashContext: { firstSeen: "2035-01-01" } })]);
    const t = buildTimeline(r, new Date("2035-10-04T12:00:00Z"));
    expect(t.events).toMatchObject([{ kind: "first-seen", at: "2035-01-01", tone: "neutral" }]);
  });

  it("drops invalid and pre-1990 expiry dates", () => {
    expect(buildTimeline(domain([rdap("invalid", "1989-12-31")])).events).toEqual([]);
    expect(buildTimeline(domain([rdap("1980-01-01", "invalid")])).events).toEqual([]);
  });

  it("keeps a non-malicious feed sighting neutral", () => {
    const t = buildTimeline(ip([src({
      id: "threatfox", malicious: false,
      details: { firstSeen: "2026-09-01" }, lastSeen: "2026-10-01",
    })]));
    expect(t.events.map((e) => [e.kind, e.tone])).toEqual([
      ["first-seen", "neutral"], ["last-seen", "neutral"],
    ]);
  });

  it("breaks source ties deterministically and keeps event kind order", () => {
    const r = hash([
      src({ id: "yaraify", hashContext: { firstSeen: "2026-09-01", lastSeen: "2026-09-01" } }),
      src({ id: "virustotal", hashContext: { firstSeen: "2026-09-01", lastSeen: "2026-09-01" } }),
    ]);
    expect(buildTimeline(r).events.map((e) => [e.kind, e.source, e.also])).toEqual([
      ["first-seen", "virustotal", [{ source: "yaraify", at: "2026-09-01" }]],
      ["last-seen", "virustotal", [{ source: "yaraify", at: "2026-09-01" }]],
    ]);
  });

  it("marks a gap at six whole calendar months, but not the day before", () => {
    const gap = (lastSeen: string) => buildTimeline(ip([src({
      id: "dshield", details: { feedFirstSeen: "2026-01-15" }, lastSeen,
    })])).gaps;
    expect(gap("2026-07-14")).toEqual([]);
    expect(gap("2026-07-15")).toEqual([{ after: "first-seen", months: 6 }]);
  });
});

const phases = (r: Parameters<typeof buildTimeline>[0]) =>
  buildTimeline(r, NOW).phases.map((p) => [p.kind, p.from, p.to, p.ongoing]);

describe("buildTimeline phases", () => {
  it("draws a young domain as dormant, live, listed, paid ahead", () => {
    expect(phases(story())).toEqual([
      ["dormant", "2023-04-12", "2024-11-02", false],
      ["live", "2024-11-02", "2025-01-19", false],
      ["listed", "2025-01-19", "2026-10-04", true],
      ["paid-to", "2026-10-04", "2027-04-12", true],
    ]);
  });

  it("names the edges of each phase, for the ledger highlight", () => {
    const t = buildTimeline(story(), NOW);
    expect(t.phases.find((p) => p.kind === "dormant")?.edges).toEqual(["registered", "first-resolved"]);
  });

  it("refuses to call a pre-2018 domain dormant", () => {
    const old = domain([
      rdap("1997-09-15T00:00:00Z"),
      pdns(["142.250.0.1", "2009-06-01T00:00:00Z", "2026-10-01T00:00:00Z"]),
    ]);
    expect(phases(old)[0]).toEqual(["before-records", "1997-09-15", "2009-06-01", false]);
  });

  it("goes quiet 90 days after the last report", () => {
    const r = domain([
      rdap("2023-04-12T00:00:00Z"),
      pdns(["185.220.101.4", "2024-11-02T00:00:00Z", "2024-12-01T00:00:00Z"]),
      listing("threatfox", "2025-02-01 00:00:00 UTC", "2026-05-01 00:00:00 UTC", ["botnet_cc"]),
    ]);
    expect(phases(r).slice(-2)).toEqual([
      ["listed", "2025-02-01", "2026-05-01", false],
      ["quiet", "2026-05-01", "2026-10-04", true],
    ]);
  });

  it("ends the bar at a lapsed registration", () => {
    const r = domain([rdap("2023-04-12T00:00:00Z", "2026-01-01T00:00:00Z")]);
    expect(phases(r)).toEqual([["lapsed", "2026-01-01", "2026-10-04", false]]);
  });

  it("draws an IP from first seen, never from its netblock", () => {
    const r = ip([
      src({ id: "rdap-ip", domainContext: { createdAt: "1998-01-01T00:00:00Z" } }),
      listing("feodo", "2025-06-01 00:00:00", "2026-10-01 00:00:00", ["botnet-c2"]),
      src({ id: "dshield", details: { feedFirstSeen: "2025-03-01" }, lastSeen: "2026-09-28" }),
    ]);
    expect(phases(r)).toEqual([
      ["live", "2025-03-01", "2025-06-01", false],
      ["listed", "2025-06-01", "2026-10-04", true],
    ]);
  });

  it("skips a zero-length live phase when a hash was listed on the day it surfaced", () => {
    const r = hash([
      src({ id: "virustotal", hashContext: { firstSeen: "2025-02-07T09:00:00Z", lastSeen: "2026-03-01T00:00:00Z" } }),
      src({ id: "malwarebazaar", malicious: true, hashContext: { firstSeen: "2025-02-07 12:00:00" } }),
    ]);
    expect(phases(r)).toEqual([
      ["listed", "2025-02-07", "2026-03-01", false],
      ["quiet", "2026-03-01", "2026-10-04", true],
    ]);
  });

  it("keeps an unlisted hash live until its last sighting", () => {
    const r = hash([
      src({ id: "virustotal", hashContext: { firstSeen: "2026-08-01T00:00:00Z", lastSeen: "2026-09-20T00:00:00Z" } }),
    ]);
    expect(phases(r)).toEqual([["live", "2026-08-01", "2026-10-04", true]]);
  });
});

describe("phaseSpan", () => {
  it("speaks in days, then months, then years", () => {
    expect(phaseSpan("2026-09-20", "2026-10-04")).toBe("14 d");
    expect(phaseSpan("2023-04-12", "2024-11-02")).toBe("18 mo");
    expect(phaseSpan("1997-09-15", "2009-06-01")).toBe("11 yr");
  });
});

describe("phase boundaries", () => {
  it("does not close live activity at a future listing", () => {
    const r = ip([
      src({ id: "dshield", details: { feedFirstSeen: "2026-08-01" } }),
      listing("threatfox", "2026-11-01", "2026-11-02", ["botnet_cc"]),
    ]);
    expect(phases(r)).toEqual([["live", "2026-08-01", "2026-10-04", true]]);
  });

  it("omits phases whose edges are on the same displayed day", () => {
    const r = hash([src({ id: "virustotal", hashContext: { firstSeen: "2026-10-04" } })]);
    expect(phases(r)).toEqual([]);
  });

  it("changes from before records to dormant on 2018-05-01", () => {
    const phase = (registered: string) => phases(domain([
      rdap(registered), cert("2019-01-01"),
    ]))[0][0];
    expect(phase("2018-04-30")).toBe("before-records");
    expect(phase("2018-05-01")).toBe("dormant");
  });

  it("becomes quiet at 90 days, and remains live a day earlier", () => {
    const r = hash([src({ id: "virustotal", hashContext: {
      firstSeen: "2026-01-01", lastSeen: "2026-07-06",
    } })]);
    expect(buildTimeline(r, new Date("2026-10-03T00:00:00Z")).phases.map((p) => p.kind)).toEqual(["live"]);
    expect(buildTimeline(r, new Date("2026-10-04T00:00:00Z")).phases.map((p) => p.kind)).toEqual(["live", "quiet"]);
  });
});
