import { describe, expect, it } from "vitest";
import {
  assembleDomainResult,
  assembleHashResult,
  assembleIpResult,
} from "./assemble";
import type { SourceMeta, SourceResult } from "./types";

function meta(id: string, weight: number): SourceMeta {
  return {
    id,
    name: id,
    url: `https://${id}`,
    category: "reputation",
    requiresKey: false,
    weight,
  };
}

function ok(
  id: string,
  weight: number,
  score: number,
  extra: Partial<SourceResult> = {},
): SourceResult {
  return {
    source: meta(id, weight),
    enabled: true,
    durationMs: 10,
    status: "ok",
    score,
    ...extra,
  };
}

describe("assembleIpResult", () => {
  it("aggregates score/verdict/stats from settled sources", () => {
    const sources = [
      ok("vt", 1, 0),
      ok("abuse", 1, 0),
      ok("feodo", 1, 90, { malicious: true }),
    ];
    const r = assembleIpResult("1.2.3.4", sources, "2026-06-05T00:00:00Z");
    expect(r.ip).toBe("1.2.3.4");
    expect(r.verdict).toBe("malicious");
    expect(r.riskScore).toBeGreaterThanOrEqual(75);
    expect(r.stats.total).toBe(3);
    expect(r.stats.flagged).toBe(1);
  });

  it("is monotonic as sources stream in: a provisional subset matches a full assembly of that subset", () => {
    const all = [
      ok("vt", 1, 0),
      ok("greynoise", 0.8, 0),
      ok("ipapi", 0, 0, { geo: { country: "Thailand", asn: "AS4750" } }),
    ];
    // Provisional view after only the first two have streamed in.
    const provisional = assembleIpResult("1.2.3.4", all.slice(0, 2), "t");
    expect(provisional.verdict).toBe("clean");
    expect(provisional.stats.total).toBe(2);
    // Final view once the context source lands enriches geo without moving score.
    const final = assembleIpResult("1.2.3.4", all, "t");
    expect(final.riskScore).toBe(provisional.riskScore);
    expect(final.geo?.country).toBe("Thailand");
  });

  it("returns an unknown verdict when no scored sources have settled yet", () => {
    const r = assembleIpResult("1.2.3.4", [], "t");
    expect(r.verdict).toBe("unknown");
    expect(r.stats.total).toBe(0);
  });
});

describe("assembleDomainResult — NXDOMAIN verdict (P1.2)", () => {
  const dns = (nxdomain: boolean): SourceResult =>
    ok("dns", 0, 0, { domainContext: { nxdomain, resolvedIps: [] } });

  it("rates an unflagged NXDOMAIN domain unknown, not clean", () => {
    // Blocklists answering "not listed" for a name that doesn't exist is
    // vacuous — it must not produce a clean (vetted-good) verdict.
    const r = assembleDomainResult(
      "no-such-name.example",
      [ok("surbl", 1, 0), ok("urlhaus", 1, 0), dns(true)],
      "t",
    );
    expect(r.verdict).toBe("unknown");
    expect(r.riskScore).toBe(0);
    expect(r.context?.nxdomain).toBe(true);
  });

  it("keeps the scored verdict when a flagging source hits despite NXDOMAIN", () => {
    // A taken-down C2 can return NXDOMAIN while still being blocklisted.
    const r = assembleDomainResult(
      "sinkholed-c2.example",
      [ok("urlhaus", 1, 90, { malicious: true }), ok("surbl", 1, 0), dns(true)],
      "t",
    );
    expect(r.verdict).toBe("malicious");
  });

  it("keeps a low verdict on NXDOMAIN — only vacuous clean is downgraded", () => {
    // A weak scored signal (e.g. a delisted URLhaus entry) is information;
    // downgrading it to unknown would hide it.
    const r = assembleDomainResult(
      "delisted.example",
      [ok("urlhaus", 1, 20), ok("surbl", 1, 0), dns(true)],
      "t",
    );
    expect(r.verdict).toBe("low");
  });

  it("still rates a resolving quiet domain clean", () => {
    const r = assembleDomainResult(
      "example.com",
      [ok("surbl", 1, 0), ok("urlhaus", 1, 0), dns(false)],
      "t",
    );
    expect(r.verdict).toBe("clean");
  });
});

describe("assembleIpResult — breakdown wiring", () => {
  it("attaches the score breakdown", () => {
    const r = assembleIpResult(
      "1.2.3.4",
      [ok("feodo", 1, 60, { malicious: true })],
      "t",
    );
    expect(r.scoreBreakdown).toBeDefined();
    expect(r.scoreBreakdown?.floorApplied).toBe(true);
    expect(r.scoreBreakdown?.floorValue).toBe(75);
  });
});

describe("assembleHashResult — benign override (B2)", () => {
  it("forces EICAR clean despite vendor detections, keeping the rows", () => {
    const r = assembleHashResult(
      "44d88612fea8a8f36de82e1278abb02f",
      "md5",
      [
        ok("vt", 1, 90, { malicious: true }),
        ok("kaspersky", 0.9, 90, { malicious: true }),
      ],
      "t",
    );
    expect(r.verdict).toBe("clean");
    expect(r.riskScore).toBe(0);
    expect(r.scoreBreakdown?.benignOverride).toBe("eicar-test-file");
    expect(r.scoreBreakdown?.floorApplied).toBe(false);
    // The AV detections stay visible on the source rows.
    expect(r.sources.filter((s) => s.malicious).length).toBe(2);
  });

  it("scores a non-benign hash normally", () => {
    const r = assembleHashResult(
      "a".repeat(64),
      "sha256",
      [ok("vt", 1, 90, { malicious: true })],
      "t",
    );
    expect(r.verdict).toBe("malicious");
    expect(r.scoreBreakdown?.benignOverride).toBeUndefined();
  });
});

describe("assembleHashResult context union", () => {
  it("unions capabilities and mitre techniques across sources, deduped", () => {
    const results = [
      ok("triage", 0.8, 90, {
        hashContext: {
          capabilities: [{ label: "Downloads executable", mitre: ["T1105"] }],
          mitreTechniques: [{ id: "T1105" }],
        },
      }),
      ok("hybrid", 0.85, 80, {
        hashContext: {
          capabilities: [{ label: "downloads executable" }, { label: "Writes run key" }],
          mitreTechniques: [{ id: "T1105" }, { id: "T1547" }],
        },
      }),
    ];
    const r = assembleHashResult(
      "d41d8cd98f00b204e9800998ecf8427e",
      "md5",
      results,
      "2026-07-18T00:00:00Z",
    );
    expect(r.context?.capabilities).toEqual([
      { label: "Downloads executable", mitre: ["T1105"] },
      { label: "Writes run key" },
    ]);
    expect(r.context?.mitreTechniques).toEqual([{ id: "T1105" }, { id: "T1547" }]);
  });
});
