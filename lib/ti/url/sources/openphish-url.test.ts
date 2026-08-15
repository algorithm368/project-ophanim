import { afterEach, describe, expect, it, vi } from "vitest";
import { openphishUrlSource } from "@/lib/ti/url/sources/openphish-url";
import { resetOpenphishCache } from "@/lib/ti/feeds/openphish";

const FEED = ["https://evil.com/login.php?id=abc", "http://other.test/a"].join(
  "\n",
);

afterEach(() => {
  resetOpenphishCache();
  vi.unstubAllGlobals();
});

function stubFeed(body: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
}

describe("openphishUrlSource", () => {
  it("matches an exact URL from the feed", async () => {
    stubFeed(FEED);
    const finding = await openphishUrlSource.check(
      "https://evil.com/login.php?id=abc",
      AbortSignal.timeout(5000),
    );
    expect(finding.status).toBe("ok");
    expect(finding.malicious).toBe(true);
    expect(finding.score).toBe(90);
  });

  it("does not match a different path on a listed host", async () => {
    stubFeed(FEED);
    const finding = await openphishUrlSource.check(
      "https://evil.com/other",
      AbortSignal.timeout(5000),
    );
    expect(finding.malicious).toBeUndefined();
    expect(finding.score).toBe(0);
    expect(finding.summary).toContain("host appears");
  });

  it("says plainly when neither the URL nor its host is listed", async () => {
    stubFeed(FEED);
    const finding = await openphishUrlSource.check(
      "https://good.test/a",
      AbortSignal.timeout(5000),
    );
    expect(finding.score).toBe(0);
    expect(finding.summary).toBe("Not on the OpenPhish feed");
  });

  it("reports an unreachable feed as an error, not a clean result", async () => {
    stubFeed("", 503);
    const finding = await openphishUrlSource.check(
      "https://evil.com/login.php?id=abc",
      AbortSignal.timeout(5000),
    );
    expect(finding.status).toBe("error");
    expect(finding.score).toBeUndefined();
  });
});
