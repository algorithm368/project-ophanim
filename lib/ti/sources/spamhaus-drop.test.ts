import { afterEach, describe, expect, it, vi } from "vitest";
import { cidrContains } from "../cidr";
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

describe("matchDrop — precedence and the parsed index", () => {
  const outer = { cidr: "10.0.0.0/8", sblid: "OUTER" };
  const inner = { cidr: "10.1.0.0/16", sblid: "INNER" };
  const deepest = { cidr: "10.1.2.0/24", sblid: "DEEPEST" };

  it("returns the earliest block in feed order when ranges nest", () => {
    // Outer listed first wins even for an address in the inner block.
    expect(matchDrop("10.1.2.3", [outer, inner, deepest])).toBe(outer);
    // Inner listed first wins inside it; the outer still covers the rest.
    expect(matchDrop("10.1.2.3", [deepest, inner, outer])).toBe(deepest);
    expect(matchDrop("10.1.9.9", [deepest, inner, outer])).toBe(inner);
    expect(matchDrop("10.9.9.9", [deepest, inner, outer])).toBe(outer);
    // A mid-list block beats both its parent and its child when it comes first.
    expect(matchDrop("10.1.2.3", [inner, deepest, outer])).toBe(inner);
    expect(matchDrop("10.1.2.3", [deepest, outer, inner])).toBe(deepest);
  });

  it("returns the first of two identical blocks", () => {
    const again = { cidr: "10.0.0.0/8", sblid: "AGAIN" };
    expect(matchDrop("10.0.0.1", [outer, again])).toBe(outer);
    expect(matchDrop("10.0.0.1", [again, outer])).toBe(again);
  });

  it("misses past the end of a nested block and between siblings", () => {
    const blocks = [inner, deepest, { cidr: "10.3.0.0/16", sblid: "SIB" }];
    expect(matchDrop("10.2.0.1", blocks)).toBeNull();
    expect(matchDrop("10.3.0.1", blocks)?.sblid).toBe("SIB");
    expect(matchDrop("9.255.255.255", blocks)).toBeNull();
    expect(matchDrop("10.4.0.0", blocks)).toBeNull();
  });

  it("covers the inclusive bounds and an unaligned base", () => {
    const blocks = [{ cidr: "1.2.3.4/24" }];
    expect(matchDrop("1.2.3.0", blocks)).toBe(blocks[0]);
    expect(matchDrop("1.2.3.255", blocks)).toBe(blocks[0]);
    expect(matchDrop("1.2.4.0", blocks)).toBeNull();
  });

  it("applies the same precedence to IPv6", () => {
    const v6outer = { cidr: "2001:db8::/32", sblid: "V6OUTER" };
    const v6inner = { cidr: "2001:db8:1::/48", sblid: "V6INNER" };
    expect(matchDrop("2001:db8:1::5", [v6inner, v6outer])).toBe(v6inner);
    expect(matchDrop("2001:db8:1::5", [v6outer, v6inner])).toBe(v6outer);
    expect(matchDrop("2001:db8:2::5", [v6inner, v6outer])).toBe(v6outer);
  });

  it("skips malformed blocks and answers null for an invalid address", () => {
    const good = { cidr: "1.19.0.0/16" };
    const blocks = [{ cidr: "junk" }, { cidr: "1.0.0.0/40" }, good];
    expect(matchDrop("1.19.5.5", blocks)).toBe(good);
    expect(matchDrop("not-an-ip", blocks)).toBeNull();
    expect(matchDrop("1.19.5.5", [])).toBeNull();
  });

  it("matches a mixed-family list by the address's family", () => {
    const v4 = { cidr: "1.19.0.0/16" };
    const v6 = { cidr: "2001:678:254::/48" };
    expect(matchDrop("1.19.5.5", [v6, v4])).toBe(v4);
    expect(matchDrop("2001:678:254::1", [v4, v6])).toBe(v6);
  });

  it("agrees with a linear cidrContains scan on random addresses", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const quad = (n: number) =>
      [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
    const blocks = Array.from({ length: 300 }, (_, i) => ({
      cidr: `${quad(Math.floor(rnd() * 2 ** 32))}/${4 + Math.floor(rnd() * 25)}`,
      sblid: String(i),
    }));
    for (let i = 0; i < 2_000; i++) {
      const ip = quad(Math.floor(rnd() * 2 ** 32));
      const linear = blocks.find((b) => cidrContains(b.cidr, ip)) ?? null;
      expect(matchDrop(ip, blocks)).toBe(linear);
    }
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

describe("spamhausDropSource edge paths", () => {
  const signal = () => new AbortController().signal;
  afterEach(() => {
    vi.doUnmock("../http");
    vi.resetModules();
  });

  async function withGetText(getText: () => Promise<unknown>) {
    vi.resetModules();
    vi.doMock("../http", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../http")>();
      return { ...actual, getText: vi.fn(getText) };
    });
    return (await import("./spamhaus-drop")).spamhausDropSource;
  }

  it("needs no key, and leaves the SBL id out when the block has none", async () => {
    const source = await withGetText(async () => ({
      ok: true,
      status: 200,
      text: '{"cidr":"1.19.0.0/16"}',
    }));
    expect(source.isEnabled()).toBe(true);
    expect((await source.check("1.19.5.5", signal())).summary).toBe(
      "Within Spamhaus DROP netblock 1.19.0.0/16",
    );
  });

  it("maps a timeout", async () => {
    const source = await withGetText(async () => {
      throw new DOMException("t", "TimeoutError");
    });
    expect((await source.check("1.19.5.5", signal())).status).toBe("timeout");
  });
});
