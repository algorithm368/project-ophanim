import { describe, expect, it } from "vitest";
import { safeBrowsingUrlSource } from "@/lib/ti/url/sources/safebrowsing-url";

describe("safeBrowsingUrlSource", () => {
  it("declares the same key gate as the domain-level source", () => {
    expect(safeBrowsingUrlSource.meta.requiresKey).toBe(true);
    expect(safeBrowsingUrlSource.meta.keyEnv).toBe(
      "GOOGLE_SAFE_BROWSING_API_KEY",
    );
  });

  it("has an id distinct from the domain-level source", () => {
    expect(safeBrowsingUrlSource.meta.id).toBe("safebrowsing-url");
  });

  it("skips rather than erroring when the key is absent", async () => {
    const previous = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    delete process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    try {
      expect(safeBrowsingUrlSource.isEnabled()).toBe(false);
      const finding = await safeBrowsingUrlSource.check(
        "https://evil.com/a",
        AbortSignal.timeout(1000),
      );
      expect(finding.status).toBe("skipped");
    } finally {
      if (previous !== undefined) {
        process.env.GOOGLE_SAFE_BROWSING_API_KEY = previous;
      }
    }
  });
});
