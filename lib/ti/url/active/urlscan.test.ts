import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pollOutcome,
  pollScan,
  submissionOutcome,
  submitScan,
  verdictFromResult,
} from "@/lib/ti/url/active/urlscan";
import { getJson, postJson } from "@/lib/ti/http";
import { fetchCapability } from "@/lib/ti/url/active/capability";
import type { ActiveScan } from "@/lib/ti/url/active/types";

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn(), postJson: vi.fn() };
});

vi.mock("@/lib/ti/url/active/capability", () => ({ fetchCapability: vi.fn() }));

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

describe("submissionOutcome — fallbacks", () => {
  it("derives the result URL and falls back through the error fields", () => {
    expect(submissionOutcome("https://a.test/", "private", 200, { uuid: "u1" }).resultUrl).toBe(
      "https://urlscan.io/result/u1/",
    );
    expect(submissionOutcome("https://a.test/", "private", 400, { description: "bad" }).error).toBe("bad");
    expect(submissionOutcome("https://a.test/", "private", 500, null).error).toBe("HTTP 500");
  });
});

describe("submitScan", () => {
  const signal = new AbortController().signal;
  const res = (data: unknown, status = 200) => ({ ok: status < 400, status, data, text: "" });
  afterEach(() => vi.mocked(postJson).mockReset());

  it("submits privately first", async () => {
    vi.mocked(postJson).mockResolvedValue(res({ uuid: "u1" }));
    const scan = await submitScan("https://a.test/", "k", signal);
    expect(scan).toMatchObject({ status: "running", visibility: "private" });
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it("falls back to unlisted when the private quota is spent", async () => {
    vi.mocked(postJson)
      .mockResolvedValueOnce(res({ message: "quota" }, 429))
      .mockResolvedValueOnce(res({ uuid: "u2" }));
    expect(await submitScan("https://a.test/", "k", signal)).toMatchObject({
      visibility: "unlisted",
      uuid: "u2",
    });
  });

  it("returns the last quota error when every tier is spent", async () => {
    vi.mocked(postJson).mockResolvedValue(res({ message: "quota" }, 429));
    expect(await submitScan("https://a.test/", "k", signal)).toMatchObject({
      status: "error",
      error: "quota",
    });
    expect(postJson).toHaveBeenCalledTimes(2);
  });

  it("does not retry a refused target", async () => {
    vi.mocked(postJson).mockResolvedValue(res({ message: "blocked" }, 400));
    expect((await submitScan("https://a.test/", "k", signal)).error).toBe("blocked");
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it("turns a thrown submission into an errored record", async () => {
    vi.mocked(postJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await submitScan("https://a.test/", "k", signal)).error).toBe("Submission timed out");
    vi.mocked(postJson).mockRejectedValue(new Error("boom"));
    expect((await submitScan("https://a.test/", "k", signal)).error).toBe("boom");
  });
});

describe("pollScan", () => {
  const signal = new AbortController().signal;
  const running: ActiveScan = {
    target: "https://a.test/",
    engine: "urlscan",
    status: "running",
    uuid: "u1",
  };
  const res = (data: unknown, status = 200) => ({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.mocked(getJson).mockReset();
    vi.mocked(fetchCapability).mockReset();
  });

  it("returns a scan without a uuid untouched", async () => {
    const scan: ActiveScan = { target: "x", engine: "urlscan", status: "error" };
    expect(await pollScan(scan, "k", signal)).toBe(scan);
  });

  it("reads the DOM once the scan completes, against the final URL", async () => {
    vi.mocked(fetchCapability).mockResolvedValue({ forms: [] } as never);
    vi.mocked(getJson).mockResolvedValue(
      res({ page: { url: "https://final.test/" }, task: { domURL: "https://dom.test/" } }),
    );
    const scan = await pollScan(running, "k", signal);
    expect(scan.status).toBe("done");
    expect(fetchCapability).toHaveBeenCalledWith(
      "https://dom.test/",
      "https://final.test/",
      { "API-Key": "k" },
      signal,
    );
    expect(scan.capability).toEqual({ forms: [] });
  });

  it("falls back to the target when the result has no final URL", async () => {
    vi.mocked(getJson).mockResolvedValue(res({ task: { domURL: "https://dom.test/" } }));
    await pollScan(running, "k", signal);
    expect(vi.mocked(fetchCapability).mock.calls[0][1]).toBe("https://a.test/");
  });

  it("skips the DOM when there is none, or the scan is not done", async () => {
    vi.mocked(getJson).mockResolvedValue(res({}));
    expect((await pollScan(running, "k", signal)).status).toBe("done");
    vi.mocked(getJson).mockResolvedValue(res({ task: { domURL: "https://dom.test/" } }, 404));
    expect((await pollScan(running, "k", signal)).status).toBe("running");
    expect(fetchCapability).not.toHaveBeenCalled();
  });

  it("keeps a scan running through a network error", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("blip"));
    expect(await pollScan(running, "k", signal)).toMatchObject({
      status: "running",
      uuid: "u1",
      error: "blip",
    });
  });
});
