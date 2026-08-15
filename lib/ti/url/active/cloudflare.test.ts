import { describe, expect, it } from "vitest";
import { cfPollOutcome, cfSubmissionOutcome } from "@/lib/ti/url/active/cloudflare";
import type { ActiveScan } from "@/lib/ti/url/active/types";

describe("cfSubmissionOutcome", () => {
  it("reads the flat success body the API really returns", () => {
    // Verified live 2026-08-15. The body is flat and `result` is the report URL
    // as a string, not a nested object holding the uuid. A wrapped reading
    // finds nothing, so this shape is pinned here.
    const scan = cfSubmissionOutcome("https://evil.com/a", "unlisted", 200, {
      uuid: "cf-1",
      api: "https://api.cloudflare.com/client/v4/accounts/acc/urlscanner/v2/result/cf-1",
      visibility: "unlisted",
      url: "https://evil.com/a",
      result: "https://radar.cloudflare.com/scan/cf-1",
      message: "Submission successful",
    });
    expect(scan.engine).toBe("cloudflare");
    expect(scan.status).toBe("running");
    expect(scan.uuid).toBe("cf-1");
    expect(scan.visibility).toBe("unlisted");
    expect(scan.resultUrl).toBe("https://radar.cloudflare.com/scan/cf-1");
  });

  it("reports the API's own error message rather than a bare status", () => {
    const scan = cfSubmissionOutcome("https://evil.com/a", "unlisted", 400, {
      success: false,
      errors: [{ code: 1001, message: "Invalid URL" }],
    });
    expect(scan.status).toBe("error");
    expect(scan.error).toContain("Invalid URL");
    expect(scan.uuid).toBeUndefined();
  });

  it("treats a 429 as an error the caller can retry differently", () => {
    const scan = cfSubmissionOutcome("https://evil.com/a", "unlisted", 429, {
      success: false,
      errors: [{ message: "Rate limited" }],
    });
    expect(scan.status).toBe("error");
    expect(scan.error).toMatch(/rate limited/i);
  });
});

describe("cfPollOutcome", () => {
  const pending: ActiveScan = {
    target: "https://evil.com/a",
    engine: "cloudflare",
    status: "running",
    uuid: "cf-1",
  };

  it("stays running while the scan is queued, never erroring", () => {
    // The quota is spent and the scanner is still working. Reporting failure
    // here would invite a second submission for the same page.
    expect(cfPollOutcome(pending, 404, null).status).toBe("running");
    expect(cfPollOutcome(pending, 202, null).status).toBe("running");
    expect(cfPollOutcome(pending, 404, null).error).toBeUndefined();
  });

  it("completes on a finished task and carries the verdict", () => {
    const scan = cfPollOutcome(pending, 200, {
      task: {
        uuid: "cf-1",
        status: "finished",
        success: true,
        url: "https://evil.com/a",
      },
      page: {
        url: "https://evil.com/final",
        ip: "1.2.3.4",
        asn: "13335",
        server: "cloudflare",
      },
      verdicts: { overall: { malicious: true, categories: ["phishing"] } },
      lists: { domains: ["evil.com"] },
    });
    expect(scan.status).toBe("done");
    expect(scan.verdict?.malicious).toBe(true);
    expect(scan.verdict?.finalUrl).toBe("https://evil.com/final");
  });

  it("stays running when the task exists but has not finished", () => {
    const scan = cfPollOutcome(pending, 200, {
      task: { uuid: "cf-1", status: "inProgress" },
    });
    expect(scan.status).toBe("running");
  });

  it("keeps the uuid when the provider errors, so polling resumes", () => {
    expect(cfPollOutcome(pending, 500, null).uuid).toBe("cf-1");
  });
});
