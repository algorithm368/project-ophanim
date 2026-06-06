import { describe, expect, it } from "vitest";
import { summarizeAbuse } from "./abuseipdb";

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

  it("uses 50% as the malicious threshold", () => {
    expect(summarizeAbuse({ abuseConfidenceScore: 49 }).malicious).toBe(false);
    expect(summarizeAbuse({ abuseConfidenceScore: 50 }).malicious).toBe(true);
  });
});
