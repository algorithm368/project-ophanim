import { afterEach, describe, expect, it, vi } from "vitest";
import { matchDrop, parseDropFeed } from "./spamhaus-drop";

const FEED = [
  '{"cidr":"1.10.16.0/20","sblid":"SBL256894","rir":"apnic"}',
  '{"cidr":"1.19.0.0/16","sblid":"SBL434604","rir":"apnic"}',
  '{"type":"metadata","timestamp":1700000000}', // no cidr -> skip
  "", // blank -> skip
  "; a comment line", // non-JSON -> skip
].join("\n");

describe("parseDropFeed", () => {
  it("keeps only the netblock lines (one JSON object per line)", () => {
    const blocks = parseDropFeed(FEED);
    expect(blocks).toEqual([
      { cidr: "1.10.16.0/20", sblid: "SBL256894" },
      { cidr: "1.19.0.0/16", sblid: "SBL434604" },
    ]);
  });

  it("returns an empty list for empty or junk input", () => {
    expect(parseDropFeed("")).toEqual([]);
    expect(parseDropFeed("not json\n<html>")).toEqual([]);
  });
});

describe("matchDrop", () => {
  const blocks = parseDropFeed(FEED);

  it("returns the netblock that contains the IP", () => {
    expect(matchDrop("1.19.5.5", blocks)).toEqual({
      cidr: "1.19.0.0/16",
      sblid: "SBL434604",
    });
  });

  it("returns null when no block contains the IP", () => {
    expect(matchDrop("8.8.8.8", blocks)).toBeNull();
  });
});

const FEED_V6 = [
  '{"cidr":"2001:678:254::/48","sblid":"SBL697648","rir":"ripencc"}',
  '{"cidr":"2001:678:6c0::/48","sblid":"SBL624855","rir":"ripencc"}',
].join("\n");

describe("matchDrop — IPv6", () => {
  const blocks = parseDropFeed(FEED_V6);

  it("parses the v6 feed with the same shape as v4", () => {
    expect(blocks).toEqual([
      { cidr: "2001:678:254::/48", sblid: "SBL697648" },
      { cidr: "2001:678:6c0::/48", sblid: "SBL624855" },
    ]);
  });

  it("returns the /48 that contains the address", () => {
    expect(matchDrop("2001:678:254:abcd::1", blocks)).toEqual({
      cidr: "2001:678:254::/48",
      sblid: "SBL697648",
    });
  });

  it("returns null when no v6 block contains the address", () => {
    expect(matchDrop("2001:4860:4860::8888", blocks)).toBeNull();
  });

  it("does not match a v4 address against v6 blocks", () => {
    expect(matchDrop("8.8.8.8", blocks)).toBeNull();
  });
});

describe("spamhausDropSource — per-family feed selection", () => {
  const V4_LINE = '{"cidr":"1.19.0.0/16","sblid":"SBL434604"}';
  const V6_LINE = '{"cidr":"2001:678:254::/48","sblid":"SBL697648"}';

  /** Load a fresh copy of the module so its per-family caches start empty. */
  async function freshSource() {
    vi.resetModules();
    const getText = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: url.includes("_v6") ? V6_LINE : V4_LINE,
    }));
    vi.doMock("../http", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../http")>();
      return { ...actual, getText };
    });
    const mod = await import("./spamhaus-drop");
    return { source: mod.spamhausDropSource, getText };
  }

  const signal = () => new AbortController().signal;

  afterEach(() => {
    vi.doUnmock("../http");
    vi.resetModules();
  });

  it("fetches the v4 feed for an IPv4 address", async () => {
    const { source, getText } = await freshSource();
    const f = await source.check("1.19.5.5", signal());
    expect(getText.mock.calls[0][0]).toContain("drop_v4.json");
    expect(f.score).toBe(55);
    expect(f.summary).toContain("1.19.0.0/16");
  });

  it("fetches the v6 feed for an IPv6 address", async () => {
    const { source, getText } = await freshSource();
    const f = await source.check("2001:678:254:abcd::1", signal());
    expect(getText.mock.calls[0][0]).toContain("drop_v6.json");
    expect(f.score).toBe(55);
    expect(f.summary).toContain("2001:678:254::/48");
  });

  it("does not serve the v4 blocklist to a v6 lookup", async () => {
    const { source, getText } = await freshSource();
    await source.check("1.19.5.5", signal());
    const f = await source.check("2001:4860:4860::8888", signal());
    // Two distinct feeds fetched, and the v6 address misses the v6 list.
    expect(getText.mock.calls.map((c) => c[0]).join()).toContain("drop_v6.json");
    expect(f.score).toBe(0);
    expect(f.summary).toContain("Not in any");
  });

  it("caches each family independently, fetching each feed once", async () => {
    const { source, getText } = await freshSource();
    await source.check("1.19.5.5", signal());
    await source.check("1.19.5.6", signal());
    await source.check("2001:678:254::1", signal());
    await source.check("2001:678:254::2", signal());
    expect(getText).toHaveBeenCalledTimes(2); // one v4 fetch, one v6 fetch
  });

  it("shares one fetch between concurrent lookups of the same family", async () => {
    const { source, getText } = await freshSource();
    // Both start before either resolves, so the second must join the in-flight
    // request rather than firing a second fetch of the same feed.
    const [a, b] = await Promise.all([
      source.check("2001:678:254::1", signal()),
      source.check("2001:678:254::2", signal()),
    ]);
    expect(getText).toHaveBeenCalledTimes(1);
    expect(a.score).toBe(55);
    expect(b.score).toBe(55);
  });

  it("reports an error rather than throwing when a feed is unavailable", async () => {
    vi.resetModules();
    vi.doMock("../http", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../http")>();
      return {
        ...actual,
        getText: vi.fn(async () => ({ ok: false, status: 503, text: "" })),
      };
    });
    const { spamhausDropSource } = await import("./spamhaus-drop");
    const f = await spamhausDropSource.check("2001:678:254::1", signal());
    expect(f.status).toBe("error");
    expect(f.error).toContain("503");
  });
});
