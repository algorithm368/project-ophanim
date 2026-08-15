import { describe, expect, it } from "vitest";
import { annotateSharedHost } from "@/lib/ti/url/shared-host";
import type { SourceResult } from "@/lib/ti/types";
import type { UrlLayer } from "@/lib/ti/url/types";

const row = (id: string, over: Partial<SourceResult> = {}): SourceResult => ({
  source: {
    id,
    name: id,
    url: "https://example.test",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  enabled: true,
  status: "ok",
  durationMs: 1,
  ...over,
});

const layer = (sources: SourceResult[]): UrlLayer => ({
  kind: "ip",
  indicator: "1.2.3.4",
  status: "ok",
  riskScore: 0,
  verdict: "clean",
  sources,
  stats: {
    total: sources.length,
    queried: sources.length,
    flagged: 0,
    skipped: 0,
    errored: 0,
    rateLimited: 0,
  },
});

describe("annotateSharedHost", () => {
  it("relabels reverse-ip when the ASN is a known cloud provider", () => {
    const result = annotateSharedHost(
      layer([
        row("ip-api", { geo: { asn: "AS13335", asnOrg: "Cloudflare" } }),
        row("reverse-ip", { summary: "40 domains share this IP" }),
      ]),
    );
    const reverse = result.sources.find((s) => s.source.id === "reverse-ip")!;
    expect(reverse.summary).toContain("Cloudflare");
    expect(reverse.summary).toContain("not evidence");
  });

  it("recognizes a provider from the org name when the ASN is unlisted", () => {
    const result = annotateSharedHost(
      layer([
        row("ip-api", { geo: { asn: "AS99999", asnOrg: "Amazon Data Services" } }),
        row("reverse-ip", { summary: "40 domains share this IP" }),
      ]),
    );
    const reverse = result.sources.find((s) => s.source.id === "reverse-ip")!;
    expect(reverse.summary).toContain("Amazon Web Services");
  });

  it("leaves reverse-ip alone on an ordinary hosting ASN", () => {
    const result = annotateSharedHost(
      layer([
        row("ip-api", { geo: { asn: "AS64500", asnOrg: "Some Small ISP" } }),
        row("reverse-ip", { summary: "3 domains share this IP" }),
      ]),
    );
    const reverse = result.sources.find((s) => s.source.id === "reverse-ip")!;
    expect(reverse.summary).toBe("3 domains share this IP");
  });

  it("is a no-op when reverse-ip did not run", () => {
    const input = layer([row("ip-api", { geo: { asn: "AS13335" } })]);
    expect(annotateSharedHost(input)).toEqual(input);
  });

  it("does not touch the score, which reverse-ip never moved anyway", () => {
    const input = layer([
      row("ip-api", { geo: { asn: "AS13335", asnOrg: "Cloudflare" } }),
      row("reverse-ip", { summary: "40 domains share this IP" }),
    ]);
    const result = annotateSharedHost(input);
    expect(result.riskScore).toBe(input.riskScore);
    expect(result.verdict).toBe(input.verdict);
  });
});
