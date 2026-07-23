import { describe, it, expect } from "vitest";
import {
  buildHostClassification,
  buildExposedServices,
  buildNetworkProvenance,
  buildThreatActivity,
  buildRelationships,
  buildIpDossier,
  sparkline,
} from "@/lib/ti/ip-dossier";
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

  it("renders the three distinct FCrDNS states for the PTR row", () => {
    const verified = buildHostClassification(
      mkResult({ geo: { reverse: "mail.example.com", fcrdns: { hostname: "mail.example.com", verified: true } } }),
    );
    expect(verified!.fields.find((f) => f.label === "Reverse DNS (PTR)")?.value).toBe(
      "mail.example.com (FCrDNS verified)",
    );

    // FCrDNS ran but the forward record does not match — must NOT look like
    // "no data" (a classic spoofed-PTR indicator would otherwise vanish).
    const unconfirmed = buildHostClassification(
      mkResult({
        geo: { reverse: "mail.microsoft.com", fcrdns: { hostname: "mail.microsoft.com", verified: false } },
      }),
    );
    expect(unconfirmed!.fields.find((f) => f.label === "Reverse DNS (PTR)")?.value).toBe(
      "mail.microsoft.com (FCrDNS unconfirmed)",
    );

    // No fcrdns data at all (verification never ran) — bare hostname.
    const absent = buildHostClassification(mkResult({ geo: { reverse: "host.example.com" } }));
    expect(absent!.fields.find((f) => f.label === "Reverse DNS (PTR)")?.value).toBe("host.example.com");
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

  it("truncates the CVE list past 6 entries with a , … suffix", () => {
    const vulns = ["CVE-1", "CVE-2", "CVE-3", "CVE-4", "CVE-5", "CVE-6", "CVE-7", "CVE-8"];
    const g = buildExposedServices(
      mkResult({ sources: [finding("shodan-internetdb", { details: { vulns } })] }),
    );
    const value = g!.fields.find((f) => f.label === "Known vulnerabilities")?.value;
    expect(value).toContain("8 (");
    expect(value).toContain(", …");
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
    expect(g!.fields.find((f) => f.label === "Allocation")?.value).toBe(
      "NICEIT-NL, 45.9.148.0 – 45.9.148.255",
    );
    expect(g!.fields.find((f) => f.label === "Announced prefix")?.value).toBe("45.9.148.0/24, RPKI valid");
    expect(g!.fields.find((f) => f.label === "Abuse contact")?.value).toContain("abuse@niceit.nl");
    expect(g!.fields.find((f) => f.label === "Allocation country")?.value).toBe("NL");
  });

  it("is null for an IP with no network-provenance signals", () => {
    expect(buildNetworkProvenance(mkResult())).toBeNull();
  });

  it("hides Organization when it equals ISP", () => {
    const g = buildNetworkProvenance(mkResult({ geo: { isp: "Foo Inc", org: "Foo Inc" } }));
    expect(g!.fields.map((f) => f.label)).not.toContain("Organization");
  });

  it("suppresses duplicate org when ASN already contains it, case-insensitive", () => {
    const g = buildNetworkProvenance(
      mkResult({
        geo: { asn: "AS14061 DigitalOcean, LLC", asnOrg: "Digitalocean, LLC" },
      }),
    );
    expect(g!.fields.find((f) => f.label === "Autonomous system")?.value).toBe("AS14061 DigitalOcean, LLC");
  });

  it("appends org when ASN is a bare number", () => {
    const g = buildNetworkProvenance(
      mkResult({
        geo: { asn: "AS49447", asnOrg: "Nice IT Services Group" },
      }),
    );
    expect(g!.fields.find((f) => f.label === "Autonomous system")?.value).toBe("AS49447 Nice IT Services Group");
  });
});

describe("buildThreatActivity", () => {
  it("is null for a clean IP with no signals", () => {
    expect(buildThreatActivity(mkResult())).toBeNull();
  });

  it("reports scanning, C2, blocklists and reputation trend", () => {
    const g = buildThreatActivity(
      mkResult({
        history: [
          { checkedAt: "2025-11-03T00:00:00Z", riskScore: 20, verdict: "low" },
          { checkedAt: "2026-07-20T00:00:00Z", riskScore: 90, verdict: "malicious" },
        ],
        sources: [
          finding("greynoise", {
            malicious: true,
            categories: ["internet-scanner", "malicious"],
            summary: "malicious (active scanner)",
          }),
          finding("feodo", { malicious: true, details: { malware: "Emotet" } }),
          finding("ipsum", { malicious: true, details: { blocklistCount: 4 } }),
        ],
      }),
    );
    expect(g!.title).toBe("Threat activity");
    expect(g!.fields.find((f) => f.label === "Command and control")?.value).toContain("Emotet");
    expect(g!.fields.find((f) => f.label === "Blocklist listings")?.value).toContain("IPsum");
    expect(g!.fields.find((f) => f.label === "Reputation history")?.value).toMatch(/Since 2025-11-03/);
  });

  it("reports a sub-threshold blocklist listing that never crosses a source's own malicious gate", () => {
    // dnsbl needs >=3 zones and blocklist-de needs >=5 attacks to set
    // `malicious`; below that, the source still carries real listing counts
    // in `details` that should not be dropped entirely.
    const g = buildThreatActivity(
      mkResult({
        sources: [
          finding("dnsbl", { malicious: false, details: { listedOn: ["Spamhaus ZEN (…)", "SpamCop (…)"] } }),
          finding("blocklist-de", { malicious: false, details: { attacks: 2, reports: 1 } }),
        ],
      }),
    );
    const value = g!.fields.find((f) => f.label === "Blocklist listings")?.value;
    expect(value).toContain("DNS blocklists x2");
    expect(value).toContain("blocklist.de x2");
  });

  it("does not report a spamhaus-drop row (source is not registered / never sets malicious)", () => {
    const g = buildThreatActivity(
      mkResult({ sources: [finding("spamhaus-drop", { score: 55, categories: ["spamhaus-drop"] })] }),
    );
    expect(g).toBeNull();
  });

  it("prefers ThreatFox's printable malware-family list over the mixed categories array", () => {
    const g = buildThreatActivity(
      mkResult({
        sources: [
          finding("threatfox", {
            malicious: true,
            categories: ["botnet_cc", "payload_delivery", "AsyncRAT"],
            details: { malware: ["AsyncRAT"] },
          }),
        ],
      }),
    );
    expect(g!.fields.find((f) => f.label === "Malware association")?.value).toBe("AsyncRAT");
  });

  it("falls back to categories when ThreatFox's details.malware is absent", () => {
    const g = buildThreatActivity(
      mkResult({
        sources: [
          finding("threatfox", { malicious: true, categories: ["botnet_cc", "payload_delivery", "AsyncRAT"] }),
        ],
      }),
    );
    expect(g!.fields.find((f) => f.label === "Malware association")?.value).toBe(
      "botnet_cc, payload_delivery, AsyncRAT",
    );
  });

  it("routes Shodan threat tags into Flagged host tags, not neutral Infrastructure tags", () => {
    const result = mkResult({
      sources: [
        finding("shodan-internetdb", {
          malicious: true,
          details: { tags: ["cloud", "compromised"] },
        }),
      ],
    });
    const threat = buildThreatActivity(result);
    expect(threat).not.toBeNull();
    expect(threat!.fields.find((f) => f.label === "Flagged host tags")?.value).toBe("compromised");

    const exposed = buildExposedServices(result);
    expect(exposed!.fields.find((f) => f.label === "Infrastructure tags")?.value).toBe("cloud");
    // Never duplicated into both rows.
    expect(exposed!.fields.find((f) => f.label === "Infrastructure tags")?.value).not.toContain("compromised");
  });
});

describe("buildRelationships", () => {
  it("summarizes hosted domains and passive DNS, null when empty", () => {
    const g = buildRelationships(
      mkResult({
        passiveDns: [{ value: "a.example", type: "domain" }],
        sources: [finding("reverse-ip", { details: { domainCount: 3, domains: ["admin-panel.taxwiseup.com"] } })],
      }),
    );
    expect(g!.fields.find((f) => f.label === "Hosted domains")?.value).toContain("3");
    expect(g!.fields.find((f) => f.label === "Passive DNS")?.value).toContain("1");
    expect(buildRelationships(mkResult())).toBeNull();
  });
});

describe("buildIpDossier", () => {
  it("returns ordered groups and a provenance footer", () => {
    const d = buildIpDossier(
      mkResult({ geo: { isHosting: true, asn: "AS13335", isp: "Cloudflare" }, checkedAt: "2026-07-23T14:12:00Z" }),
    );
    expect(d.groups[0].id).toBe("classification");
    expect(d.groups.map((g) => g.id)).not.toContain("threat"); // clean → hidden
    expect(d.footer).toMatch(/checked/);
  });
});
