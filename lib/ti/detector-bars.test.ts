import { describe, expect, it } from "vitest";
import type { SourceResult, SourceStatus } from "@/lib/ti/types";
import { detectorBars, detectorCounts } from "@/lib/ti/detector-bars";

function src(
  id: string,
  status: SourceStatus,
  extra: Partial<SourceResult> = {},
  weight = 1,
): SourceResult {
  return {
    source: { id, name: id.toUpperCase(), weight },
    status,
    enabled: true,
    durationMs: 1,
    ...extra,
  } as SourceResult;
}

describe("detectorBars", () => {
  it("keeps only sources that can move the score", () => {
    const bars = detectorBars([src("vt", "ok", { score: 0 }), src("geo", "ok", { score: 0 }, 0)]);
    expect(bars.map((b) => b.id)).toEqual(["vt"]);
  });

  it("reads a listing or a score at the flag line as flagged", () => {
    const bars = detectorBars([
      src("low", "ok", { score: 39 }),
      src("line", "ok", { score: 40 }),
      src("listed", "ok", { score: 5, malicious: true }),
    ]);
    expect(Object.fromEntries(bars.map((b) => [b.id, b.kind]))).toEqual({
      low: "clean",
      line: "flagged",
      listed: "flagged",
    });
  });

  it("keeps a failure and a source that cannot answer apart, both without a score", () => {
    const bars = detectorBars([
      src("down", "error", { score: 80 }),
      src("slow", "timeout"),
      src("quota", "rate_limited"),
      src("unsupported", "skipped"),
    ]);
    expect(bars.map((b) => [b.id, b.kind, b.score])).toEqual([
      ["down", "failed", null],
      ["slow", "failed", null],
      ["quota", "failed", null],
      ["unsupported", "n/a", null],
    ]);
  });

  it("orders by kind, then loudest first, and reads a missing score as zero", () => {
    const bars = detectorBars([
      src("na", "skipped"),
      src("quiet", "ok"),
      src("clean", "ok", { score: 20 }),
      src("fail", "error"),
      src("mild", "ok", { score: 50 }),
      src("loud", "ok", { score: 100 }),
    ]);
    expect(bars.map((b) => b.id)).toEqual(["loud", "mild", "clean", "quiet", "fail", "na"]);
    expect(bars.find((b) => b.id === "quiet")!.score).toBe(0);
  });
});

describe("detectorCounts", () => {
  it("counts each kind in order and leaves out the empty ones", () => {
    const bars = detectorBars([
      src("a", "skipped"),
      src("b", "ok", { score: 90 }),
      src("c", "ok"),
      src("d", "ok"),
    ]);
    expect(detectorCounts(bars)).toEqual([
      { kind: "flagged", count: 1 },
      { kind: "clean", count: 2 },
      { kind: "n/a", count: 1 },
    ]);
  });
});
