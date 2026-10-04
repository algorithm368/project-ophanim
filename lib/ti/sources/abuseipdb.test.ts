import { describe, expect, it } from "vitest";
import { categoryBreakdown, reportLog, summarizeAbuse } from "./abuseipdb";

describe("categoryBreakdown", () => {
  it("tallies category ids into named buckets, most-reported first", () => {
    expect(
      categoryBreakdown([
        { categories: [22, 18] }, // SSH, Brute-Force
        { categories: [22] }, // SSH
        { categories: [21] }, // Web App Attack
      ]),
    ).toEqual([
      { name: "SSH", count: 2 },
      { name: "Brute-Force", count: 1 },
      { name: "Web App Attack", count: 1 },
    ]);
  });

  it("labels unknown ids and tolerates empty input", () => {
    expect(categoryBreakdown([{ categories: [99] }])).toEqual([
      { name: "Category 99", count: 1 },
    ]);
    expect(categoryBreakdown(null)).toEqual([]);
  });
});

describe("summarizeAbuse", () => {
  it("flags malicious at high confidence and lists tor + usage categories", () => {
    expect(
      summarizeAbuse({
        abuseConfidenceScore: 87,
        totalReports: 12,
        isTor: true,
        usageType: "Data Center/Web Hosting/Transit",
      }),
    ).toEqual({
      score: 87,
      malicious: true,
      categories: ["tor", "Data Center/Web Hosting/Transit"],
      summary: "87% abuse confidence from 12 report(s)",
    });
  });

  it("treats an empty record as clean with no categories", () => {
    expect(summarizeAbuse({})).toEqual({
      score: 0,
      malicious: false,
      categories: [],
      summary: "0% abuse confidence from 0 report(s)",
    });
  });

  it("uses 75% as the malicious threshold for a definitive listing", () => {
    expect(summarizeAbuse({ abuseConfidenceScore: 74 }).malicious).toBe(false);
    expect(summarizeAbuse({ abuseConfidenceScore: 75 }).malicious).toBe(true);
  });

  it("headlines the top report reasons and adds them to categories", () => {
    const r = summarizeAbuse({
      abuseConfidenceScore: 92,
      totalReports: 3,
      reports: [{ categories: [22] }, { categories: [22] }, { categories: [18] }],
    });
    expect(r.summary).toBe(
      "92% abuse confidence from 3 report(s) for SSH, Brute-Force",
    );
    expect(r.categories).toEqual(["ssh", "brute-force"]);
  });
});

describe("reportLog", () => {
  it("tallies reports per day and dates the first when the list is complete", () => {
    expect(
      reportLog({
        totalReports: 3,
        reports: [
          { reportedAt: "2026-09-17T22:17:21+00:00" },
          { reportedAt: "2026-09-17T01:00:00+00:00" },
          { reportedAt: "2026-08-31T18:08:32+00:00" },
        ],
      }),
    ).toEqual({
      days: [
        { day: "2026-08-31", count: 1 },
        { day: "2026-09-17", count: 2 },
      ],
      itemized: 3,
      firstReported: "2026-08-31T18:08:32+00:00",
    });
  });

  it("withholds the first report when verbose cut the list short", () => {
    const log = reportLog({
      totalReports: 364,
      reports: [{ reportedAt: "2026-10-04T10:02:58+00:00" }, { reportedAt: "2026-09-18T23:09:31+00:00" }],
    });
    expect(log?.itemized).toBe(2);
    expect(log?.firstReported).toBeUndefined();
  });

  it("returns nothing when no report is dated", () => {
    expect(reportLog({ totalReports: 1, reports: [{ categories: [22] }] })).toBeUndefined();
    expect(reportLog({})).toBeUndefined();
  });
});
