import { describe, expect, it } from "vitest";
import { urlhausUrlFinding } from "@/lib/ti/url/sources/urlhaus-url";

describe("urlhausUrlFinding", () => {
  it("treats an online malware URL as malicious", () => {
    const finding = urlhausUrlFinding({
      query_status: "ok",
      url_status: "online",
      threat: "malware_download",
      date_added: "2026-08-01 10:00:00 UTC",
      tags: ["emotet"],
    });
    expect(finding.malicious).toBe(true);
    expect(finding.score).toBe(95);
    expect(finding.categories).toContain("emotet");
    expect(finding.summary).toContain("Live");
  });

  it("keeps an offline listing malicious but scores it lower", () => {
    const finding = urlhausUrlFinding({
      query_status: "ok",
      url_status: "offline",
      threat: "malware_download",
      date_added: "2024-01-01 10:00:00 UTC",
    });
    expect(finding.malicious).toBe(true);
    expect(finding.score).toBe(75);
    expect(finding.summary).toContain("offline");
  });

  it("returns a clean zero for no_results", () => {
    const finding = urlhausUrlFinding({ query_status: "no_results" });
    expect(finding.malicious).toBeUndefined();
    expect(finding.score).toBe(0);
  });

  it("prefers last_online over date_added for lastSeen", () => {
    const finding = urlhausUrlFinding({
      query_status: "ok",
      url_status: "online",
      date_added: "2024-01-01 10:00:00 UTC",
      last_online: "2026-08-14 09:00:00 UTC",
    });
    expect(finding.lastSeen).toBe("2026-08-14 09:00:00 UTC");
  });
});
