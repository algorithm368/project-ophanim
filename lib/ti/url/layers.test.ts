import { describe, expect, it } from "vitest";
import { selectHeadline } from "@/lib/ti/url/layers";
import type { UrlLayer } from "@/lib/ti/url/types";

const layer = (over: Partial<UrlLayer> & Pick<UrlLayer, "kind">): UrlLayer => ({
  indicator: "x",
  status: "ok",
  riskScore: 0,
  verdict: "clean",
  sources: [],
  stats: {
    total: 0,
    queried: 0,
    flagged: 0,
    skipped: 0,
    errored: 0,
    rateLimited: 0,
  },
  ...over,
});

describe("selectHeadline", () => {
  it("picks the worst layer and names it", () => {
    const head = selectHeadline([
      layer({ kind: "url", riskScore: 5, verdict: "clean" }),
      layer({ kind: "domain", riskScore: 20, verdict: "low" }),
      layer({ kind: "ip", riskScore: 80, verdict: "malicious" }),
    ]);
    expect(head).toEqual({ kind: "ip", riskScore: 80, verdict: "malicious" });
  });

  it("breaks a tie toward the more specific layer", () => {
    const head = selectHeadline([
      layer({ kind: "ip", riskScore: 50, verdict: "suspicious" }),
      layer({ kind: "url", riskScore: 50, verdict: "suspicious" }),
    ]);
    expect(head.kind).toBe("url");
  });

  it("ignores a layer that could not run", () => {
    const head = selectHeadline([
      layer({ kind: "url", riskScore: 10, verdict: "low" }),
      layer({
        kind: "ip",
        status: "unavailable",
        riskScore: 0,
        verdict: "unknown",
      }),
    ]);
    expect(head.kind).toBe("url");
    expect(head.riskScore).toBe(10);
  });

  it("ignores a not-applicable layer the same way", () => {
    const head = selectHeadline([
      layer({ kind: "url", riskScore: 10, verdict: "low" }),
      layer({ kind: "domain", status: "not-applicable", verdict: "unknown" }),
    ]);
    expect(head.kind).toBe("url");
  });

  it("is unknown when no layer ran, never clean", () => {
    const head = selectHeadline([
      layer({ kind: "url", status: "unavailable", verdict: "unknown" }),
      layer({ kind: "ip", status: "unavailable", verdict: "unknown" }),
    ]);
    expect(head.verdict).toBe("unknown");
    expect(head.riskScore).toBe(0);
  });

  it("is unknown for an empty layer list", () => {
    expect(selectHeadline([]).verdict).toBe("unknown");
  });
});
