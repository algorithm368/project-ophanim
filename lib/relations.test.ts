import { describe, expect, it } from "vitest";
import {
  domainRelations,
  hashRelations,
  ipRelations,
  relationsFor,
} from "@/lib/relations";
import type {
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
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
