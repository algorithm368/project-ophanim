import { describe, expect, it } from "vitest";
import {
  aggregateCategories,
  buildDomainNarrative,
  buildHashNarrative,
  buildNarrative,
  consensusBuckets,
  hashBehaviorSummary,
  type ResultLike,
  scoreExplanation,
  threatSentences,
} from "./narrative";
import type {
  CheckResult,
  CheckStats,
  DomainCheckResult,
  HashCheckResult,
  SourceResult,
} from "./types";

function makeSource(
  over: Partial<SourceResult> & { name: string; weight?: number },
): SourceResult {
  const { name, weight = 1, ...rest } = over;
  return {
    status: "ok",
    enabled: true,
    durationMs: 1,
    source: {
      id: name.toLowerCase(),
      name,
      url: "https://example.com",
      category: "reputation",
      requiresKey: false,
      weight,
    },
    ...rest,
  };
}

function makeStats(over: Partial<CheckStats> = {}): CheckStats {
  return {
    total: 0,
    queried: 0,
    flagged: 0,
    skipped: 0,
    errored: 0,
    rateLimited: 0,
    ...over,
  };
}

describe("hashBehaviorSummary", () => {
  it("turns behaviour tags into one plain sentence, deduped and capped", () => {
    expect(
      hashBehaviorSummary({
        behaviorTags: ["PERSISTENCE", "CRYPTO", "SELF_DELETE"],
      }),
    ).toBe(
      "When run, it sets itself to run again after reboot, uses encryption, and deletes itself after running.",
    );
  });

  it("skips unmapped tags and returns undefined when none map and no capabilities", () => {
    expect(hashBehaviorSummary({ behaviorTags: ["PERSISTENCE", "WEIRD_TAG"] })).toBe(
      "When run, it sets itself to run again after reboot.",
    );
    expect(hashBehaviorSummary({ behaviorTags: ["WEIRD_TAG"] })).toBeUndefined();
    expect(hashBehaviorSummary(undefined)).toBeUndefined();
  });

  it("falls back to sentence-shaped capabilities when there are no tags", () => {
    expect(
      hashBehaviorSummary({
        capabilities: [
          { label: "Adds Run key to start application" },
          { label: "Executes dropped EXE" },
          { label: "stack_pivot" }, // machine token, skipped
          { label: "terminate" }, // single word, skipped
        ],
      }),
    ).toBe(
      "When run, it adds Run key to start application and executes dropped EXE.",
    );
  });

  it("omits the line rather than build one from a single weak capability", () => {
    expect(
      hashBehaviorSummary({ capabilities: [{ label: "Executes dropped EXE" }] }),
    ).toBeUndefined();
  });

  it("skips family/label capabilities in the fallback, keeping real behaviour", () => {
    expect(
      hashBehaviorSummary({
        capabilities: [
          { label: "Detects AnimateClipper" },
          { label: "Family: SectopRAT" },
          { label: "SectopRAT payload" },
          { label: "Adds Run key to start application" },
          { label: "Executes dropped EXE" },
        ],
      }),
    ).toBe("When run, it adds Run key to start application and executes dropped EXE.");
  });
});

describe("threatSentences — category attribution (issue #2)", () => {
  it("only lists categories from the sources that actually flagged", () => {
    const flagging = makeSource({
      name: "Feodo",
      score: 80,
      categories: ["c2", "malware"],
    });
    const quiet = makeSource({
      name: "Censys",
      score: 10, // below FLAG_THRESHOLD — did not flag
      categories: ["cdn", "hosting"],
    });
    const result: ResultLike = {
      riskScore: 80,
      verdict: "malicious",
      checkedAt: "2026-05-28T00:00:00Z",
      sources: [flagging, quiet],
      stats: makeStats({ flagged: 1 }),
    };

    const text = threatSentences(result, "address").join(" ");
    expect(text).toContain("1 of 2 TI sources flagged it for c2, malware.");
    // The quiet source's labels must NOT appear in the "flagged for …" reason.
    expect(text).not.toContain("cdn");
    expect(text).not.toContain("hosting");
    expect(text).toContain("Flagged by Feodo.");
  });
});

describe("buildDomainNarrative — age accuracy (issue #1)", () => {
  function domainAged(ageDays: number): string {
    const result: DomainCheckResult = {
      domain: "example.com",
      checkedAt: "2026-05-28T00:00:00Z",
      riskScore: 0,
      verdict: "clean",
      context: { ageDays },
      sources: [],
      stats: makeStats(),
    };
    return buildDomainNarrative(result).join(" ");
  }

  it("describes a ~3-month-old domain in months, not '1 year'", () => {
    const text = domainAged(90);
    expect(text).toContain("about 3 months ago");
    expect(text).not.toContain("1 year");
  });

  it("keeps day granularity under 60 days", () => {
    expect(domainAged(45)).toContain("45 days ago");
  });

  it("rounds years for older domains", () => {
    expect(domainAged(400)).toContain("about 1 year ago");
    expect(domainAged(800)).toContain("about 2 years ago");
  });
});

describe("unknown verdict is not rendered as 0/100 (issue #3)", () => {
  it("IP narrative says 'no information', never 'scoring 0/100'", () => {
    const result: CheckResult = {
      ip: "8.8.8.8",
      checkedAt: "2026-05-28T00:00:00Z",
      riskScore: 0,
      verdict: "unknown",
      sources: [],
      stats: makeStats(),
    };
    const text = buildNarrative(result).join(" ");
    expect(text).toContain("no information");
    expect(text).not.toContain("0/100");
  });

  it("domain narrative says 'no information', never 'scoring 0/100'", () => {
    const result: DomainCheckResult = {
      domain: "example.com",
      checkedAt: "2026-05-28T00:00:00Z",
      riskScore: 0,
      verdict: "unknown",
      sources: [],
      stats: makeStats(),
    };
    const text = buildDomainNarrative(result).join(" ");
    expect(text).toContain("no information");
    expect(text).not.toContain("0/100");
  });

  it("hash narrative with metadata but no score still avoids '0/100'", () => {
    // ctx present, so the early no-record branch is skipped; the headline
    // must still treat unknown as "no information", not a 0/100 score.
    const result: HashCheckResult = {
      hash: "a".repeat(64),
      algorithm: "sha256",
      checkedAt: "2026-05-28T00:00:00Z",
      riskScore: 0,
      verdict: "unknown",
      context: { fileName: "sample.bin" },
      sources: [],
      stats: makeStats(),
    };
    const text = buildHashNarrative(result).join(" ");
    expect(text).toContain("no information");
    expect(text).not.toContain("0/100");
  });

  it("states the verdict in words without a raw score for a rated result", () => {
    const result: CheckResult = {
      ip: "1.2.3.4",
      checkedAt: "2026-05-28T00:00:00Z",
      riskScore: 75,
      verdict: "malicious",
      sources: [makeSource({ name: "Feodo", score: 80, malicious: true })],
      stats: makeStats({ flagged: 1 }),
    };
    const text = buildNarrative(result).join(" ");
    expect(text).toContain("is almost certainly malicious");
    expect(text).not.toContain("/100");
  });
});

describe("threatSentences — headline category quality (P1.3)", () => {
  it("drops file-format/type tags from the 'flagged for' clause", () => {
    const vt = makeSource({
      name: "VirusTotal",
      score: 100,
      malicious: true,
      categories: ["virus.eicar/test", "peexe", "assembly", "attachment"],
    });
    const result: ResultLike = {
      riskScore: 89,
      verdict: "malicious",
      checkedAt: "2026-06-13T00:00:00Z",
      sources: [vt],
      stats: makeStats({ flagged: 1 }),
    };
    const text = threatSentences(result, "file").join(" ");
    expect(text).toContain("flagged it for virus.eicar/test.");
    expect(text).not.toContain("peexe");
    expect(text).not.toContain("assembly");
    expect(text).not.toContain("attachment");
  });

  it("leads with the strongest source's first category, not alphabetical junk", () => {
    // OTX-style arbitrary pulse tags sort alphabetically before VT's threat
    // label; the strongest feed's own ordering must win instead.
    const otx = makeSource({
      name: "AlienVault OTX",
      score: 60,
      weight: 0.85,
      categories: ["academico", "auditoria"],
    });
    const vt = makeSource({
      name: "VirusTotal",
      score: 100,
      malicious: true,
      categories: ["virus.eicar/test"],
    });
    const result: ResultLike = {
      riskScore: 89,
      verdict: "malicious",
      checkedAt: "2026-06-13T00:00:00Z",
      sources: [otx, vt],
      stats: makeStats({ flagged: 2 }),
    };
    const text = threatSentences(result, "file").join(" ");
    // Single-source tags from the weaker feed are excluded outright.
    expect(text).toContain("flagged it for virus.eicar/test.");
    expect(text).not.toContain("academico");
    // The strongest source also leads the "Flagged by" list.
    expect(text).toContain("Flagged by VirusTotal, AlienVault OTX.");
  });

  it("ranks by effective signal (score × weight), not raw score", () => {
    // Raw-score order would put IPsum (90) first; weighted order (27 vs 70)
    // must flip both the "Flagged by" list and which source's single-source
    // categories pass the strongest-source gate.
    const ipsum = makeSource({
      name: "IPsum",
      score: 90,
      weight: 0.3,
      categories: ["ipsum-only-tag"],
    });
    const abuse = makeSource({
      name: "AbuseIPDB",
      score: 70,
      weight: 1,
      categories: ["abuse-only-tag"],
    });
    const result: ResultLike = {
      riskScore: 70,
      verdict: "malicious",
      checkedAt: "2026-06-13T00:00:00Z",
      sources: [ipsum, abuse],
      stats: makeStats({ flagged: 2 }),
    };
    const text = threatSentences(result, "address").join(" ");
    expect(text).toContain("Flagged by AbuseIPDB, IPsum.");
    expect(text).toContain("abuse-only-tag");
    expect(text).not.toContain("ipsum-only-tag");
  });

  it("degrades to a bare 'flagged it.' when every category is format noise", () => {
    const vt = makeSource({
      name: "VirusTotal",
      score: 100,
      malicious: true,
      categories: ["peexe", "zip", "attachment"],
    });
    const result: ResultLike = {
      riskScore: 89,
      verdict: "malicious",
      checkedAt: "2026-06-13T00:00:00Z",
      sources: [vt],
      stats: makeStats({ flagged: 1 }),
    };
    const text = threatSentences(result, "file").join(" ");
    expect(text).toContain("1 of 1 TI sources flagged it.");
    expect(text).not.toContain("flagged it for");
  });

  it("drops generic script/type tags while real threat labels survive", () => {
    const vt = makeSource({
      name: "VirusTotal",
      score: 100,
      malicious: true,
      categories: ["trojan.agent/gen", "powershell", "js"],
    });
    const result: ResultLike = {
      riskScore: 89,
      verdict: "malicious",
      checkedAt: "2026-06-13T00:00:00Z",
      sources: [vt],
      stats: makeStats({ flagged: 1 }),
    };
    const text = threatSentences(result, "file").join(" ");
    expect(text).toContain("flagged it for trojan.agent/gen.");
    expect(text).not.toMatch(/flagged it for[^.]*\bpowershell\b/);
    expect(text).not.toMatch(/flagged it for[^.]*\bjs\b/);
  });

  it("keeps a weaker feed's tag when a second source corroborates it", () => {
    const a = makeSource({
      name: "Feodo",
      score: 100,
      malicious: true,
      categories: ["botnet_c2"],
    });
    const b = makeSource({
      name: "ThreatFox",
      score: 80,
      categories: ["botnet_c2", "random-tag"],
    });
    const result: ResultLike = {
      riskScore: 90,
      verdict: "malicious",
      checkedAt: "2026-06-13T00:00:00Z",
      sources: [a, b],
      stats: makeStats({ flagged: 2 }),
    };
    const text = threatSentences(result, "address").join(" ");
    expect(text).toContain("botnet_c2");
    // Single-source tag from the weaker feed stays out of the headline.
    expect(text).not.toContain("random-tag");
  });
});

describe("aggregateCategories — ranking (P1.3)", () => {
  it("keeps the source's own ordering for count ties (no alphabetical resort)", () => {
    const names = aggregateCategories([
      makeSource({ name: "VirusTotal", score: 100, categories: ["malware", "c2"] }),
    ]).map((c) => c.name);
    // Alphabetical tiebreak would yield ["c2", "malware"] — insertion order
    // must win so the strongest feed's first (most significant) tag leads.
    expect(names).toEqual(["malware", "c2"]);
  });

  it("still ranks multi-source categories above earlier-inserted singletons", () => {
    const names = aggregateCategories([
      makeSource({ name: "A", score: 90, categories: ["solo-tag", "shared-tag"] }),
      makeSource({ name: "B", score: 80, categories: ["shared-tag"] }),
    ]).map((c) => c.name);
    expect(names).toEqual(["shared-tag", "solo-tag"]);
  });
});

describe("buildDomainNarrative — NXDOMAIN honesty (P1.2)", () => {
  function mkDomain(over: Partial<DomainCheckResult>): DomainCheckResult {
    return {
      domain: "no-such-name.example",
      checkedAt: "2026-06-13T00:00:00Z",
      riskScore: 0,
      verdict: "unknown",
      sources: [makeSource({ name: "SURBL", score: 0 })],
      stats: makeStats(),
      ...over,
    };
  }

  it("says NXDOMAIN/unregistered instead of the generic unknown headline", () => {
    const text = buildDomainNarrative(
      mkDomain({ context: { nxdomain: true, resolvedIps: [] } }),
    ).join(" ");
    expect(text).toContain("NXDOMAIN");
    expect(text).toContain("unregistered");
    // Sources DID respond here — the generic "no scoring TI source returned
    // data" headline would be a false statement.
    expect(text).not.toContain("no scoring TI source returned data");
    expect(text).not.toContain("0/100");
  });

  it("keeps a flagged verdict but states the name is currently dead", () => {
    const text = buildDomainNarrative(
      mkDomain({
        riskScore: 75,
        verdict: "malicious",
        context: { nxdomain: true, resolvedIps: [] },
        sources: [makeSource({ name: "URLhaus", score: 90, malicious: true })],
        stats: makeStats({ flagged: 1 }),
      }),
    ).join(" ");
    expect(text).toContain("almost certainly malicious");
    expect(text).toContain("NXDOMAIN");
  });

  it("keeps a low (sub-flag) verdict and still notes NXDOMAIN", () => {
    // The assemble downgrade only converts clean→unknown; a weak scored
    // signal keeps its verdict and gets the scored headline plus the
    // name-is-dead sentence.
    const text = buildDomainNarrative(
      mkDomain({
        riskScore: 20,
        verdict: "low",
        context: { nxdomain: true, resolvedIps: [] },
        sources: [makeSource({ name: "URLhaus", score: 20 })],
        stats: makeStats(),
      }),
    ).join(" ");
    expect(text).toContain("carries only low-level risk");
    expect(text).not.toContain("/100");
    expect(text).toContain("NXDOMAIN");
  });

  it("does not mention NXDOMAIN for a resolving domain", () => {
    const text = buildDomainNarrative(
      mkDomain({
        verdict: "clean",
        context: { nxdomain: false, resolvedIps: ["93.184.216.34"] },
      }),
    ).join(" ");
    expect(text).not.toContain("NXDOMAIN");
    expect(text).toContain("It currently resolves to 93.184.216.34.");
  });
});

describe("buildDomainNarrative — non-resolution claim (issue #4)", () => {
  function domain(context: DomainCheckResult["context"]): string {
    const result: DomainCheckResult = {
      domain: "example.com",
      checkedAt: "2026-05-28T00:00:00Z",
      riskScore: 0,
      verdict: "clean",
      context,
      sources: [],
      stats: makeStats(),
    };
    return buildDomainNarrative(result).join(" ");
  }

  it("claims non-resolution only when delegated (has NS) but no address", () => {
    expect(domain({ nameservers: ["ns1.example.net"], resolvedIps: [] })).toContain(
      "does not currently resolve",
    );
  });

  it("stays silent when there is no DNS data at all (not a false claim)", () => {
    expect(domain({ registrar: "Example Registrar" })).not.toContain(
      "does not currently resolve",
    );
  });
});

describe("threatSentences — denominator excludes context sources (issue #5)", () => {
  it("counts only weighted feeds, not zero-weight context sources", () => {
    const feed = makeSource({ name: "Feodo", score: 5 }); // weighted, didn't flag
    const geo = makeSource({ name: "ip-api", weight: 0, score: 0 }); // context only
    const result: ResultLike = {
      riskScore: 0,
      verdict: "clean",
      checkedAt: "2026-05-28T00:00:00Z",
      sources: [feed, geo],
      stats: makeStats(),
    };
    // ip-api must not be counted, so it's "1" responding TI source, not 2.
    expect(threatSentences(result, "address").join(" ")).toContain(
      "None of the 1 TI sources flagged this address.",
    );
  });
});

describe("threatSentences — no gap note", () => {
  it("never emits an 'N need an API key' (or rate-limit) parenthetical", () => {
    const feed = makeSource({ name: "Feodo", score: 0 });
    const result: ResultLike = {
      riskScore: 0,
      verdict: "clean",
      checkedAt: "2026-05-29T00:00:00Z",
      sources: [feed],
      stats: makeStats({ skipped: 2, rateLimited: 3 }),
    };
    const text = threatSentences(result, "address").join(" ");
    expect(text).not.toContain("need an API key");
    expect(text).not.toContain("rate limit");
    expect(text).not.toContain("(");
  });
});

describe("buildDomainNarrative — maturity wording tiers (issue #6)", () => {
  function aged(ageDays: number): string {
    const result: DomainCheckResult = {
      domain: "example.com",
      checkedAt: "2026-05-28T00:00:00Z",
      riskScore: 0,
      verdict: "clean",
      context: { ageDays },
      sources: [],
      stats: makeStats(),
    };
    return buildDomainNarrative(result).join(" ");
  }

  it("does not call a 45-day-old domain 'established'", () => {
    const text = aged(45);
    expect(text).toContain("It was registered 45 days ago");
    expect(text).not.toContain("established");
  });

  it("calls a sub-30-day domain newly registered", () => {
    expect(aged(20)).toContain("newly registered domain");
  });

  it("calls a multi-year domain established", () => {
    expect(aged(800)).toContain("established domain");
  });
});

describe("buildNarrative — proxy + hosting both reported (issue #9)", () => {
  function ip(geo: CheckResult["geo"]): string {
    const result: CheckResult = {
      ip: "52.94.236.248",
      checkedAt: "2026-05-29T00:00:00Z",
      riskScore: 0,
      verdict: "clean",
      geo,
      sources: [],
      stats: makeStats(),
    };
    return buildNarrative(result).join(" ");
  }

  it("keeps the hosting/datacenter fact when an IP is both proxy and hosting", () => {
    const text = ip({
      isProxy: true,
      isHosting: true,
      isp: "Amazon.com, Inc.",
      asn: "AS16509 Amazon.com, Inc.",
    });
    // Both facts must survive — not just the anonymizer framing (issue #9).
    expect(text).toContain("anonymizer");
    expect(text).toContain("hosting/datacenter infrastructure");
  });

  it("still describes a proxy-only IP as a plain anonymizer", () => {
    const text = ip({ isProxy: true, isp: "Some VPN" });
    expect(text).toContain("anonymizer (proxy, VPN, or Tor)");
    expect(text).not.toContain("hosting/datacenter infrastructure");
  });
});

describe("buildNarrative — unclassified type is hedged (issue #10)", () => {
  function ip(geo: CheckResult["geo"]): string {
    const result: CheckResult = {
      ip: "9.9.9.9",
      checkedAt: "2026-05-29T00:00:00Z",
      riskScore: 0,
      verdict: "clean",
      geo,
      sources: [],
      stats: makeStats(),
    };
    return buildNarrative(result).join(" ");
  }

  it("hedges 'residential or business' when ip-api gave no classification", () => {
    const text = ip({ isp: "Quad9", asn: "AS19281 Quad9" });
    // The data only says "unclassified" — don't assert it as fact (issue #10).
    expect(text).toContain("likely a residential or business endpoint");
  });

  it("does not hedge when ip-api positively classifies the type", () => {
    const text = ip({ isHosting: true, isp: "Cloudflare" });
    expect(text).toContain("hosting or datacenter infrastructure");
    expect(text).not.toContain("likely a residential");
  });
});

describe("consensusBuckets — separates key-gated skips from unsupported ones", () => {
  it("counts a disabled source as no-key and a family-skipped one as unsupported", () => {
    // A key-gated source that never ran: enabled false.
    const noKey = makeSource({
      name: "VirusTotal",
      status: "skipped",
      enabled: false,
      summary: "Set VIRUSTOTAL_API_KEY to enable",
    });
    // A source skipped because it cannot answer for this IP family: enabled
    // true, because nothing is wrong with its configuration.
    const unsupported = makeSource({
      name: "Feodo",
      status: "skipped",
      enabled: true,
      summary: "Does not support IPv6",
    });
    const ran = makeSource({ name: "AbuseIPDB", score: 0 });
    const result: ResultLike = {
      riskScore: 0,
      verdict: "clean",
      checkedAt: "2026-08-15T00:00:00Z",
      sources: [noKey, unsupported, ran],
      stats: makeStats({ total: 3 }),
    };
    const b = consensusBuckets(result);
    expect(b.skipped).toBe(2); // both still skipped in the total
    expect(b.noKey).toBe(1);
    expect(b.unsupported).toBe(1);
    // Reporting "2 no key" here would tell an analyst to go find an API key
    // for a source that simply cannot answer for this address family.
  });
});

describe("consensusBuckets — excludes weight-0 context sources (issue #8)", () => {
  it("does not count a zero-weight geolocation source as a responding/clean detector", () => {
    const geo = makeSource({ name: "ip-api", weight: 0 }); // context-only, ok
    const feed1 = makeSource({ name: "Feodo", score: 0 });
    const feed2 = makeSource({ name: "ET Open", score: 0 });
    const result: ResultLike = {
      riskScore: 0,
      verdict: "clean",
      checkedAt: "2026-05-29T00:00:00Z",
      sources: [geo, feed1, feed2],
      stats: makeStats({ total: 3 }),
    };
    const b = consensusBuckets(result);
    // ip-api (weight 0) must not inflate the detector tally — matches the
    // narrative's "of N TI sources" and the issue #5 fix.
    expect(b.total).toBe(2);
    expect(b.responded).toBe(2);
    expect(b.clean).toBe(2);
    expect(b.flagged).toBe(0);
  });

  it("counts a flagged scoring source and keeps it out of the clean tally", () => {
    const flagging = makeSource({ name: "Feodo", score: 95, malicious: true });
    const quiet = makeSource({ name: "ET Open", score: 0 });
    const geo = makeSource({ name: "ip-api", weight: 0 });
    const result: ResultLike = {
      riskScore: 75,
      verdict: "malicious",
      checkedAt: "2026-05-29T00:00:00Z",
      sources: [flagging, quiet, geo],
      stats: makeStats(),
    };
    const b = consensusBuckets(result);
    expect(b.responded).toBe(2);
    expect(b.flagged).toBe(1);
    expect(b.clean).toBe(1);
  });

  it("tallies non-ok scoring sources (skipped/errored) but never the context source", () => {
    const ok = makeSource({ name: "Feodo", score: 0 });
    const skipped = makeSource({ name: "VirusTotal", status: "skipped" });
    const errored = makeSource({ name: "OTX", status: "error" });
    const geo = makeSource({ name: "ip-api", weight: 0 });
    const result: ResultLike = {
      riskScore: 0,
      verdict: "clean",
      checkedAt: "2026-05-29T00:00:00Z",
      sources: [ok, skipped, errored, geo],
      stats: makeStats(),
    };
    const b = consensusBuckets(result);
    expect(b.total).toBe(3); // 3 scoring sources; ip-api excluded
    expect(b.responded).toBe(1);
    expect(b.skipped).toBe(1);
    expect(b.errored).toBe(1);
  });
});

describe("buildHashNarrative — file description soundness (HN-2/3/4)", () => {
  function mkHash(over: Partial<HashCheckResult>): HashCheckResult {
    return {
      hash: "a".repeat(64),
      algorithm: "sha256",
      checkedAt: "2026-05-30T00:00:00Z",
      riskScore: 95,
      verdict: "malicious",
      sources: [makeSource({ name: "VirusTotal", score: 100, malicious: true })],
      stats: makeStats({ flagged: 1 }),
      ...over,
    };
  }

  // HN-2: size is a trailing parenthetical (not an "of {size}" infix) and the
  // indefinite article matches the file type's initial sound.
  it("renders 'an exe file (3.4 MB)' — fixed word order + article", () => {
    const text = buildHashNarrative(
      mkHash({
        context: {
          malwareFamily: "WannaCry",
          fileType: "exe",
          fileSize: 3514368,
          fileName: "x.exe",
        },
      }),
    ).join(" ");
    expect(text).toContain("an exe file (3.4 MB)");
    expect(text).not.toContain("of 3.4 MB file");
    expect(text).not.toContain("a exe");
  });

  it("uses 'a' for a consonant-initial type", () => {
    const text = buildHashNarrative(
      mkHash({ context: { fileType: "Powershell", fileSize: 68 } }),
    ).join(" ");
    expect(text).toContain("a Powershell file (68 B)");
  });

  // HN-3: hex/imphash tokens and bare platform words are not threat categories.
  it("drops hex/imphash and bare-platform tokens from the 'flagged for' clause", () => {
    const text = buildHashNarrative(
      mkHash({
        context: { malwareFamily: "WannaCry" },
        sources: [
          makeSource({
            name: "VirusTotal",
            score: 100,
            malicious: true,
            categories: [
              "WannaCry",
              "9698f46495ce9401c8bcaf9a2afe1598", // imphash (32 hex)
              "Windows", // platform, not a threat reason
              "calls-wmi",
            ],
          }),
        ],
      }),
    ).join(" ");
    expect(text).toContain("flagged it for");
    expect(text).not.toContain("9698f46495ce9401c8bcaf9a2afe1598");
    expect(text).not.toMatch(/flagged it for[^.]*\bWindows\b/);
    expect(text).toContain("WannaCry");
  });

  // HN-4: fileName is the best-known name, not provably the earliest seen.
  it("says 'seen as' rather than 'first seen as'", () => {
    const text = buildHashNarrative(
      mkHash({
        context: { malwareFamily: "Emotet", fileType: "exe", fileName: "invoice.exe" },
      }),
    ).join(" ");
    expect(text).toContain('seen as "invoice.exe"');
    expect(text).not.toContain('first seen as');
  });
});

describe("buildNarrative — BGP prefix + historical activity clause", () => {
  function makeResult(over: Partial<CheckResult> = {}): CheckResult {
    return {
      ip: "171.96.190.33",
      checkedAt: "2026-06-15T00:00:00Z",
      riskScore: 7,
      verdict: "clean",
      geo: {
        country: "Thailand",
        city: "Bangkok",
        asn: "AS17552",
        asnOrg: "True Internet Corporation Co. Ltd.",
        isp: "True Internet Corporation Co. Ltd.",
        reverse: "ppp-171-96-190-33.revip8.asianet.co.th",
      },
      sources: [],
      stats: makeStats(),
      ...over,
    };
  }

  it("weaves the announced BGP prefix into the type sentence", () => {
    const ripe = makeSource({
      name: "RIPEstat",
      weight: 0,
      details: { prefix: "171.96.190.0/24" },
    });
    const text = buildNarrative(makeResult({ sources: [ripe] })).join(" ");
    expect(text).toContain("with an active BGP prefix of 171.96.190.0/24");
  });

  it("appends a faithful abuse + history clause to the clean line", () => {
    const abuse = makeSource({
      name: "AbuseIPDB",
      score: 0,
      details: { totalReports: 0 },
    });
    const text = buildNarrative(
      makeResult({
        sources: [abuse],
        history: [
          { checkedAt: "2026-01-01T00:00:00Z", riskScore: 5, verdict: "clean" },
        ],
      }),
    ).join(" ");
    expect(text).toContain(
      "None of the 1 TI sources flagged this address, with no significant AbuseIPDB reports and no prior malicious history on record.",
    );
  });

  it("treats stale low-confidence reports as not significant", () => {
    // Hundreds of reports but ~0% confidence (e.g. 8.8.8.8) must not read as
    // abusive on a clean IP.
    const abuse = makeSource({
      name: "AbuseIPDB",
      score: 5,
      details: { totalReports: 135 },
    });
    const text = buildNarrative(makeResult({ sources: [abuse] })).join(" ");
    expect(text).toContain("no significant AbuseIPDB reports");
    expect(text).not.toContain("135");
  });

  it("reports the AbuseIPDB count with confidence when it is significant", () => {
    // Below FLAG_THRESHOLD (40) so the IP stays clean, but above the
    // significance floor (25) so the count is surfaced.
    const abuse = makeSource({
      name: "AbuseIPDB",
      score: 30,
      details: { totalReports: 14 },
    });
    const text = buildNarrative(makeResult({ sources: [abuse] })).join(" ");
    expect(text).toContain("14 AbuseIPDB reports at 30% confidence on record");
  });

  it("omits the clause when neither abuse nor history is available", () => {
    const feodo = makeSource({ name: "Feodo", score: 0 });
    const text = buildNarrative(makeResult({ sources: [feodo] })).join(" ");
    expect(text).toContain("None of the 1 TI sources flagged this address.");
    expect(text).not.toContain("on record");
  });
});

describe("scoreExplanation — reads the breakdown (B5)", () => {
  const base = (over: Partial<ResultLike>): ResultLike => ({
    riskScore: 50,
    verdict: "suspicious",
    checkedAt: "2026-06-21T00:00:00Z",
    sources: [],
    stats: makeStats(),
    ...over,
  });

  it("returns the EICAR note for a benign override", () => {
    const text = scoreExplanation(
      base({
        riskScore: 0,
        verdict: "clean",
        sources: [makeSource({ name: "VirusTotal", score: 90, malicious: true })],
        scoreBreakdown: {
          effectiveMax: 90,
          weightedAvg: 90,
          floorApplied: false,
          borderline: false,
          allowlistSuppressed: false,
          benignOverride: "eicar-test-file",
        },
      }),
    ).join(" ");
    expect(text).toContain("EICAR");
    expect(text).toContain("benign");
  });

  it("names the dominant source from the breakdown field, not a re-derivation", () => {
    const vt = makeSource({ name: "VirusTotal", score: 80, weight: 1 }); // eff 80
    const ipsum = makeSource({ name: "IPsum", score: 90, weight: 0.3 }); // eff 27
    // Breakdown deliberately points at IPsum; a re-derivation would pick VT.
    const text = scoreExplanation(
      base({
        riskScore: 60,
        sources: [vt, ipsum],
        scoreBreakdown: {
          effectiveMax: 27,
          weightedAvg: 60,
          dominantSourceId: "ipsum",
          floorApplied: false,
          borderline: false,
          allowlistSuppressed: false,
        },
      }),
    ).join(" ");
    expect(text).toContain("IPsum (which rated it 90)");
  });

  it("explains a definitive high-weight floor and a borderline score", () => {
    const text = scoreExplanation(
      base({
        riskScore: 75,
        verdict: "malicious",
        sources: [makeSource({ name: "AbuseIPDB", score: 60, malicious: true })],
        scoreBreakdown: {
          effectiveMax: 60,
          weightedAvg: 60,
          dominantSourceId: "abuseipdb",
          floorApplied: true,
          flooredBy: "abuseipdb",
          floorValue: 75,
          borderline: true,
          allowlistSuppressed: false,
        },
      }),
    ).join(" ");
    expect(text).toContain("AbuseIPDB");
    expect(text).toContain("75");
    expect(text).toMatch(/borderline/i);
  });

  it("explains a quorum floor distinctly from a definitive one", () => {
    const text = scoreExplanation(
      base({
        riskScore: 50,
        verdict: "suspicious",
        sources: [
          makeSource({ name: "Tor", score: 30, weight: 0.4, malicious: true }),
          makeSource({ name: "DNSBL", score: 40, weight: 0.5, malicious: true }),
        ],
        scoreBreakdown: {
          effectiveMax: 20,
          weightedAvg: 36,
          dominantSourceId: "dnsbl",
          floorApplied: true,
          flooredBy: "dnsbl",
          floorValue: 50,
          borderline: false,
          allowlistSuppressed: false,
        },
      }),
    ).join(" ");
    expect(text).toContain("agreeing");
    expect(text).toContain("50");
  });

  it("notes when an allowlist suppressed the floor", () => {
    const text = scoreExplanation(
      base({
        riskScore: 20,
        verdict: "low",
        sources: [
          makeSource({ name: "Maltiverse", score: 0, weight: 0.7, allowlisted: true }),
        ],
        scoreBreakdown: {
          effectiveMax: 0,
          weightedAvg: 20,
          dominantSourceId: "maltiverse",
          floorApplied: false,
          borderline: false,
          allowlistSuppressed: true,
        },
      }),
    ).join(" ");
    expect(text).toMatch(/allowlist/i);
  });

  it("returns nothing when no scoring source settled", () => {
    expect(
      scoreExplanation(base({ sources: [], scoreBreakdown: undefined })),
    ).toEqual([]);
  });
});

describe("buildNarrative — the remaining network types and location shapes", () => {
  function ip(geo: CheckResult["geo"]): string {
    const result: CheckResult = {
      ip: "10.0.0.1",
      checkedAt: "2026-05-29T00:00:00Z",
      riskScore: 0,
      verdict: "clean",
      geo,
      sources: [],
      stats: makeStats(),
    };
    return buildNarrative(result).join(" ");
  }

  it("names a mobile carrier address", () => {
    expect(ip({ isMobile: true, isp: "AIS" })).toContain(
      "a mobile carrier (cellular) address",
    );
  });

  // The operator falls back isp -> org -> asnOrg, so a provider that fills only
  // the later fields still gets named rather than dropped.
  it("takes the operator from org when isp is absent", () => {
    expect(ip({ org: "Contoso Ltd" })).toContain("operated by Contoso Ltd");
  });

  it("takes the operator from asnOrg when isp and org are both absent", () => {
    expect(ip({ asnOrg: "Fabrikam" })).toContain("operated by Fabrikam");
  });

  it("omits the operator clause entirely when nothing names one", () => {
    expect(ip({ country: "Thailand" })).not.toContain("operated by");
  });

  // ip-api bundles the org name into the ASN field, so only the AS number is
  // kept; a field that is just the number passes through unchanged.
  it("keeps a bare AS number as-is", () => {
    expect(ip({ asn: "AS17552" })).toContain("(AS17552)");
  });

  it("geolocates without reverse DNS when only a place is known", () => {
    const text = ip({ country: "Thailand", city: "Bangkok" });
    expect(text).toContain("It is geolocated to Bangkok, Thailand.");
    expect(text).not.toContain("reverse DNS");
  });

  it("reports reverse DNS alone when there is no place", () => {
    expect(ip({ reverse: "dns.google" })).toContain(
      "Its reverse DNS is dns.google.",
    );
  });

  it("says nothing about location when neither is known", () => {
    const text = ip({ isHosting: true });
    expect(text).not.toContain("geolocated");
    expect(text).not.toContain("reverse DNS");
  });
});

describe("buildHashNarrative — the remaining identity shapes", () => {
  function mkHash(over: Partial<HashCheckResult>): HashCheckResult {
    return {
      hash: "b".repeat(64),
      algorithm: "sha256",
      checkedAt: "2026-05-30T00:00:00Z",
      riskScore: 95,
      verdict: "malicious",
      sources: [makeSource({ name: "VirusTotal", score: 100, malicious: true })],
      stats: makeStats({ flagged: 1 }),
      ...over,
    };
  }

  // A vendor threat label is the fallback identity when no family is named;
  // one or the other, never both, so the sentence cannot say it twice.
  it("classifies by threat label when no malware family is known", () => {
    const text = buildHashNarrative(
      mkHash({ context: { threatLabel: "Trojan.Generic" } }),
    ).join(" ");
    expect(text).toContain("classified as Trojan.Generic");
    expect(text).not.toContain("identified as");
  });

  it("prefers the family over the threat label when both are present", () => {
    const text = buildHashNarrative(
      mkHash({ context: { malwareFamily: "WannaCry", threatLabel: "Trojan" } }),
    ).join(" ");
    expect(text).toContain("identified as WannaCry");
    expect(text).not.toContain("classified as Trojan");
  });

  // A type already naming the kind must not gain a redundant " file".
  it("drops the redundant noun when the type already names the kind", () => {
    const text = buildHashNarrative(
      mkHash({ context: { fileType: "PDF document" } }),
    ).join(" ");
    expect(text).toContain("a PDF document");
    expect(text).not.toContain("PDF document file");
  });

  it("falls back to size alone when the type is unknown", () => {
    const text = buildHashNarrative(
      mkHash({ context: { fileSize: 1024 } }),
    ).join(" ");
    expect(text).toContain("in size");
  });

  // With nothing describing the file but a name, the sentence changes shape
  // rather than emitting "It is , seen as …".
  it("uses the name-only sentence when nothing else describes the file", () => {
    const text = buildHashNarrative(
      mkHash({ context: { fileName: "invoice.doc" } }),
    ).join(" ");
    expect(text).toContain('It has been seen as "invoice.doc".');
    expect(text).not.toContain("It is ,");
  });

  it("reports the first-observed date when one is on record", () => {
    const text = buildHashNarrative(
      mkHash({ context: { fileType: "exe", firstSeen: "2024-03-04T00:00:00Z" } }),
    ).join(" ");
    expect(text).toContain("First observed");
  });

  it("omits the first-observed sentence when no source reported one", () => {
    const text = buildHashNarrative(
      mkHash({ context: { fileType: "exe" } }),
    ).join(" ");
    expect(text).not.toContain("First observed");
  });

  // formatDate passes an unparseable value straight through rather than
  // dropping it, so a feed's own odd date string is shown as it arrived rather
  // than silently becoming "no first-observed date on record".
  it("shows an unparseable date as the source gave it", () => {
    const text = buildHashNarrative(
      mkHash({ context: { fileType: "exe", firstSeen: "not-a-date" } }),
    ).join(" ");
    expect(text).toContain("First observed not-a-date.");
  });
});

describe("buildDomainNarrative — resolution detail", () => {
  function mkDomain(over: Partial<DomainCheckResult>): DomainCheckResult {
    return {
      domain: "example.com",
      checkedAt: "2026-05-30T00:00:00Z",
      riskScore: 0,
      verdict: "clean",
      sources: [],
      stats: makeStats(),
      ...over,
    };
  }

  it("counts the other hosts and names the mail exchanger", () => {
    const text = buildDomainNarrative(
      mkDomain({
        context: { resolvedIps: ["1.1.1.1", "1.0.0.1", "8.8.8.8"], mx: ["mx.example.com"] },
      }),
    ).join(" ");
    expect(text).toContain("It currently resolves to 1.1.1.1 and 2 other hosts");
    expect(text).toContain("with mail handled by mx.example.com");
  });

  it("says neither when a single address carries no mail", () => {
    const text = buildDomainNarrative(
      mkDomain({ context: { resolvedIps: ["1.1.1.1"] } }),
    ).join(" ");
    expect(text).toContain("It currently resolves to 1.1.1.1.");
    expect(text).not.toContain("other host");
    expect(text).not.toContain("mail handled by");
  });
});
