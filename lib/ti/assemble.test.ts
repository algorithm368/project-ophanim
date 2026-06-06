import { describe, expect, it } from "vitest";
import { assembleIpResult } from "./assemble";
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
