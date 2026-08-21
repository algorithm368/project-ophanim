import { describe, expect, it } from "vitest";
import {
  SCANNER_CAP,
  applyScannerPolicy,
  isIdentifiedScanner,
} from "@/lib/ti/scanner-policy";
import type { SourceResult } from "@/lib/ti/types";

function src(opts: {
  id: string;
  categories?: string[];
  score?: number;
  malicious?: boolean;
  allowlisted?: boolean;
  status?: SourceResult["status"];
}): SourceResult {
  return {
    source: {
      id: opts.id,
      name: opts.id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: 1,
    },
    enabled: true,
    durationMs: 1,
    status: opts.status ?? "ok",
    score: opts.score,
    malicious: opts.malicious,
    allowlisted: opts.allowlisted,
    categories: opts.categories,
  };
}

const shodan = src({
  id: "scanner-id",
  categories: ["internet-scanner", "research-scanner"],
  score: 0,
  allowlisted: true,
});
const vt = src({ id: "virustotal", score: 100, malicious: true, categories: ["port scan"] });
const abuse = src({ id: "abuseipdb", score: 100, malicious: true, categories: ["Port Scan"] });

describe("isIdentifiedScanner", () => {
  it("requires a positive identification, not merely a vouch", () => {
    expect(isIdentifiedScanner([shodan])).toBe(true);
    // An allowlist hit with no scanner category is a different statement.
    expect(
      isIdentifiedScanner([src({ id: "greynoise", allowlisted: true, categories: ["benign"] })]),
    ).toBe(true);
    expect(
      isIdentifiedScanner([src({ id: "abuseipdb", allowlisted: true, categories: [] })]),
    ).toBe(false);
  });

  it("ignores an identification source that did not answer", () => {
    expect(
      isIdentifiedScanner([{ ...shodan, status: "rate_limited" }]),
    ).toBe(false);
  });
});

describe("applyScannerPolicy", () => {
  it("holds an identified scanner at suspicious", () => {
    // 71.6.146.185: VirusTotal and AbuseIPDB both assert malicious, and both
    // are reporting the scanning the operator publishes that it does.
    const r = applyScannerPolicy("malicious", [shodan, vt, abuse]);
    expect(r.verdict).toBe(SCANNER_CAP);
    expect(r.capped).toBe(true);
  });

  it("leaves a verdict below the cap alone", () => {
    expect(applyScannerPolicy("suspicious", [shodan, vt]).capped).toBe(false);
    expect(applyScannerPolicy("clean", [shodan]).capped).toBe(false);
  });

  it("keeps the cap when abuse reports mislabel a scan as an attack", () => {
    // The reports behind 71.6.146.185 are categorised "Brute-Force" and
    // "Hacking" by the people it scanned. Reading those as evidence of
    // something beyond scanning lifts the cap on the exact address it is for.
    const mislabelled = src({
      id: "abuseipdb",
      score: 100,
      malicious: true,
      categories: ["Brute-Force", "Port Scan", "Hacking"],
    });
    expect(applyScannerPolicy("malicious", [shodan, mislabelled]).capped).toBe(true);
  });

  it("lifts the cap when a source reports more than scanning", () => {
    // A scanner that also serves malware is not described by "scanner".
    const c2 = src({ id: "feodo", malicious: true, categories: ["botnet-c2"] });
    const r = applyScannerPolicy("malicious", [shodan, vt, c2]);
    expect(r.verdict).toBe("malicious");
    expect(r.capped).toBe(false);
  });

  it("does not cap an address that never identified itself", () => {
    // The cap needs a positive identification; an absence of evidence is not one.
    expect(applyScannerPolicy("malicious", [vt, abuse]).capped).toBe(false);
  });

  it("tolerates a flagging source with no categories at all", () => {
    const bare = src({ id: "ipsum", score: 90 });
    expect(applyScannerPolicy("malicious", [shodan, bare]).capped).toBe(true);
  });
});
