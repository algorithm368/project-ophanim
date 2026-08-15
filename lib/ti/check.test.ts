import { describe, expect, it, vi } from "vitest";
import { checkIp, supportsFamily } from "@/lib/ti/check";
import type { SourceResult, TiSource } from "@/lib/ti/types";

// A tiny stand-in registry so checkIp can be exercised without touching the
// network: every source resolves immediately from memory.
vi.mock("./registry", () => {
  const make = (id: string, families?: (4 | 6)[]) => ({
    meta: {
      id,
      name: id,
      url: "https://example.test",
      category: "reputation" as const,
      requiresKey: false,
      weight: 1,
      ...(families ? { families } : {}),
    },
    isEnabled: () => true,
    check: async () => ({ status: "ok" as const, score: 0 }),
  });
  return {
    // Deliberately ordered so a naive "ran first, skipped last" concatenation
    // would not reproduce it.
    sources: [
      make("legacy-v4"), // families unset
      make("dual", [4, 6]),
      make("explicit-v4", [4]),
    ],
  };
});

/** A source declaring the given families (omit to leave the field unset). */
function fakeSource(id: string, families?: (4 | 6)[]): TiSource {
  return {
    meta: {
      id,
      name: id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: 1,
      ...(families ? { families } : {}),
    },
    isEnabled: () => true,
    check: async () => ({ status: "ok" as const, score: 0 }),
  };
}

describe("supportsFamily", () => {
  it("treats an unset families field as IPv4 only", () => {
    const source = fakeSource("legacy");
    expect(supportsFamily(source, 4)).toBe(true);
    expect(supportsFamily(source, 6)).toBe(false);
  });

  it("honors an explicit dual-family declaration", () => {
    const source = fakeSource("modern", [4, 6]);
    expect(supportsFamily(source, 4)).toBe(true);
    expect(supportsFamily(source, 6)).toBe(true);
  });

  it("honors a v6-only declaration", () => {
    const source = fakeSource("v6only", [6]);
    expect(supportsFamily(source, 4)).toBe(false);
    expect(supportsFamily(source, 6)).toBe(true);
  });
});

describe("checkIp — family gating", () => {
  const byId = (result: { sources: SourceResult[] }, id: string) =>
    result.sources.find((s) => s.source.id === id);

  it("runs every source for an IPv4 indicator", async () => {
    const result = await checkIp("8.8.8.8");
    expect(result.sources.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
    expect(result.stats.skipped).toBe(0);
  });

  it("skips v4-only sources for an IPv6 indicator, without querying them", async () => {
    const result = await checkIp("2001:4860:4860::8888");
    expect(byId(result, "dual")?.status).toBe("ok");

    for (const id of ["legacy-v4", "explicit-v4"]) {
      const row = byId(result, id);
      expect(row?.status).toBe("skipped");
      expect(row?.summary).toBe("Does not support IPv6");
      // enabled stays true: nothing is wrong with the source's configuration,
      // it simply cannot answer for this address family. The UI relies on this
      // to avoid reporting it as a missing API key.
      expect(row?.enabled).toBe(true);
      expect(row?.durationMs).toBe(0);
    }
    expect(result.stats.skipped).toBe(2);
  });

  it("keeps registry order regardless of which sources were skipped", async () => {
    const result = await checkIp("2001:4860:4860::8888");
    expect(result.sources.map((s) => s.source.id)).toEqual([
      "legacy-v4",
      "dual",
      "explicit-v4",
    ]);
  });

  it("reports skipped sources to onSettled so the stream shows them", async () => {
    const seen: string[] = [];
    await checkIp("2001:4860:4860::8888", (r) => seen.push(r.source.id));
    expect(seen.sort()).toEqual(["dual", "explicit-v4", "legacy-v4"]);
  });

  it("treats an unparseable indicator as IPv4 rather than skipping everything", async () => {
    const result = await checkIp("not-an-ip");
    expect(result.stats.skipped).toBe(0);
  });
});
