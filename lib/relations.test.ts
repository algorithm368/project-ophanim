import { describe, expect, it } from "vitest";
import {
  domainRelations,
  hashRelations,
  ipRelations,
  mergeRelations,
  relationsFor,
  sortRelationsForTable,
} from "@/lib/relations";
import type {
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
  RelatedIndicator,
  SourceResult,
} from "@/lib/ti/types";

function shodanSource(hostnames: string[]): SourceResult {
  return {
    source: {
      id: "shodan-internetdb",
      name: "Shodan InternetDB",
      url: "",
      category: "scanner",
      requiresKey: false,
      weight: 0,
    },
    enabled: true,
    status: "ok",
    durationMs: 1,
    details: { hostnames },
  };
}

const baseIp: CheckResult = {
  ip: "1.2.3.4",
  checkedAt: "",
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
};

describe("ipRelations", () => {
  it("links reverse DNS and Shodan hostnames", () => {
    const result: CheckResult = {
      ...baseIp,
      geo: { reverse: "host.example.com" },
      sources: [shodanSource(["a.example.com", "host.example.com"])],
    };
    const rels = ipRelations(result);
    expect(rels).toContainEqual({
      value: "host.example.com",
      type: "domain",
      relation: "rDNS",
    });
    expect(rels.some((r) => r.value === "a.example.com")).toBe(true);
    // host.example.com appears as both rDNS and host - deduped to one node.
    expect(rels.filter((r) => r.value === "host.example.com")).toHaveLength(1);
  });

  it("returns nothing when no context is present", () => {
    expect(ipRelations(baseIp)).toEqual([]);
  });

  it("links passive-DNS domains hosted on the IP", () => {
    const result: CheckResult = {
      ...baseIp,
      passiveDns: [
        { value: "hosted.example.com", type: "domain", recordType: "A" },
      ],
    };
    expect(ipRelations(result)).toContainEqual({
      value: "hosted.example.com",
      type: "domain",
      relation: "hosted",
    });
  });
});

describe("domainRelations", () => {
  it("links resolved IPs, nameservers, and MX hosts with labels", () => {
    const result: DomainCheckResult = {
      domain: "example.com",
      checkedAt: "",
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
      context: {
        resolvedIps: ["9.9.9.9"],
        nameservers: ["ns1.example.com"],
        mx: ["mx.example.com"],
      },
    };
    const rels = domainRelations(result);
    expect(rels).toContainEqual({ value: "9.9.9.9", type: "ip", relation: "A" });
    expect(rels).toContainEqual({
      value: "ns1.example.com",
      type: "domain",
      relation: "NS",
    });
    expect(rels).toContainEqual({
      value: "mx.example.com",
      type: "domain",
      relation: "MX",
    });
  });

  it("links passive-DNS IPs, CNAME, AAAA, and PTR hosts", () => {
    const result: DomainCheckResult = {
      domain: "example.com",
      checkedAt: "",
      riskScore: 0,
      verdict: "clean",
      sources: [],
      stats: { total: 0, queried: 0, flagged: 0, skipped: 0, errored: 0, rateLimited: 0 },
      context: {
        cname: ["cdn.example.net"],
        ipv6: ["2001:db8::1"],
        reverse: ["ptr.example.com"],
      },
      passiveDns: [{ value: "9.9.9.9", type: "ip", recordType: "A" }],
    };
    const rels = domainRelations(result);
    expect(rels).toContainEqual({ value: "9.9.9.9", type: "ip", relation: "resolved" });
    expect(rels).toContainEqual({ value: "cdn.example.net", type: "domain", relation: "CNAME" });
    expect(rels).toContainEqual({ value: "2001:db8::1", type: "ip", relation: "AAAA" });
    expect(rels).toContainEqual({ value: "ptr.example.com", type: "domain", relation: "rDNS" });
  });
});

describe("hashRelations", () => {
  it("links the other digests of the same file, excluding itself", () => {
    const result: HashCheckResult = {
      hash: "44d88612fea8a8f36de82e1278abb02f",
      algorithm: "md5",
      checkedAt: "",
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
      context: {
        md5: "44d88612fea8a8f36de82e1278abb02f",
        sha256:
          "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
      },
    };
    const rels = hashRelations(result);
    // its own md5 is excluded; the sha256 is linked.
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ relation: "SHA-256", type: "hash" });
  });
});

describe("relationsFor", () => {
  it("discriminates the result type and reports the focused value", () => {
    expect(relationsFor(baseIp)).toMatchObject({ value: "1.2.3.4", type: "ip" });
  });

  it("merges source-contributed relations with context-derived ones", () => {
    const vtSource: SourceResult = {
      source: {
        id: "virustotal",
        name: "VirusTotal",
        url: "",
        category: "reputation",
        requiresKey: true,
        weight: 1,
      },
      enabled: true,
      status: "ok",
      durationMs: 1,
      relations: [
        { value: "evil.example.com", type: "domain", relation: "hosted" },
      ],
    };
    const result: CheckResult = {
      ...baseIp,
      geo: { reverse: "host.example.com" },
      sources: [vtSource],
    };
    const { related } = relationsFor(result);
    // Both the context-derived rDNS and the VT-contributed "hosted" should appear.
    expect(related).toContainEqual({
      value: "host.example.com",
      type: "domain",
      relation: "rDNS",
    });
    expect(related).toContainEqual({
      value: "evil.example.com",
      type: "domain",
      relation: "hosted",
    });
  });

  it("drops non-routable IP relations (loopback / private) from any source", () => {
    const vtSource: SourceResult = {
      source: {
        id: "virustotal",
        name: "VirusTotal",
        url: "",
        category: "reputation",
        requiresKey: true,
        weight: 1,
      },
      enabled: true,
      status: "ok",
      durationMs: 1,
      relations: [
        { value: "127.0.0.1", type: "ip", relation: "contacts" },
        { value: "10.0.0.5", type: "ip", relation: "contacts" },
        { value: "8.8.8.8", type: "ip", relation: "contacts" },
        { value: "evil.example.com", type: "domain", relation: "contacts" },
      ],
    };
    const { related } = relationsFor({ ...baseIp, sources: [vtSource] });
    expect(related.map((r) => r.value).sort()).toEqual([
      "8.8.8.8",
      "evil.example.com",
    ]);
  });

  it("drops any relation pointing back at the focus itself", () => {
    const vtSource: SourceResult = {
      source: {
        id: "virustotal",
        name: "VirusTotal",
        url: "",
        category: "reputation",
        requiresKey: true,
        weight: 1,
      },
      enabled: true,
      status: "ok",
      durationMs: 1,
      relations: [{ value: "1.2.3.4", type: "ip", relation: "contacts" }],
    };
    const { related } = relationsFor({ ...baseIp, sources: [vtSource] });
    expect(related.find((r) => r.value === "1.2.3.4")).toBeUndefined();
  });

  it("ignores relations from sources that errored", () => {
    const erroredSource: SourceResult = {
      source: {
        id: "virustotal",
        name: "VirusTotal",
        url: "",
        category: "reputation",
        requiresKey: true,
        weight: 1,
      },
      enabled: true,
      status: "error",
      error: "boom",
      durationMs: 1,
      relations: [{ value: "x.example.com", type: "domain", relation: "hosted" }],
    };
    const { related } = relationsFor({ ...baseIp, sources: [erroredSource] });
    expect(related.find((r) => r.value === "x.example.com")).toBeUndefined();
  });

  it("collects new hash relation labels from multiple sources and dedupes", () => {
    const baseHash: HashCheckResult = {
      hash: "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
      algorithm: "sha256",
      checkedAt: "",
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
    };
    const mkSource = (
      id: string,
      relations: HashCheckResult["sources"][number]["relations"],
    ): SourceResult => ({
      source: {
        id,
        name: id,
        url: "",
        category: "reputation",
        requiresKey: true,
        weight: 1,
      },
      enabled: true,
      status: "ok",
      durationMs: 1,
      relations,
    });
    const result: HashCheckResult = {
      ...baseHash,
      sources: [
        mkSource("virustotal", [
          { value: "1.2.3.4", type: "ip", relation: "contacts" },
          { value: "drop1", type: "hash", relation: "drops" },
          { value: "evil.example.com", type: "domain", relation: "distribution" },
        ]),
        mkSource("urlhaus", [
          // duplicate host from another source must collapse to one node
          { value: "evil.example.com", type: "domain", relation: "distribution" },
        ]),
        mkSource("malwarebazaar", [
          { value: "sibling1", type: "hash", relation: "similar" },
        ]),
      ],
    };
    const { related } = relationsFor(result);
    expect(related).toContainEqual({
      value: "drop1",
      type: "hash",
      relation: "drops",
    });
    expect(related).toContainEqual({
      value: "sibling1",
      type: "hash",
      relation: "similar",
    });
    expect(
      related.filter((r) => r.value === "evil.example.com"),
    ).toHaveLength(1);
  });
});

describe("mergeRelations", () => {
  it("unions sources and promotes to confirmed when 2+ sources agree", () => {
    const merged = mergeRelations([
      {
        value: "1.2.3.4",
        type: "ip",
        relation: "contacts",
        sources: ["triage"],
        tier: "observed",
      },
      {
        value: "1.2.3.4",
        type: "ip",
        relation: "contacts",
        sources: ["virustotal"],
        tier: "observed",
      },
    ]);
    expect(merged).toHaveLength(1);
    expect([...(merged[0].sources ?? [])].sort()).toEqual([
      "triage",
      "virustotal",
    ]);
    expect(merged[0].tier).toBe("confirmed");
  });

  it("keeps config-extracted C2 confirmed from a single source", () => {
    const merged = mergeRelations([
      {
        value: "evil.com",
        type: "domain",
        relation: "contacts",
        sources: ["triage"],
        tier: "confirmed",
      },
    ]);
    expect(merged[0].tier).toBe("confirmed");
  });

  it("leaves a single-source observed contact as observed", () => {
    const merged = mergeRelations([
      {
        value: "noise.com",
        type: "domain",
        relation: "contacts",
        sources: ["triage"],
        tier: "observed",
      },
    ]);
    expect(merged[0].tier).toBe("observed");
  });

  it("passes untiered DNS relations through untiered", () => {
    const merged = mergeRelations([
      { value: "1.1.1.1", type: "ip", relation: "A" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].tier).toBeUndefined();
  });
});

describe("sortRelationsForTable", () => {
  it("orders confirmed before observed before untiered, then by value", () => {
    const rows = sortRelationsForTable([
      { value: "b", type: "domain", relation: "contacts", tier: "observed" },
      { value: "a", type: "ip", relation: "contacts", tier: "confirmed" },
      { value: "c", type: "hash", relation: "similar" },
    ]);
    expect(rows.map((r) => r.value)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const input: RelatedIndicator[] = [
      { value: "b", type: "ip", relation: "contacts", tier: "observed" },
      { value: "a", type: "ip", relation: "contacts", tier: "confirmed" },
    ];
    const before = input.map((r) => r.value);
    sortRelationsForTable(input);
    expect(input.map((r) => r.value)).toEqual(before);
  });
});

describe("relations — remaining shapes", () => {
  it("reports a domain result as itself", () => {
    const domain = { ...baseIp, ip: undefined, domain: "evil.example" } as unknown as DomainCheckResult;
    expect(relationsFor(domain)).toMatchObject({ value: "evil.example", type: "domain" });
  });

  it("keeps a tiered pivot with no named sources at its tier", () => {
    expect(
      mergeRelations([{ value: "a.test", type: "domain", relation: "contacts", tier: "observed" }])[0]
        .tier,
    ).toBe("observed");
  });

  it("adopts the sources and the confirmed tier of a later duplicate", () => {
    const [rel] = mergeRelations([
      { value: "a.test", type: "domain", relation: "contacts", tier: "observed" },
      { value: "A.test", type: "domain", relation: "contacts", sources: ["triage"], tier: "confirmed" },
    ]);
    expect(rel).toMatchObject({ sources: ["triage"], tier: "confirmed" });
  });

  it("orders within a tier by relation, unknown relations last, then by value", () => {
    const rows = sortRelationsForTable([
      { value: "z", type: "domain", relation: "made-up" },
      { value: "b", type: "domain", relation: "contacts" },
      { value: "a", type: "domain", relation: "contacts" },
      { value: "c", type: "hash", relation: "similar" },
    ]);
    expect(rows.map((r) => r.value)).toEqual(["a", "b", "c", "z"]);
  });
});
