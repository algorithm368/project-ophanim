import { describe, expect, it, vi } from "vitest";
import type { SourceMeta, SourceResult } from "../types";

const runAll = vi.fn();
vi.mock("../orchestrate", () => ({ runAll: (...a: unknown[]) => runAll(...a) }));
const p = await import("./pass0");

function res(id: string, weight: number, extra: Partial<SourceResult> = {}): SourceResult {
  const meta: SourceMeta = { id, name: id, url: "", category: "blocklist", requiresKey: false, weight };
  return { source: meta, enabled: true, durationMs: 1, status: "ok", score: 0, ...extra };
}
const row = { id: 7, indicator: "1.2.3.4", kind: "ip" as const, state: "pending" as const, results: [], pending: [], missing: [] };

describe("pass 0", () => {
  it("calls a malicious listing or ipsum level 3 strong", () => {
    expect(p.summarizePass0([res("feodo", 1, { score: 100, malicious: true })])).toMatchObject({ strong: true, listedBy: ["feodo"] });
    expect(p.summarizePass0([res("ipsum", 0.7, { score: 30 })]).strong).toBe(true);
  });

  it("calls ipsum level 1 or 2 weak, and nothing none", () => {
    expect(p.summarizePass0([res("ipsum", 0.7, { score: 20 })])).toMatchObject({ strong: false, listedBy: ["ipsum"] });
    expect(p.summarizePass0([res("ipsum", 0.7), { ...res("feodo", 1), status: "error" }])).toMatchObject({ strong: false, listedBy: [] });
  });

  it("runs only the pass 0 feeds for the IP's family", async () => {
    runAll.mockResolvedValue([]);
    await p.runPass0("2001:4860:4860::8888");
    expect(runAll.mock.calls[0][0].map((s: { meta: SourceMeta }) => s.meta.id)).toEqual(["spamhaus-drop"]);
  });

  it("settles rows that do not escalate", () => {
    const none = { riskScore: 0, verdict: "clean" as const, listedBy: [], strong: false };
    const weak = { riskScore: 14, verdict: "clean" as const, listedBy: ["ipsum"], strong: false };
    const strong = { riskScore: 75, verdict: "malicious" as const, listedBy: ["spamhaus-drop"], strong: true };
    expect(p.settlePass0(row, none, false)).toMatchObject({ id: 7, state: "feed-only", note: "Not in feeds, unchecked", verdict: undefined });
    expect(p.settlePass0(row, weak, false)).toMatchObject({ state: "feed-only", note: "Weak listing (ipsum), unchecked", listedBy: ["ipsum"] });
    expect(p.settlePass0(row, weak, true)).toBeNull();
    expect(p.settlePass0(row, strong, false)).toBeNull();
  });
});
