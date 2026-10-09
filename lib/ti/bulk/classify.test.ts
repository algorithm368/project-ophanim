import { describe, expect, it } from "vitest";
import type { SourceMeta, SourceResult } from "../types";
import { classify } from "./classify";

function meta(id: string, weight: number): SourceMeta {
  return { id, name: id, url: "", category: "blocklist", requiresKey: false, weight };
}
function ok(id: string, weight: number, extra: Partial<SourceResult> = {}): SourceResult {
  return { source: meta(id, weight), enabled: true, durationMs: 1, status: "ok", ...extra };
}

describe("classify", () => {
  it("puts a hard listing in A", () => {
    const r = classify([ok("feodo", 1, { score: 100, malicious: true }), ok("dnsbl", 0.5, { score: 0 })]);
    expect(r.bucket).toBe("A");
    expect(r.riskScore).toBeGreaterThanOrEqual(75);
  });
  it("puts a single soft hit in B", () => {
    expect(classify([ok("dnsbl", 0.5, { score: 60 }), ok("ipsum", 0.7, { score: 0 })]).bucket).toBe("B");
  });
  it("puts a quiet row in C", () => {
    expect(classify([ok("dnsbl", 0.5, { score: 0 }), ok("ipsum", 0.7, { score: 0 })])).toMatchObject({ bucket: "C", verdict: "clean" });
  });
  it("puts a row nobody could score in C", () => {
    expect(classify([]).bucket).toBe("C");
  });
  it("puts a vouched quiet row in D and names the voucher", () => {
    expect(classify([ok("tranco", 0, { allowlisted: true }), ok("dnsbl", 0.5, { score: 0 })])).toMatchObject({ bucket: "D", vouchedBy: "tranco" });
  });
  it("does not let a vouch hide a malicious listing", () => {
    expect(classify([ok("tranco", 0, { allowlisted: true }), ok("openphish", 0.9, { score: 90, malicious: true })]).bucket).not.toBe("D");
  });
  it("ignores a vouch from a source that did not answer ok", () => {
    expect(classify([{ ...ok("tranco", 0, { allowlisted: true }), status: "error" }]).bucket).toBe("C");
  });
  it("buckets a Tranco parent vouch as D, without touching the score", () => {
    const pv = ok("tranco", 0, { details: { parentVouch: { parent: "google.com", rank: 1 } } });
    const r = classify([pv, ok("dnsbl", 0.5, { score: 0 })]);
    expect(r).toMatchObject({ bucket: "D", vouchedBy: "tranco, via google.com" });
    expect(r.riskScore).toBe(classify([ok("dnsbl", 0.5, { score: 0 })]).riskScore);
  });
  it("does not let a parent vouch hide a listing", () => {
    const pv = ok("tranco", 0, { details: { parentVouch: { parent: "b.com", rank: 9 } } });
    expect(classify([pv, ok("openphish", 0.9, { score: 90, malicious: true })]).bucket).not.toBe("D");
  });
  it("ignores malformed parent details", () => {
    expect(classify([ok("tranco", 0, { details: { parentVouch: { parent: 7 } } })]).bucket).toBe("C");
  });
});

describe("classify, the floor gate", () => {
  it("keeps a weight-0 malicious flag out of A", () => {
    expect(classify([ok("ctx", 0, { score: 100, malicious: true }), ok("dnsbl", 0.5, { score: 0 })]).bucket).not.toBe("A");
  });
  it("keeps a lone weak listing out of A", () => {
    expect(classify([ok("weak", 0.5, { score: 100, malicious: true }), ok("dnsbl", 0.5, { score: 0 })]).bucket).toBe("B");
  });
  it("puts a quorum of two weak listings in A", () => {
    const r = classify([ok("w1", 0.5, { score: 100, malicious: true }), ok("w2", 0.5, { score: 100, malicious: true })]);
    expect(r.bucket).toBe("A");
  });
  it("puts a floor that raised the score in A", () => {
    const r = classify([ok("feodo", 1, { score: 40, malicious: true }), ok("dnsbl", 0.5, { score: 0 })]);
    expect(r).toMatchObject({ bucket: "A", riskScore: 75 });
  });
  it("leaves a weak listing held off by a vouch out of A and D", () => {
    const r = classify([ok("weak", 0.5, { score: 60, malicious: true }), ok("w2", 0.5, { score: 60, malicious: true }), ok("tranco", 0, { allowlisted: true })]);
    expect(r.bucket).toBe("B");
  });
});
