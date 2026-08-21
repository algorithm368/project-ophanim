import { describe, expect, it } from "vitest";
import { isNewlyFlagged, reputationTrend } from "@/lib/ti/trend";
import type { HistorySnapshot, Verdict } from "@/lib/ti/types";

/** Oldest to newest, the order the route layers history in. */
function series(...entries: [Verdict, number][]): HistorySnapshot[] {
  return entries.map(([verdict, riskScore], i) => ({
    checkedAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    verdict,
    riskScore,
  }));
}

describe("reputationTrend", () => {
  it("returns null below two snapshots, since one point is not a trend", () => {
    expect(reputationTrend(undefined)).toBeNull();
    expect(reputationTrend([])).toBeNull();
    expect(reputationTrend(series(["malicious", 75]))).toBeNull();
  });

  it("reports a verdict that has held", () => {
    const t = reputationTrend(series(["malicious", 75], ["malicious", 75], ["malicious", 78]));
    expect(t?.steady).toBe(true);
    expect(t?.checks).toBe(3);
    expect(t?.summary).toBe("malicious on all 3 recorded checks");
  });

  it("reports a verdict that has changed, and how often it was adverse", () => {
    const t = reputationTrend(series(["clean", 2], ["suspicious", 55], ["malicious", 75]));
    expect(t?.steady).toBe(false);
    expect(t?.adverse).toBe(2);
    expect(t?.summary).toBe("flagged on 2 of 3 recorded checks, verdict has changed");
  });

  it("says plainly when an indicator has never been flagged", () => {
    const t = reputationTrend(series(["clean", 0], ["low", 20]));
    expect(t?.adverse).toBe(0);
    expect(t?.summary).toBe("never flagged across 2 recorded checks");
  });

  it("lists the verdicts seen, newest first and deduped", () => {
    const t = reputationTrend(series(["clean", 0], ["malicious", 75], ["malicious", 80]));
    expect(t?.seen).toEqual(["malicious", "clean"]);
  });

  it("ignores a malformed snapshot rather than counting it", () => {
    const t = reputationTrend([
      ...series(["clean", 0], ["clean", 0]),
      { checkedAt: "x", riskScore: 0 } as HistorySnapshot,
    ]);
    expect(t?.checks).toBe(2);
  });
});

describe("isNewlyFlagged", () => {
  it("is true when every earlier check was quiet", () => {
    // A first-time listing and a standing one call for different responses.
    expect(isNewlyFlagged(series(["clean", 2], ["clean", 5], ["malicious", 75]), "malicious")).toBe(
      true,
    );
  });

  it("is false when the indicator was already flagged before", () => {
    expect(
      isNewlyFlagged(series(["suspicious", 55], ["malicious", 75]), "malicious"),
    ).toBe(false);
  });

  it("is false when an earlier check scored past the flag threshold without a verdict change", () => {
    // A low verdict carrying a score of 60 is not a quiet history.
    expect(isNewlyFlagged(series(["low", 60], ["malicious", 75]), "malicious")).toBe(false);
  });

  it("is false for a verdict that is not an accusation", () => {
    expect(isNewlyFlagged(series(["clean", 0], ["low", 20]), "low")).toBe(false);
  });

  it("is false without enough history to say", () => {
    expect(isNewlyFlagged(series(["malicious", 75]), "malicious")).toBe(false);
    expect(isNewlyFlagged(undefined, "malicious")).toBe(false);
  });
});
