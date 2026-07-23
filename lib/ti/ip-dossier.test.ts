import { describe, it, expect } from "vitest";
import { buildHostClassification, buildExposedServices, buildNetworkProvenance, sparkline } from "@/lib/ti/ip-dossier";
import type { CheckResult, SourceResult } from "@/lib/ti/types";

function mkResult(over: Partial<CheckResult> = {}): CheckResult {
  return {
    ip: "1.2.3.4",
    checkedAt: "2026-07-23T00:00:00Z",
    riskScore: 0,
    verdict: "clean",
    sources: [],
    stats: { total: 0, queried: 0, flagged: 0, skipped: 0, errored: 0, rateLimited: 0 },
    ...over,
  } as CheckResult;
}
const finding = (id: string, over: Partial<SourceResult>): SourceResult =>
  ({ source: { id, name: id, url: "", weight: 0, category: "context" }, status: "ok", enabled: true, durationMs: 1, ...over }) as unknown as SourceResult;

describe("sparkline", () => {
  it("maps 0-100 values to block glyphs", () => {
    expect(sparkline([0, 100])).toBe("▁█");
    expect(sparkline([])).toBe("");
  });
});

describe("buildHostClassification", () => {
  it("labels a hosting IP, adds cloud + RIOT + reverse DNS, hides absent rows", () => {
    const g = buildHostClassification(
      mkResult({
        geo: { isHosting: true, asn: "AS13335", asnOrg: "Cloudflare", reverse: "one.one.one.one", fcrdns: { hostname: "one.one.one.one", verified: true } },
        sources: [finding("greynoise", { details: { riot: true, actor: "Cloudflare Public DNS" } })],
      }),
    );
    const labels = g!.fields.map((f) => f.label);
    expect(g!.title).toBe("Host classification");
    expect(g!.fields.find((f) => f.label === "Assignment type")?.value).toBe("Hosting / Datacenter");
    expect(g!.fields.find((f) => f.label === "Cloud infrastructure")?.value).toBe("Cloudflare");
    expect(g!.fields.find((f) => f.label === "Recognized service")?.value).toBe("Cloudflare Public DNS");
    expect(g!.fields.find((f) => f.label === "Reverse DNS (PTR)")?.value).toContain("one.one.one.one");
    expect(labels).not.toContain("Anonymization");
  });

  it("marks Tor and anonymizer flags", () => {
    const g = buildHostClassification(
      mkResult({
        geo: { isProxy: true },
        sources: [finding("tor-project", { categories: ["tor", "tor-exit"] })],
      }),
    );
    expect(g!.fields.find((f) => f.label === "Assignment type")?.value).toBe("Anonymizing proxy / VPN");
    expect(g!.fields.find((f) => f.label === "Anonymization")?.value).toBe("Tor exit node");
  });
});

describe("buildExposedServices", () => {
  it("summarizes ports, software, CVEs; hides when Shodan has nothing", () => {
    const g = buildExposedServices(
      mkResult({
        sources: [finding("shodan-internetdb", {
          details: { ports: [22, 443], cpes: ["cpe:/a:openbsd:openssh:10.0"], vulns: ["CVE-2024-6387"], tags: ["cloud"], hostnames: ["h.example"] },
        })],
      }),
    );
    expect(g!.title).toBe("Exposed services");
    expect(g!.fields.find((f) => f.label === "Open ports")?.value).toBe("22 SSH, 443 HTTPS");
    expect(g!.fields.find((f) => f.label === "Known vulnerabilities")?.value).toContain("CVE-2024-6387");
    expect(g!.fields.find((f) => f.label === "Infrastructure tags")?.value).toBe("cloud");
    expect(buildExposedServices(mkResult())).toBeNull();
  });
});

describe("buildNetworkProvenance", () => {
  it("assembles ASN, class, allocation, prefix, abuse", () => {
    const g = buildNetworkProvenance(
      mkResult({
        geo: { asn: "AS49447", asnOrg: "Nice IT Services Group", isp: "Nice IT Services Group Inc." },
        sources: [
          finding("peeringdb", { details: { networkClass: "NSP", trafficLevel: "1-5Gbps" } }),
          finding("rdap-ip", { details: { networkName: "NICEIT-NL", range: "45.9.148.0 – 45.9.148.255", abuseContact: "abuse@niceit.nl", allocationCountry: "NL" } }),
          finding("ripestat", { details: { prefix: "45.9.148.0/24", rpkiStatus: "valid" } }),
        ],
      }),
    );
    expect(g!.fields.find((f) => f.label === "Autonomous system")?.value).toBe("AS49447 Nice IT Services Group");
    expect(g!.fields.find((f) => f.label === "Network class")?.value).toBe("NSP, 1-5Gbps");
    expect(g!.fields.find((f) => f.label === "Announced prefix")?.value).toBe("45.9.148.0/24, RPKI valid");
    expect(g!.fields.find((f) => f.label === "Abuse contact")?.value).toContain("abuse@niceit.nl");
    expect(g!.fields.find((f) => f.label === "Allocation country")?.value).toBe("NL");
  });
});
