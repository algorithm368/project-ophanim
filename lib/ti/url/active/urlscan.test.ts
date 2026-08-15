import { describe, expect, it } from "vitest";
import {
  pollOutcome,
  submissionOutcome,
  verdictFromResult,
} from "@/lib/ti/url/active/urlscan";

describe("submissionOutcome", () => {
  it("keeps the uuid and reports running on acceptance", () => {
    const scan = submissionOutcome("https://evil.com/a", "private", 200, {
      uuid: "abc-123",
      result: "https://urlscan.io/result/abc-123/",
    });
    expect(scan.status).toBe("running");
    expect(scan.uuid).toBe("abc-123");
    expect(scan.visibility).toBe("private");
    expect(scan.resultUrl).toBe("https://urlscan.io/result/abc-123/");
  });

  it("reports a quota rejection as an error naming the limit", () => {
    const scan = submissionOutcome("https://evil.com/a", "private", 429, {
      message: "Rate limit exceeded",
    });
    expect(scan.status).toBe("error");
    expect(scan.error).toMatch(/rate limit/i);
    expect(scan.uuid).toBeUndefined();
  });

  it("reports a refused target without inventing a uuid", () => {
    const scan = submissionOutcome("https://evil.com/a", "private", 400, {
      message: "Invalid URL",
    });
    expect(scan.status).toBe("error");
    expect(scan.uuid).toBeUndefined();
  });
});

describe("pollOutcome", () => {
  const pending = {
    target: "https://evil.com/a",
    engine: "urlscan" as const,
    status: "running" as const,
    uuid: "abc",
  };

  it("treats 404 as still running, never as failure", () => {
    // The scan is queued and the quota is already spent. Reporting an error
    // here would invite a second submission for the same page.
    const scan = pollOutcome(pending, 404, null);
    expect(scan.status).toBe("running");
    expect(scan.uuid).toBe("abc");
    expect(scan.error).toBeUndefined();
  });

  it("completes on 200 and carries the verdict", () => {
    const scan = pollOutcome(pending, 200, {
      verdicts: { overall: { malicious: true, score: 80, categories: ["phishing"] } },
      page: { url: "https://evil.com/final", ip: "1.2.3.4", asn: "AS64500" },
      lists: { domains: ["evil.com", "cdn.test"] },
      task: { screenshotURL: "https://urlscan.io/screenshots/abc.png" },
    });
    expect(scan.status).toBe("done");
    expect(scan.verdict?.malicious).toBe(true);
    expect(scan.verdict?.finalUrl).toBe("https://evil.com/final");
    expect(scan.verdict?.contactedDomains).toContain("cdn.test");
  });

  it("keeps the uuid when the provider errors, so it can be resumed", () => {
    const scan = pollOutcome(pending, 500, null);
    expect(scan.uuid).toBe("abc");
  });
});

describe("verdictFromResult", () => {
  it("reads a clean scan as not malicious rather than unknown", () => {
    const verdict = verdictFromResult({
      verdicts: { overall: { malicious: false, score: 0 } },
      page: { url: "https://ok.test/" },
    });
    expect(verdict.malicious).toBe(false);
    expect(verdict.score).toBe(0);
  });

  it("survives a result missing every optional block", () => {
    const verdict = verdictFromResult({});
    expect(verdict.malicious).toBe(false);
    expect(verdict.finalUrl).toBeUndefined();
    expect(verdict.contactedDomains).toBeUndefined();
  });
});
