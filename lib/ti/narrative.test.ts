import { describe, expect, it } from "vitest";
import {
  buildDomainNarrative,
  buildHashNarrative,
  buildNarrative,
  consensusBuckets,
  type ResultLike,
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

  it("still shows the score for a rated result", () => {
    const result: CheckResult = {
      ip: "1.2.3.4",
      checkedAt: "2026-05-28T00:00:00Z",
      riskScore: 75,
      verdict: "malicious",
      sources: [makeSource({ name: "Feodo", score: 80, malicious: true })],
      stats: makeStats({ flagged: 1 }),
    };
    const text = buildNarrative(result).join(" ");
    expect(text).toContain("scoring 75/100");
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

describe("threatSentences — no rate-limit clause in the gap note", () => {
  it("omits 'hit a rate limit' but keeps the API-key gap", () => {
    const feed = makeSource({ name: "Feodo", score: 0 });
    const result: ResultLike = {
      riskScore: 0,
      verdict: "clean",
      checkedAt: "2026-05-29T00:00:00Z",
      sources: [feed],
      stats: makeStats({ skipped: 2, rateLimited: 3 }),
    };
    const text = threatSentences(result, "address").join(" ");
    expect(text).not.toContain("rate limit");
    expect(text).toContain("2 need an API key");
  });

  it("emits no gap note at all when only rate limits would have shown", () => {
    const feed = makeSource({ name: "Feodo", score: 0 });
    const result: ResultLike = {
      riskScore: 0,
      verdict: "clean",
      checkedAt: "2026-05-29T00:00:00Z",
      sources: [feed],
      stats: makeStats({ skipped: 0, rateLimited: 3 }),
    };
    const text = threatSentences(result, "address").join(" ");
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
