import { describe, expect, it } from "vitest";
import { provisionalResult } from "@/lib/ti/provisional";
import { isDomainResult, isHashResult, type SourceResult } from "@/lib/ti/types";

const AT = "2026-11-20T03:31:00.000Z";

const geo: SourceResult = {
  source: { id: "ipwho", name: "ipwho.is", weight: 0 },
  status: "ok",
  geo: { country: "The Netherlands", countryCode: "NL", city: "Amsterdam" },
} as SourceResult;

describe("provisionalResult", () => {
  it("assembles an address from what has landed so far", () => {
    const r = provisionalResult("ip", "45.95.147.236", [geo], AT);
    expect("ip" in r && r.ip).toBe("45.95.147.236");
    expect(r.checkedAt).toBe(AT);
    expect(r.sources).toHaveLength(1);
    expect("geo" in r && r.geo?.city).toBe("Amsterdam");
  });

  it("is a well-formed result before anything has landed", () => {
    const r = provisionalResult("ip", "45.95.147.236", [], AT);
    expect(r.sources).toEqual([]);
    expect(r.verdict).toBeDefined();
  });

  it("assembles a domain", () => {
    const r = provisionalResult("domain", "example.org", [], AT);
    expect(isDomainResult(r) && r.domain).toBe("example.org");
  });

  it("reads a hash's algorithm off its length", () => {
    const md5 = "44d88612fea8a8f36de82e1278abb02f";
    const r = provisionalResult("hash", md5.toUpperCase(), [], AT);
    expect(isHashResult(r) && r.algorithm).toBe("md5");
    expect(isHashResult(r) && r.hash).toBe(md5);
  });

  it("still draws a hash the parser would refuse", () => {
    const r = provisionalResult("hash", "not-a-hash", [], AT);
    expect(isHashResult(r) && r.algorithm).toBe("sha256");
    expect(isHashResult(r) && r.hash).toBe("not-a-hash");
  });
});
