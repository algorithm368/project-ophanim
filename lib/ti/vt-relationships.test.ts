import { describe, expect, it } from "vitest";
import {
  communicatingSamples,
  detectionNames,
  fileRelationsFromVt,
  relationshipIds,
  resolutionDomain,
  resolutionIp,
  type VtRelationships,
} from "./vt-relationships";

describe("relationshipIds", () => {
  it("extracts, dedupes, and caps the ids of one relationship kind", () => {
    const rels: VtRelationships = {
      contacted_ips: {
        data: [
          { type: "ip_address", id: "1.1.1.1" },
          { type: "ip_address", id: "1.1.1.1" }, // dup
          { type: "ip_address", id: "2.2.2.2" },
        ],
      },
    };
    expect(relationshipIds(rels, "contacted_ips")).toEqual(["1.1.1.1", "2.2.2.2"]);
    expect(relationshipIds(rels, "contacted_ips", 1)).toEqual(["1.1.1.1"]);
  });

  it("is empty for a missing kind or missing data", () => {
    expect(relationshipIds(undefined, "contacted_ips")).toEqual([]);
    expect(relationshipIds({ contacted_ips: {} }, "contacted_ips")).toEqual([]);
  });
});

describe("fileRelationsFromVt", () => {
  it("maps inline file relationships to typed pivots (no contacted_urls)", () => {
    const rels: VtRelationships = {
      contacted_ips: { data: [{ type: "ip_address", id: "103.16.203.232" }] },
      contacted_domains: { data: [{ type: "domain", id: "evil.example.com" }] },
      dropped_files: { data: [{ type: "file", id: "dead00" }] },
      execution_parents: { data: [{ type: "file", id: "beef11" }] },
      // inline contacted_urls carries only an opaque url-id -> must be ignored
      contacted_urls: { data: [{ type: "url", id: "69b1d41239160438" }] },
    };
    // A file's VT relationships are sandbox-observed, so each carries the
    // virustotal source id and the `observed` tier for corroboration/merging.
    const s = ["virustotal"];
    const t = "observed";
    expect(fileRelationsFromVt(rels)).toEqual([
      { value: "103.16.203.232", type: "ip", relation: "contacts", sources: s, tier: t },
      { value: "evil.example.com", type: "domain", relation: "contacts", sources: s, tier: t },
      { value: "dead00", type: "hash", relation: "drops", sources: s, tier: t },
      { value: "beef11", type: "hash", relation: "parent", sources: s, tier: t },
    ]);
  });

  it("returns nothing when there are no relationships", () => {
    expect(fileRelationsFromVt(undefined)).toEqual([]);
    expect(fileRelationsFromVt({})).toEqual([]);
  });
});

describe("communicatingSamples", () => {
  it("maps communicating_files to hash pivots", () => {
    const rels: VtRelationships = {
      communicating_files: {
        data: [
          { type: "file", id: "aaa" },
          { type: "file", id: "bbb" },
        ],
      },
    };
    expect(communicatingSamples(rels)).toEqual([
      { value: "aaa", type: "hash", relation: "communicating" },
      { value: "bbb", type: "hash", relation: "communicating" },
    ]);
  });
});

describe("detectionNames", () => {
  it("collects malicious engine labels, most-frequent first, deduped", () => {
    const results = {
      Bkav: { category: "malicious", result: "W32.WannaCry" },
      Lionic: { category: "malicious", result: "Trojan.Wanna" },
      ESET: { category: "malicious", result: "W32.WannaCry" }, // dup label
      Clean1: { category: "undetected", result: null },
      Harm: { category: "harmless", result: null },
    };
    // W32.WannaCry appears twice -> ranked first
    expect(detectionNames(results)).toEqual(["W32.WannaCry", "Trojan.Wanna"]);
  });

  it("ignores non-malicious verdicts and caps the list", () => {
    const results = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `e${i}`,
        { category: "malicious", result: `L${i}` },
      ]),
    );
    expect(detectionNames(results, 3)).toHaveLength(3);
    expect(detectionNames(undefined)).toEqual([]);
  });
});

describe("resolution id splitting", () => {
  // VT resolution id is `${ip}${host_name}` with no separator.
  it("recovers the domain from an IP-anchored resolution id", () => {
    expect(resolutionDomain("45.83.193.150itkarp.com", "45.83.193.150")).toBe(
      "itkarp.com",
    );
    expect(resolutionDomain("9.9.9.9", "9.9.9.9")).toBeUndefined(); // no host part
    expect(resolutionDomain("1.2.3.4evil.com", "9.9.9.9")).toBeUndefined();
  });

  it("recovers the IP from a domain-anchored resolution id", () => {
    expect(resolutionIp("45.83.193.150itkarp.com", "itkarp.com")).toBe(
      "45.83.193.150",
    );
    expect(resolutionIp("evil.com", "evil.com")).toBeUndefined(); // no ip part
    expect(resolutionIp("1.2.3.4good.com", "evil.com")).toBeUndefined();
  });
});
