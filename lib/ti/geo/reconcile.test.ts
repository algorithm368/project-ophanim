import { describe, expect, it } from "vitest";
import type { SourceResult } from "../types";
import { reconcileGeo } from "./reconcile";

/** Minimal SourceResult factory for reconcile tests. */
function r(id: string, geo: Record<string, unknown>): SourceResult {
  return {
    source: { id, name: id, url: "", category: "context", requiresKey: false, weight: 0 },
    enabled: true,
    status: "ok",
    durationMs: 1,
    geo,
  } as unknown as SourceResult;
}

describe("reconcileGeo — categorical fields", () => {
  it("returns undefined when no source has geo", () => {
    expect(reconcileGeo([])).toBeUndefined();
  });

  it("unanimous agreement is high confidence", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin" }),
      r("b", { city: "Berlin" }),
      r("c", { city: "Berlin" }),
    ])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("high");
    expect(res.city!.agreement).toBeCloseTo(1);
    expect(res.city!.sources.sort()).toEqual(["a", "b", "c"]);
    expect(res.city!.alternatives).toBeUndefined();
  });

  it("a single dissenter against a 2/3 majority is high and records alternatives", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin" }),
      r("b", { city: "Berlin" }),
      r("c", { city: "Munich" }),
    ])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("high");
    expect(res.city!.agreement).toBeCloseTo(2 / 3);
    expect(res.city!.alternatives).toEqual([{ value: "Munich", sources: ["c"] }]);
  });

  it("a contested plurality below 2/3 is medium", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin" }),
      r("b", { city: "Munich" }),
      r("c", { city: "Hamburg" }),
      r("d", { city: "Berlin" }),
      r("e", { city: "Munich" }),
    ])!;
    // Berlin & Munich tie at 2 each -> not a strict plurality -> low.
    expect(res.city!.confidence).toBe("low");
  });

  it("a single provider is low confidence", () => {
    const res = reconcileGeo([r("a", { city: "Berlin" })])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("low");
    expect(res.city!.agreement).toBeCloseTo(1);
  });

  it("normalizes ASN before voting", () => {
    const res = reconcileGeo([
      r("a", { asn: "AS15169 Google LLC" }),
      r("b", { asn: "15169" }),
    ])!;
    expect(res.asn!.value).toBe("AS15169 Google LLC");
    expect(res.asn!.confidence).toBe("high");
  });

  it("counts only providers that reported the field", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin", country: "Germany" }),
      r("b", { country: "Germany" }),
    ])!;
    expect(res.city!.agreement).toBeCloseTo(1); // only 'a' reported city
    expect(res.providerCount).toBe(2);
  });
});
