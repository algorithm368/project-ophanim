import { describe, expect, it } from "vitest";
import { scoreRationale } from "@/lib/ti/rationale";
import type { ScoreBreakdown, SourceResult } from "@/lib/ti/types";

function src(id: string, score: number, weight = 1): SourceResult {
  return {
    source: {
      id,
      name: id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight,
    },
    enabled: true,
    durationMs: 1,
    status: "ok",
    score,
  };
}

function breakdown(over: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    effectiveMax: 100,
    weightedAvg: 22,
    dominantSourceId: "abuseipdb",
    floorApplied: false,
    borderline: false,
    allowlistSuppressed: false,
    ...over,
  };
}

/** The 103.83.237.2 shape: one source at 100, everyone else near zero. */
const lone = [
  src("abuseipdb", 100),
  src("virustotal", 39),
  src("dnsbl", 0, 0.5),
  src("feodo", 0),
  src("tor-project", 0, 0.4),
];

const rowsOf = (r: ReturnType<typeof scoreRationale>) =>
  Object.fromEntries((r?.terms ?? []).map((t) => [t.label, t.value]));

describe("scoreRationale", () => {
  it("returns null when nothing scored", () => {
    expect(scoreRationale({ riskScore: 0, sources: [], scoreBreakdown: breakdown() })).toBeNull();
    expect(scoreRationale({ riskScore: 0, sources: lone })).toBeNull();
  });

  it("states every fact as a labelled number and never as prose", () => {
    // The prose version repeated the rows and then editorialised on top of
    // them. Anything the table already shows must not be restated in words.
    const r = scoreRationale({
      riskScore: 75,
      sources: lone,
      scoreBreakdown: breakdown({ floorApplied: true, floorValue: 75, borderline: true }),
    });
    expect(r?.note).toBeUndefined();
    for (const term of r!.terms) {
      expect(term.note ?? "").not.toMatch(/\brests\b|\bcorroborate\b|either way/);
    }
  });

  it("prints the consensus, which the prose version never did", () => {
    const r = scoreRationale({ riskScore: 75, sources: lone, scoreBreakdown: breakdown() });
    expect(rowsOf(r).consensus).toBe(22);
  });

  it("prints the average excluding the dominant source as its own row", () => {
    // weightedAvg includes the loud source, so on its own it overstates the
    // agreement. The gap between the two rows is the whole question.
    const r = scoreRationale({ riskScore: 75, sources: lone, scoreBreakdown: breakdown() });
    // 39 x 1 over a remaining weight of 2.9 is 13.4, against the 22 that
    // AbuseIPDB's 100 drags the full average up to.
    expect(rowsOf(r).consensus).toBe(22);
    expect(rowsOf(r).others).toBe(13);
    const others = r?.terms.find((t) => t.label === "others");
    expect(others?.note).toBe("4 sources, excluding abuseipdb");
  });

  it("shows the pre-floor blend as its own row, so the floor cannot take credit", () => {
    // Measured over nine live indicators the floor moves the score 2 to 7
    // points. The blend row is the counterfactual, stated as a number.
    const r = scoreRationale({
      riskScore: 75,
      sources: lone,
      scoreBreakdown: breakdown({ floorApplied: true, floorValue: 75, flooredBy: "abuseipdb" }),
    });
    // 0.6 x 100 + 0.4 x 22 = 68.8
    expect(rowsOf(r).blend).toBe(69);
    expect(rowsOf(r).floor).toBe(75);
    expect(rowsOf(r).final).toBe(75);
  });

  it("omits the blend row when no floor overrode it", () => {
    const r = scoreRationale({ riskScore: 69, sources: lone, scoreBreakdown: breakdown() });
    expect(r?.terms.map((t) => t.label)).not.toContain("blend");
    expect(r?.terms.at(-1)?.label).toBe("final");
  });

  it("gives the boundary as a number and a signed distance", () => {
    const r = scoreRationale({
      riskScore: 75,
      sources: lone,
      scoreBreakdown: breakdown({ borderline: true }),
    });
    const boundary = r?.terms.find((t) => t.label === "boundary");
    expect(boundary?.value).toBe(70);
    expect(boundary?.note).toBe("malicious, +5");
  });

  it("signs the distance negative below the boundary", () => {
    const r = scoreRationale({
      riskScore: 38,
      sources: lone,
      scoreBreakdown: breakdown({ borderline: true, weightedAvg: 30, effectiveMax: 43 }),
    });
    expect(r?.terms.find((t) => t.label === "boundary")?.note).toBe("suspicious, -2");
  });

  it("records a withheld floor as a row rather than a sentence", () => {
    const r = scoreRationale({
      riskScore: 30,
      sources: lone,
      scoreBreakdown: breakdown({ allowlistSuppressed: true }),
    });
    expect(rowsOf(r).floor).toBe("withheld");
  });

  it("keeps one sentence for the only fact that is not a number", () => {
    // A verdict decided by fiat has no arithmetic to show.
    const r = scoreRationale({
      riskScore: 0,
      sources: lone,
      scoreBreakdown: breakdown({ benignOverride: "eicar-test-file" }),
    });
    expect(r?.terms).toHaveLength(1);
    expect(r?.note).toContain("EICAR");
  });
});
