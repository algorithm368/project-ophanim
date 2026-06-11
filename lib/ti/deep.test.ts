import { describe, it, expect } from "vitest";
import { collectCertificates, collectPassiveDns, collectSubdomains } from "./deep";
import type { SourceMeta, SourceResult } from "./types";

const meta = (id: string): SourceMeta => ({
  id,
  name: id,
  url: "",
  category: "context",
  requiresKey: false,
  weight: 0,
});

function src(id: string, finding: Partial<SourceResult>): SourceResult {
  return {
    source: meta(id),
    enabled: true,
    durationMs: 1,
    status: "ok",
    ...finding,
  };
}

describe("collectSubdomains", () => {
  it("unions, lowercases, dedupes and sorts across sources", () => {
    const out = collectSubdomains([
      src("a", { subdomains: ["B.example.com", "api.example.com"] }),
      src("b", { subdomains: ["b.example.com", "cdn.example.com"] }),
    ]);
    expect(out).toEqual([
      "api.example.com",
      "b.example.com",
      "cdn.example.com",
    ]);
  });

  it("ignores non-ok sources and returns undefined when empty", () => {
    expect(
      collectSubdomains([
        src("err", { status: "error", subdomains: ["x.example.com"] }),
      ]),
    ).toBeUndefined();
    expect(collectSubdomains([])).toBeUndefined();
  });
});

describe("collectCertificates", () => {
  it("dedupes by issuer|notAfter|commonName and sorts by expiry desc", () => {
    const out = collectCertificates([
      src("a", {
        certificates: [
          { issuer: "LE", commonName: "example.com", sans: ["example.com"], notAfter: "2026-01-01" },
          { issuer: "LE", commonName: "example.com", sans: ["example.com"], notAfter: "2026-01-01" },
        ],
      }),
      src("b", {
        certificates: [
          { issuer: "GTS", commonName: "example.com", sans: ["example.com"], notAfter: "2026-07-01" },
        ],
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(out?.[0].issuer).toBe("GTS"); // latest expiry first
  });
});

describe("collectPassiveDns", () => {
  it("dedupes by type+value, widening the first/last-seen window", () => {
    const out = collectPassiveDns([
      src("a", {
        passiveDns: [
          { value: "1.2.3.4", type: "ip", firstSeen: "2024-06-01", lastSeen: "2024-12-01" },
        ],
      }),
      src("b", {
        passiveDns: [
          { value: "1.2.3.4", type: "ip", firstSeen: "2024-01-01", lastSeen: "2025-01-01", recordType: "A" },
        ],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0]).toMatchObject({
      value: "1.2.3.4",
      firstSeen: "2024-01-01", // earliest
      lastSeen: "2025-01-01", // latest
      recordType: "A",
    });
  });

  it("sorts by lastSeen descending and treats type as part of identity", () => {
    const out = collectPassiveDns([
      src("a", {
        passiveDns: [
          { value: "a.com", type: "domain", lastSeen: "2024-01-01" },
          { value: "b.com", type: "domain", lastSeen: "2026-01-01" },
        ],
      }),
    ]);
    expect(out?.map((r) => r.value)).toEqual(["b.com", "a.com"]);
  });
});
