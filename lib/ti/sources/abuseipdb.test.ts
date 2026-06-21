import { describe, expect, it } from "vitest";
import { categoryBreakdown, summarizeAbuse } from "./abuseipdb";

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
