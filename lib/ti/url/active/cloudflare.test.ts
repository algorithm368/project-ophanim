import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cfPollOutcome,
  cfSubmissionOutcome,
  pollCloudflareScan,
  submitCloudflareScan,
} from "@/lib/ti/url/active/cloudflare";
import { getJson, postJson } from "@/lib/ti/http";
import { fetchCapability } from "@/lib/ti/url/active/capability";

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn(), postJson: vi.fn() };
});

vi.mock("@/lib/ti/url/active/capability", () => ({ fetchCapability: vi.fn() }));
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

describe("cfSubmissionOutcome — fallbacks", () => {
  it("fills in visibility and the report URL when the body omits them", () => {
    expect(cfSubmissionOutcome("https://a.test/", "unlisted", 200, { uuid: "u1" })).toMatchObject({
      visibility: "unlisted",
      resultUrl: "https://radar.cloudflare.com/scan/u1",
    });
  });

  it("falls back to the status for a missing or empty error message", () => {
    expect(cfSubmissionOutcome("x", "unlisted", 500, null).error).toBe("HTTP 500");
    expect(cfSubmissionOutcome("x", "unlisted", 500, { errors: [] }).error).toBe("HTTP 500");
    expect(cfSubmissionOutcome("x", "unlisted", 500, { errors: [{}] }).error).toBe("HTTP 500");
  });
});

describe("cfPollOutcome — sparse verdict", () => {
  it("leaves categories and contacted domains out when they are not lists", () => {
    const done = cfPollOutcome(
      { target: "x", engine: "cloudflare", status: "running", uuid: "u" },
      200,
      { task: { status: "finished" }, verdicts: { overall: { categories: "x" } }, lists: { domains: "y" } },
    );
    expect(done.verdict).toMatchObject({ categories: undefined, contactedDomains: undefined });
  });
});

describe("submitCloudflareScan / pollCloudflareScan", () => {
  const signal = new AbortController().signal;
  const running: ActiveScan = { target: "https://a.test/", engine: "cloudflare", status: "running", uuid: "u1" };
  const res = (data: unknown, status = 200) => ({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.mocked(getJson).mockReset();
    vi.mocked(postJson).mockReset();
    vi.mocked(fetchCapability).mockReset();
  });

  it("submits an unlisted scan", async () => {
    vi.mocked(postJson).mockResolvedValue(res({ uuid: "u1" }));
    expect(await submitCloudflareScan("https://a.test/", "t", "acct", signal)).toMatchObject({
      status: "running",
      uuid: "u1",
    });
    expect(vi.mocked(postJson).mock.calls[0][0]).toContain("/acct/urlscanner/v2/scan");
  });

  it("turns a thrown submission into an errored record", async () => {
    vi.mocked(postJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await submitCloudflareScan("x", "t", "a", signal)).error).toBe("Submission timed out");
    vi.mocked(postJson).mockRejectedValue(new Error("boom"));
    expect((await submitCloudflareScan("x", "t", "a", signal)).error).toBe("boom");
  });

  it("returns a scan without a uuid untouched", async () => {
    const scan: ActiveScan = { target: "x", engine: "cloudflare", status: "error" };
    expect(await pollCloudflareScan(scan, "t", "a", signal)).toBe(scan);
  });

  it("reads the DOM with the token once finished, against the final URL or the target", async () => {
    vi.mocked(fetchCapability).mockResolvedValue({ forms: [] } as never);
    vi.mocked(getJson).mockResolvedValue(
      res({ task: { status: "finished", domURL: "https://dom.test/" }, page: { url: "https://final.test/" } }),
    );
    const done = await pollCloudflareScan(running, "t", "a", signal);
    expect(done.capability).toEqual({ forms: [] });
    expect(vi.mocked(fetchCapability).mock.calls[0]).toEqual([
      "https://dom.test/",
      "https://final.test/",
      { Authorization: "Bearer t" },
      signal,
    ]);
    vi.mocked(getJson).mockResolvedValue(
      res({ task: { status: "finished", domURL: "https://dom.test/" } }),
    );
    await pollCloudflareScan(running, "t", "a", signal);
    expect(vi.mocked(fetchCapability).mock.calls[1][1]).toBe("https://a.test/");
  });

  it("skips the DOM when unfinished or absent, and survives a network error", async () => {
    vi.mocked(getJson).mockResolvedValue(res({ task: { status: "queued", domURL: "https://dom.test/" } }));
    expect((await pollCloudflareScan(running, "t", "a", signal)).status).toBe("running");
    vi.mocked(getJson).mockResolvedValue(res({ task: { status: "finished" } }));
    expect((await pollCloudflareScan(running, "t", "a", signal)).status).toBe("done");
    expect(fetchCapability).not.toHaveBeenCalled();
    vi.mocked(getJson).mockRejectedValue(new Error("blip"));
    expect(await pollCloudflareScan(running, "t", "a", signal)).toMatchObject({
      status: "running",
      error: "blip",
    });
  });
});
