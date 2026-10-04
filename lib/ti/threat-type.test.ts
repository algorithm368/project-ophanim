import { describe, expect, it } from "vitest";
import {
  classifyCategory,
  isUsageCategory,
  threatTypeOf,
} from "@/lib/ti/threat-type";
import type { SourceResult } from "@/lib/ti/types";

function src(opts: {
  id: string;
  categories: string[];
  score?: number;
  malicious?: boolean;
  weight?: number;
}): SourceResult {
  return {
    source: {
      id: opts.id,
      name: opts.id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: opts.weight ?? 1,
    },
    enabled: true,
    durationMs: 1,
    status: "ok",
    score: opts.score,
    malicious: opts.malicious,
    categories: opts.categories,
  };
}

describe("classifyCategory", () => {
  it.each([
    ["Port Scan", "scanner"],
    ["Web App Attack", "web attack"],
    ["SQL Injection", "web attack"],
    ["Brute-Force", "brute force"],
    ["Email Spam", "spam"],
    ["DDoS Attack", "ddos"],
    ["tor-exit", "tor"],
    ["tor-relay", "tor"],
    ["Open Proxy", "anonymizer"],
    ["ransomware.wannacry", "ransomware"],
    ["CVE-2017-0147", "exploit"],
    ["Trojan.Win32.Emotet", "malware"],
  ])("maps %s to %s", (raw, type) => {
    expect(classifyCategory(raw)).toBe(type);
  });

  it("drops usage types, which describe the host and not a threat", () => {
    // These reach the narrative today, which is how "flagged it for Fixed Line
    // ISP" happens.
    expect(isUsageCategory("Fixed Line ISP")).toBe(true);
    expect(classifyCategory("Fixed Line ISP")).toBeUndefined();
    expect(classifyCategory("Data Center/Web Hosting/Transit")).toBeUndefined();
  });

  it("drops anything it cannot place rather than guessing", () => {
    expect(classifyCategory("Spamhaus ZEN")).toBeUndefined();
    expect(classifyCategory("")).toBeUndefined();
  });

  it("does not read 'tor' out of an unrelated substring", () => {
    // A bare /\btor\b/ pattern matched a VirusTotal label on EICAR and typed a
    // benign test file as an anonymizer.
    expect(classifyCategory("runtime-modules")).toBeUndefined();
    expect(classifyCategory("detect-debug-environment")).toBeUndefined();
  });
});

describe("threatTypeOf", () => {
  it("returns null for a clean indicator", () => {
    const sources = [src({ id: "virustotal", categories: ["malware"], score: 90 })];
    expect(threatTypeOf(sources, { verdict: "clean" })).toBeNull();
    expect(threatTypeOf(sources, { verdict: "unknown" })).toBeNull();
  });

  it("returns null when a benign override fired", () => {
    // EICAR is flagged by most engines by design; left to the tally it typed as
    // a threat while the verdict said clean.
    expect(
      threatTypeOf(
        [src({ id: "virustotal", categories: ["malware"], score: 90 })],
        { verdict: "malicious", benignOverride: "eicar-test-file" },
      ),
    ).toBeNull();
  });

  it("ignores the labels of sources that did not flag", () => {
    const quiet = src({ id: "otx", categories: ["ransomware"], score: 5 });
    expect(threatTypeOf([quiet], { verdict: "suspicious" })).toBeNull();
  });

  it("counts distinct sources, not repeated synonyms", () => {
    // One chatty adapter must not outvote two independent ones.
    const chatty = src({
      id: "kaspersky",
      categories: ["trojan.a", "trojan.b", "trojan.c", "trojan.d"],
      score: 90,
    });
    const a = src({ id: "urlhaus", categories: ["ransomware.wannacry"], score: 90 });
    const b = src({ id: "maltiverse", categories: ["ransomware"], score: 90 });
    const t = threatTypeOf([chatty, a, b], { verdict: "malicious" });
    expect(t?.type).toBe("ransomware");
    expect(t?.sources).toHaveLength(2);
  });

  it("lets a specialist's identification win a tie against an abuse tally", () => {
    // 71.6.146.185, a Shodan census host. The people it scanned filed abuse
    // reports, so "brute force" ties "scanner" on backers, and GreyNoise is the
    // one actually answering "what is this".
    const abuse = src({
      id: "abuseipdb",
      categories: ["Brute-Force", "Port Scan"],
      score: 100,
      malicious: true,
    });
    const otx = src({ id: "otx", categories: ["Brute-Force"], score: 100 });
    const greynoise = src({
      id: "greynoise",
      categories: ["internet-scanner", "benign"],
      score: 0,
    });
    const t = threatTypeOf([abuse, otx, greynoise], { verdict: "malicious" });
    expect(t?.type).toBe("scanner");
    expect(t?.sources).toContain("greynoise");
  });

  it("hears an identification source that carries no weight at all", () => {
    // scanner-id is context-only by design, so it is weight 0. Gating on weight
    // before checking the identifier list silenced the one source that exists
    // to answer what an address is.
    const t = threatTypeOf(
      [
        src({ id: "abuseipdb", categories: ["Brute-Force"], score: 100, malicious: true }),
        src({ id: "scanner-id", categories: ["internet-scanner"], score: 0, weight: 0 }),
      ],
      { verdict: "malicious" },
    );
    expect(t?.type).toBe("scanner");
    expect(t?.sources).toContain("scanner-id");
  });

  it("takes an identification from a source that reported no risk", () => {
    // GreyNoise scores a benign scanner 0, so requiring a flag would discard
    // the only source that knows what the address is.
    const t = threatTypeOf(
      [
        src({ id: "virustotal", categories: ["Spamhaus ZEN"], score: 90 }),
        src({ id: "greynoise", categories: ["internet-scanner"], score: 0 }),
      ],
      { verdict: "malicious" },
    );
    expect(t?.type).toBe("scanner");
  });

  it("withholds a tied label when the identification source could not be consulted", () => {
    // GreyNoise's free tier runs out of daily quota. Without this, the same
    // address types as "scanner" in the morning and "brute force" in the
    // afternoon, purely from how much the tool was used in between.
    const sources = [
      src({
        id: "abuseipdb",
        categories: ["Brute-Force", "Port Scan"],
        score: 100,
        malicious: true,
      }),
      {
        ...src({ id: "greynoise", categories: [], score: 0 }),
        status: "rate_limited" as const,
      },
    ];
    expect(threatTypeOf(sources, { verdict: "malicious" })).toBeNull();
  });

  it("still answers on a clear winner when the identification source is down", () => {
    // A missing identification could only have broken a tie, so withholding
    // every label whenever GreyNoise is out of quota would throw away good ones.
    const sources = [
      src({ id: "abuseipdb", categories: ["Web App Attack", "Hacking"], score: 100 }),
      { ...src({ id: "greynoise", categories: [], score: 0 }), status: "error" as const },
    ];
    expect(threatTypeOf(sources, { verdict: "malicious" })?.type).toBe("web attack");
  });

  it("keeps a tied label the identification source itself won", () => {
    const sources = [
      src({ id: "abuseipdb", categories: ["Brute-Force"], score: 100 }),
      src({ id: "tor-project", categories: ["tor-exit"], score: 50 }),
      { ...src({ id: "greynoise", categories: [], score: 0 }), status: "timeout" as const },
    ];
    expect(threatTypeOf(sources, { verdict: "malicious" })?.type).toBe("tor");
  });

  it("prefers a specific type over a catch-all on equal support", () => {
    const t = threatTypeOf(
      [src({ id: "vt", categories: ["malware", "ransomware.wcry"], score: 90 })],
      { verdict: "malicious" },
    );
    expect(t?.type).toBe("ransomware");
    expect(t?.also).toContain("malware");
  });

  it("keeps the source's own order when nothing else separates two types", () => {
    // An address that both spams and brute-forces is not better described by
    // one than the other, so the reporting source's ranking stands.
    const t = threatTypeOf(
      [src({ id: "abuseipdb", categories: ["Email Spam", "Brute-Force"], score: 100 })],
      { verdict: "malicious" },
    );
    expect(t?.type).toBe("spam");
    expect(t?.also).toEqual(["brute force"]);
  });
});
