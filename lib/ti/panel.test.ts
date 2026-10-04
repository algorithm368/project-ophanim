import { describe, expect, it } from "vitest";
import { activityStat, lastSeenLabel } from "@/lib/ti/panel";
import type { CheckResult, SourceResult } from "@/lib/ti/types";
import { src, stats } from "@/lib/ti/subject-record.test";

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

function ip(opts: Partial<CheckResult> & { sources?: SourceResult[] } = {}): CheckResult {
  return {
    ip: "185.220.101.47",
    scope: "public",
    verdict: "malicious",
    riskScore: 75,
    checkedAt: new Date(NOW).toISOString(),
    sources: [],
    stats: stats(0),
    ...opts,
  } as CheckResult;
}

describe("activityStat", () => {
  const seenAt = (iso: string) => ip({ sources: [src({ id: "otx", lastSeen: iso })] });

  it("ranks by how long ago a source last saw it", () => {
    expect(activityStat(seenAt("2026-09-13T06:00:00Z"), NOW).value).toBe("Live");
    expect(activityStat(seenAt("2026-09-10T00:00:00Z"), NOW).value).toBe("Recent");
    expect(activityStat(seenAt("2026-08-25T00:00:00Z"), NOW).value).toBe("This month");
    expect(activityStat(seenAt("2026-01-01T00:00:00Z"), NOW).value).toBe("Dormant");
  });

  it("hatches when nobody dated their sighting", () => {
    // A gap in the evidence must never read as "quiet", which is a finding.
    expect(activityStat(ip({ sources: [src({ id: "otx" })] }), NOW).rung).toBeNull();
  });
});

describe("lastSeenLabel", () => {
  it("gives the age of the newest sighting", () => {
    expect(lastSeenLabel(ip({ sources: [src({ id: "otx", lastSeen: "2026-09-13T06:00:00Z" })] }), NOW)).toBe(
      "12h ago",
    );
    expect(lastSeenLabel(ip({ sources: [src({ id: "otx", lastSeen: "2026-01-01T00:00:00Z" })] }), NOW)).toBe(
      "255d ago",
    );
  });

  it("says no record rather than nothing when nobody dated a sighting", () => {
    // An undated sighting and a fresh one are opposite facts, and a blank cell
    // reads as the second.
    expect(lastSeenLabel(ip(), NOW)).toBe("no record");
  });
});

describe("activityStat — files and fresh sightings", () => {
  it("reads a file's own last-seen date and calls a sighting this hour under an hour", () => {
    const file = {
      hash: "a".repeat(64),
      algorithm: "sha256",
      verdict: "malicious",
      riskScore: 90,
      checkedAt: new Date(NOW).toISOString(),
      context: { lastSeen: "2026-09-13T00:10:00Z" },
      sources: [],
      stats: stats(0),
    } as unknown as CheckResult;
    // Sightings are kept to the day, so "this hour" is the first hour after midnight.
    const justAfterMidnight = Date.UTC(2026, 8, 13, 0, 30);
    expect(activityStat(file, justAfterMidnight)).toMatchObject({ value: "Live", detail: "under an hour" });
  });
});
