import { beforeEach, describe, expect, it, vi } from "vitest";

// The feed download and its cache live in lib/ti/feeds/openphish.ts. Only the
// loader is replaced, so hostOf below is still the real implementation.
const { loadFeedMock } = vi.hoisted(() => ({ loadFeedMock: vi.fn() }));
vi.mock("@/lib/ti/feeds/openphish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ti/feeds/openphish")>()),
  loadOpenphishFeed: loadFeedMock,
}));

const { hostOf, openPhishSource } = await import("./openphish");

describe("hostOf", () => {
  it("extracts a lowercased hostname from a URL", () => {
    expect(hostOf("https://EVIL.com/login")).toBe("evil.com");
    expect(hostOf("  https://sub.evil.com:8080/x  ")).toBe("sub.evil.com");
  });

  it("strips a trailing dot (FQDN form)", () => {
    expect(hostOf("http://evil.com./path")).toBe("evil.com");
  });

  it("returns null for non-URL lines", () => {
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});

describe("openPhishSource.meta", () => {
  // A blocklist that needs no key, so it must stay enabled unconditionally,
  // and its weight is what lets a listing move the aggregate score.
  it("is a keyless blocklist that always runs", () => {
    expect(openPhishSource.meta.id).toBe("openphish");
    expect(openPhishSource.meta.category).toBe("blocklist");
    expect(openPhishSource.meta.requiresKey).toBe(false);
    expect(openPhishSource.meta.weight).toBe(0.9);
    expect(openPhishSource.isEnabled()).toBe(true);
  });
});

describe("openPhishSource.check", () => {
  const feed = (...hosts: string[]) => ({ hosts: new Set(hosts) });
  // The adapter only forwards the signal, so an un-aborted one stands in for
  // "no cancellation" without loosening the type.
  const idle = new AbortController().signal;

  beforeEach(() => {
    loadFeedMock.mockReset();
    loadFeedMock.mockResolvedValue(feed());
  });

  it("reports a clean, scoreless finding when the host is absent", async () => {
    loadFeedMock.mockResolvedValue(feed("other.com"));
    await expect(openPhishSource.check("evil.com", idle)).resolves.toEqual({
      status: "ok",
      score: 0,
      summary: "Not in the phishing feed",
    });
  });

  // A listing here is a hard call, not a hint: the source sets `malicious`,
  // which the aggregator treats as a floor on the final score.
  it("reports a hard malicious listing when the host is in the feed", async () => {
    loadFeedMock.mockResolvedValue(feed("evil.com", "other.com"));
    await expect(openPhishSource.check("evil.com", idle)).resolves.toEqual({
      status: "ok",
      malicious: true,
      score: 90,
      categories: ["phishing"],
      summary: "Listed as an active phishing host",
      details: { feedSize: 2 },
    });
  });

  // The match is exact. A feed entry for a subdomain does not condemn the
  // parent, and vice versa.
  it("matches the host exactly rather than by suffix", async () => {
    loadFeedMock.mockResolvedValue(feed("login.evil.com"));
    await expect(openPhishSource.check("evil.com", idle)).resolves.toMatchObject({
      score: 0,
    });
  });

  it("passes the abort signal down to the feed loader", async () => {
    const signal = new AbortController().signal;
    await openPhishSource.check("evil.com", signal);
    expect(loadFeedMock).toHaveBeenCalledWith(signal);
  });

  // The convention every adapter follows: return a status, never throw, so one
  // slow or broken feed cannot take the whole fan-out down.
  it("returns an error finding instead of throwing", async () => {
    loadFeedMock.mockRejectedValue(new Error("feed unreachable"));
    await expect(openPhishSource.check("evil.com", idle)).resolves.toEqual({
      status: "error",
      error: "feed unreachable",
    });
  });

  it.each([["TimeoutError"], ["AbortError"]])(
    "distinguishes a %s as a timeout, not an error",
    async (name) => {
      loadFeedMock.mockRejectedValue(new DOMException("took too long", name));
      await expect(openPhishSource.check("evil.com", idle)).resolves.toEqual({
        status: "timeout",
        error: "took too long",
      });
    },
  );

  it("stringifies a thrown non-Error", async () => {
    loadFeedMock.mockRejectedValue("boom");
    await expect(openPhishSource.check("evil.com", idle)).resolves.toEqual({
      status: "error",
      error: "boom",
    });
  });
});
