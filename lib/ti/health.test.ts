import { describe, expect, it } from "vitest";
import { gradeSource, median, MIN_RUNS, sortHealth, type HealthEntry, type SourceHealth } from "@/lib/ti/health";
import type { SourceMeta } from "@/lib/ti/types";

const meta = (over: Partial<SourceMeta> = {}): SourceMeta =>
  ({ id: "src", name: "Source", url: "https://x", category: "reputation", requiresKey: false, weight: 1, ...over }) as SourceMeta;

/** `ok` runs at `ms`, then `bad` runs of `status`, newest first. */
function runs(ok: number, bad = 0, ms = 100, status: HealthEntry["s"] = "error"): HealthEntry[] {
  const out: HealthEntry[] = [];
  for (let i = 0; i < bad; i++) out.push({ s: status, ms: 50, t: 1000 - i, e: `boom ${i}` });
  for (let i = 0; i < ok; i++) out.push({ s: "ok", ms, t: 900 - i });
  return out;
}

const grade = (entries: HealthEntry[], over: Partial<Parameters<typeof gradeSource>[0]> = {}) =>
  gradeSource({ meta: meta(), type: "ip", enabled: true, entries, ...over });

describe("median", () => {
  it("is null for no values", () => expect(median([])).toBeNull());
  it("picks the middle of an odd count", () => expect(median([5, 1, 3])).toBe(3));
  it("averages the middle pair of an even count", () => expect(median([4, 1, 3, 2])).toBe(2.5));
});

describe("gradeSource", () => {
  it("is no-key when the source is disabled, whatever its history", () => {
    expect(grade(runs(50), { enabled: false }).grade).toBe("no-key");
  });

  it(`is no-data under ${MIN_RUNS} counted runs`, () => {
    expect(grade(runs(MIN_RUNS - 1)).grade).toBe("no-data");
    expect(grade(runs(MIN_RUNS)).grade).toBe("healthy");
  });

  it("does not count skipped runs at all", () => {
    const entries = [...runs(0, 40, 0, "skipped"), ...runs(10)];
    const h = grade(entries);
    expect(h.runs).toBe(10);
    expect(h.okShare).toBe(1);
    expect(h.grade).toBe("healthy");
  });

  it("is failing below 50% ok, degraded at exactly 50%", () => {
    expect(grade(runs(49, 51)).grade).toBe("failing");
    expect(grade(runs(50, 50)).grade).toBe("degraded");
  });

  it("is degraded below 90% ok, healthy at exactly 90%", () => {
    expect(grade(runs(89, 11)).grade).toBe("degraded");
    expect(grade(runs(90, 10)).grade).toBe("healthy");
  });

  it("counts rate limits as not ok", () => {
    expect(grade(runs(40, 10, 100, "rate_limited")).grade).toBe("degraded");
  });

  it("is slow when the median ok latency passes half the default 8s timeout", () => {
    expect(grade(runs(10, 0, 4000)).grade).toBe("healthy");
    expect(grade(runs(10, 0, 4001)).grade).toBe("slow");
  });

  it("measures slow against the source's own timeout when it sets one", () => {
    expect(grade(runs(10, 0, 1001), { meta: meta({ timeoutMs: 2000 }) }).grade).toBe("slow");
  });

  it("takes the median over ok runs only", () => {
    const entries: HealthEntry[] = [{ s: "timeout", ms: 8000, t: 3 }, ...runs(9, 0, 200)];
    expect(grade(entries).medianMs).toBe(200);
  });

  it("reports the newest error and the newest run time", () => {
    const h = grade(runs(10, 2));
    expect(h.lastError).toBe("boom 0");
    expect(h.lastAt).toBe(1000);
  });

  it("has null share and median with no counted runs", () => {
    const h = grade([]);
    expect(h).toMatchObject({ grade: "no-data", okShare: null, medianMs: null, runs: 0, lastAt: null });
  });
});

describe("sortHealth", () => {
  const row = (name: string, grade: SourceHealth["grade"], okShare: number | null): SourceHealth =>
    ({ id: name, name, type: "ip", grade, okShare, medianMs: null, runs: 10, lastAt: null });

  it("orders by grade, then lower ok share, then name", () => {
    const sorted = sortHealth([
      row("h", "healthy", 1),
      row("k", "no-key", null),
      row("d2", "degraded", 0.8),
      row("f", "failing", 0.2),
      row("n", "no-data", null),
      row("s", "slow", 0.95),
      row("d1", "degraded", 0.6),
      row("b", "healthy", 1),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["f", "d1", "d2", "s", "b", "h", "n", "k"]);
  });
});
