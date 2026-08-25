import { describe, expect, it } from "vitest";
import { buildPartial } from "@/lib/ti/partial";
import type { SourceResult } from "@/lib/ti/types";

/** A settled source, shaped like the ones runSource() returns. */
function src(
  id: string,
  over: Partial<SourceResult> & { weight?: number } = {},
): SourceResult {
  const { weight = 1, ...rest } = over;
  return {
    source: { id, name: id, weight },
    status: "ok",
    ...rest,
  } as SourceResult;
}

describe("buildPartial", () => {
  it("counts detectors, adverse and clean off the settled sources", () => {
    const p = buildPartial(10, [
      src("a", { score: 80 }),
      src("b", { score: 0 }),
      src("c", { malicious: true }),
      src("d", { score: 0 }),
    ]);
    expect(p.counts.total).toBe(10);
    expect(p.counts.settled).toBe(4);
    expect(p.counts.answered).toBe(4);
    expect(p.counts.adverse).toBe(2);
    expect(p.counts.clean).toBe(2);
    expect(p.counts.stillOut).toBe(6);
  });

  // Matches consensusBuckets: a Spamhaus ZEN listing scores 38, under the
  // flagging threshold of 40, and is still evidence against the indicator.
  it("counts any score above zero as adverse, not just flagged ones", () => {
    const p = buildPartial(2, [src("zen", { score: 38 })]);
    expect(p.counts.adverse).toBe(1);
    expect(p.counts.clean).toBe(0);
  });

  // Context-only sources (weight 0, e.g. geolocation) cannot flag, so counting
  // them as detectors would disagree with the completed strip.
  it("ignores context-only sources when counting detectors", () => {
    const p = buildPartial(5, [
      src("geo", { weight: 0, score: 0 }),
      src("abuse", { score: 90 }),
    ]);
    expect(p.counts.answered).toBe(1);
    expect(p.counts.adverse).toBe(1);
  });

  // VirusTotal's 404 path returns `{ status: "ok" }` with no score at weight 1,
  // and its own comment says that is not a clean result. Counting it as clean
  // here would make the streaming strip say "3 clean" and the completed strip
  // say "2 clean, 1 no record" for the same lookup.
  it("separates a source with no record from one that found nothing wrong", () => {
    const p = buildPartial(4, [
      src("vt", {}), // status ok, no score at all
      src("otx", { score: 0 }),
      src("abuse", { score: 70 }),
    ]);
    expect(p.counts.noRecord).toBe(1);
    expect(p.counts.clean).toBe(1);
    expect(p.counts.adverse).toBe(1);
    expect(p.counts.answered).toBe(3);
  });

  it("collects every way of not answering into gaps", () => {
    const p = buildPartial(6, [
      src("a", { status: "error" }),
      src("b", { status: "timeout" }),
      src("c", { status: "rate_limited" }),
      src("d", { status: "skipped" }),
      src("e", { score: 0 }),
    ]);
    expect(p.counts.gaps).toBe(4);
    expect(p.counts.answered).toBe(1);
  });

  it("never reports a negative outstanding count", () => {
    const p = buildPartial(1, [src("a"), src("b"), src("c")]);
    expect(p.counts.stillOut).toBe(0);
  });

  it("merges context first-non-empty across settled sources", () => {
    const p = buildPartial(3, [
      src("a", { geo: { country: "", city: "Berlin" } } as Partial<SourceResult>),
      src("b", { geo: { country: "Germany", city: "Munich" } } as Partial<SourceResult>),
    ]);
    expect(p.geo?.city).toBe("Berlin");
    expect(p.geo?.country).toBe("Germany");
  });

  // The whole point of the type. A score shown mid-stream can be wrong, and
  // this is a threat-intel tool where people act on what they read.
  it("carries no score, verdict or breakdown, whatever the sources said", () => {
    const p = buildPartial(2, [src("a", { score: 99, malicious: true })]);
    const keys = Object.keys(p);
    expect(keys).not.toContain("riskScore");
    expect(keys).not.toContain("verdict");
    expect(keys).not.toContain("scoreBreakdown");
  });
});
