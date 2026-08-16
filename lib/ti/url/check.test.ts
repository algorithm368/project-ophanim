import { describe, expect, it, vi } from "vitest";
import { checkUrl } from "@/lib/ti/url/check";
import type { CheckResult, DomainCheckResult } from "@/lib/ti/types";

const STATS = {
  total: 1,
  queried: 1,
  flagged: 0,
  skipped: 0,
  errored: 0,
  rateLimited: 0,
};

const domainResult = (
  over: Partial<DomainCheckResult> = {},
): DomainCheckResult => ({
  domain: "evil.com",
  checkedAt: "2026-08-15T00:00:00.000Z",
  riskScore: 0,
  verdict: "clean",
  sources: [],
  stats: STATS,
  ...over,
});

const ipResult = (over: Partial<CheckResult> = {}): CheckResult => ({
  ip: "1.2.3.4",
  checkedAt: "2026-08-15T00:00:00.000Z",
  riskScore: 0,
  verdict: "clean",
  sources: [],
  stats: STATS,
  ...over,
});

const deps = (over: Record<string, unknown> = {}) => ({
  resolve: vi.fn(async () => ["1.2.3.4"]),
  checkDomainLayer: vi.fn(async () => domainResult()),
  checkIpLayer: vi.fn(async () => ipResult()),
  getCachedDomain: vi.fn(async () => null),
  getCachedIp: vi.fn(async () => null),
  runUrlSources: vi.fn(async () => []),
  ...over,
});

describe("checkUrl", () => {
  it("produces three layers and a headline naming the worst", async () => {
    const result = await checkUrl(
      "https://evil.com/login",
      undefined,
      deps({
        checkIpLayer: vi.fn(async () =>
          ipResult({ riskScore: 80, verdict: "malicious" }),
        ),
      }),
    );
    expect(result.layers.map((l) => l.kind)).toEqual(["url", "domain", "ip"]);
    expect(result.headlineLayer).toBe("ip");
    expect(result.verdict).toBe("malicious");
    expect(result.riskScore).toBe(80);
  });

  it("canonicalizes the URL it reports", async () => {
    const result = await checkUrl(
      "EVIL.com/login#frag",
      undefined,
      deps(),
    );
    expect(result.url).toBe("https://evil.com/login");
  });

  it("reuses a cached host layer instead of re-running it", async () => {
    const d = deps({
      getCachedDomain: vi.fn(async () =>
        domainResult({ riskScore: 30, verdict: "low" }),
      ),
    });
    const result = await checkUrl("https://evil.com/login", undefined, d);
    expect(d.checkDomainLayer).not.toHaveBeenCalled();
    const host = result.layers.find((l) => l.kind === "domain")!;
    expect(host.riskScore).toBe(30);
    expect(host.cachedAt).toBe("2026-08-15T00:00:00.000Z");
  });

  it("reuses a cached IP layer instead of re-running it", async () => {
    const d = deps({
      getCachedIp: vi.fn(async () =>
        ipResult({ riskScore: 90, verdict: "malicious" }),
      ),
    });
    const result = await checkUrl("https://evil.com/login", undefined, d);
    expect(d.checkIpLayer).not.toHaveBeenCalled();
    const ip = result.layers.find((l) => l.kind === "ip")!;
    expect(ip.cachedAt).toBe("2026-08-15T00:00:00.000Z");
    expect(result.headlineLayer).toBe("ip");
  });

  it("marks the host layer not-applicable for an IP-literal URL", async () => {
    const d = deps();
    const result = await checkUrl("http://1.2.3.4/admin", undefined, d);
    const host = result.layers.find((l) => l.kind === "domain")!;
    expect(host.status).toBe("not-applicable");
    expect(host.verdict).toBe("unknown");
    expect(d.checkDomainLayer).not.toHaveBeenCalled();
    expect(d.resolve).not.toHaveBeenCalled();
  });

  it("marks the IP layer unavailable when the host does not resolve", async () => {
    const result = await checkUrl(
      "https://evil.com/login",
      undefined,
      deps({ resolve: vi.fn(async () => []) }),
    );
    const ip = result.layers.find((l) => l.kind === "ip")!;
    expect(ip.status).toBe("unavailable");
    expect(ip.verdict).toBe("unknown");
    expect(ip.reason).toContain("did not resolve");
  });

  it("checks only the first address and records the rest as unchecked", async () => {
    const d = deps({ resolve: vi.fn(async () => ["1.2.3.4", "5.6.7.8"]) });
    const result = await checkUrl("https://evil.com/a", undefined, d);
    expect(d.checkIpLayer).toHaveBeenCalledWith("1.2.3.4", undefined);
    expect(result.otherAddresses).toEqual(["5.6.7.8"]);
  });

  it("omits otherAddresses when there is only one address", async () => {
    const result = await checkUrl("https://evil.com/a", undefined, deps());
    expect(result.otherAddresses).toBeUndefined();
  });

  it("an unavailable layer never reads as clean in the headline", async () => {
    const result = await checkUrl(
      "https://evil.com/a",
      undefined,
      deps({ resolve: vi.fn(async () => []) }),
    );
    const ip = result.layers.find((l) => l.kind === "ip")!;
    expect(ip.verdict).toBe("unknown");
    expect(result.headlineLayer).not.toBe("ip");
  });

  it("concatenates every layer's rows into sources for the route factory", async () => {
    const result = await checkUrl("https://evil.com/a", undefined, deps());
    expect(result.sources).toHaveLength(
      result.layers.reduce((n, l) => n + l.sources.length, 0),
    );
  });

  it("rejects an unparseable URL rather than guessing", async () => {
    await expect(checkUrl("not a url", undefined, deps())).rejects.toThrow();
  });
});
