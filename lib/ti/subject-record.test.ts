import { describe, expect, it } from "vitest";
import { parseSeen, seenRange } from "@/lib/ti/subject-record";
import type { CheckStats, SourceResult } from "@/lib/ti/types";

/** A settled source row. Every field the resolvers read is optional, so tests
 *  set only what they are about. */
export function src(opts: {
  id: string;
  status?: SourceResult["status"];
  categories?: string[];
  details?: Record<string, unknown>;
  lastSeen?: string;
  score?: number;
  malicious?: boolean;
  weight?: number;
  requiresKey?: boolean;
}): SourceResult {
  return {
    source: {
      id: opts.id,
      name: opts.id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: opts.requiresKey ?? false,
      weight: opts.weight ?? 1,
    },
    enabled: true,
    durationMs: 1,
    status: opts.status ?? "ok",
    categories: opts.categories,
    details: opts.details,
    lastSeen: opts.lastSeen,
    score: opts.score,
    malicious: opts.malicious,
  };
}

/** CheckStats is required on every result type and no resolver reads it, so
 *  the fixtures fill it honestly rather than casting around it. */
export function stats(n: number): CheckStats {
  return { total: n, queried: n, flagged: 0, skipped: 0, errored: 0, rateLimited: 0 };
}

describe("parseSeen", () => {
  it("reads a zone-less timestamp as UTC, not as local time", () => {
    // Onionoo's shape. Date.parse reads this as local, which is the live bug:
    // on sin1 the Tor timestamp lands seven hours out and nothing logs it.
    expect(parseSeen("2026-08-30 01:00:00")).toBe(Date.UTC(2026, 7, 30, 1, 0, 0));
  });

  it("agrees with the same instant written the URLhaus way", () => {
    expect(parseSeen("2026-08-30 01:00:00 UTC")).toBe(parseSeen("2026-08-30 01:00:00"));
  });

  it("still reads a proper ISO string with an offset", () => {
    expect(parseSeen("2026-08-30T08:00:00+07:00")).toBe(Date.UTC(2026, 7, 30, 1, 0, 0));
  });

  it("discards what it cannot place rather than rendering it", () => {
    expect(parseSeen(undefined)).toBeUndefined();
    expect(parseSeen("")).toBeUndefined();
    expect(parseSeen("not a date")).toBeUndefined();
    expect(parseSeen("1970-01-01T00:00:00Z")).toBeUndefined();
  });
});

describe("seenRange", () => {
  it("takes the latest lastSeen across sources", () => {
    const range = seenRange([
      src({ id: "abuseipdb", lastSeen: "2026-08-01T00:00:00Z" }),
      src({ id: "otx", lastSeen: "2026-08-30T00:00:00Z" }),
    ]);
    expect(range).toEqual({ first: undefined, last: "2026-08-30" });
  });

  it("finds first-seen where the two sources that carry it put it", () => {
    const range = seenRange([
      src({ id: "feodo", details: { firstSeen: "2026-02-11 09:00:00" } }),
      src({ id: "dshield", details: { feedFirstSeen: "2026-03-01" } }),
      src({ id: "otx", lastSeen: "2026-08-30T00:00:00Z" }),
    ]);
    expect(range).toEqual({ first: "2026-02-11", last: "2026-08-30" });
  });

  it("reads the hash context when one is given", () => {
    expect(
      seenRange([], { firstSeen: "2025-01-05T00:00:00Z", lastSeen: "2026-01-05T00:00:00Z" }),
    ).toEqual({ first: "2025-01-05", last: "2026-01-05" });
  });

  it("ignores a source that did not answer", () => {
    expect(
      seenRange([src({ id: "otx", status: "timeout", lastSeen: "2026-08-30T00:00:00Z" })]),
    ).toBeUndefined();
  });

  it("is undefined when nothing carries a usable date", () => {
    expect(seenRange([src({ id: "otx" })])).toBeUndefined();
  });
});
