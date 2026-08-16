import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveFrameUrl,
  cdxUrl,
  parseWayback,
  waybackProvider,
} from "./wayback";

/** A reply for one of the two endpoints the provider talks to. */
interface Reply {
  status?: number;
  body?: unknown;
}

/**
 * Answer the archive without touching it.
 *
 * The provider's whole job is deciding what to say when this API is slow,
 * refusing, or empty, and those paths are exactly the ones a live call cannot
 * be made to take on demand. `cdx` may be a list, one reply per attempt, since
 * the provider retries a 5xx once.
 */
function stubArchive(replies: { cdx?: Reply | Reply[]; available?: Reply }) {
  const cdxQueue = Array.isArray(replies.cdx)
    ? [...replies.cdx]
    : replies.cdx
      ? [replies.cdx]
      : [];
  const calls: string[] = [];

  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const reply = url.includes("/cdx/search/cdx")
      ? (cdxQueue.length > 1 ? cdxQueue.shift() : cdxQueue[0])
      : replies.available;
    if (!reply) throw new Error("network down");
    const status = reply.status ?? 200;
    return new Response(JSON.stringify(reply.body ?? null), { status });
  });

  return calls;
}

/** A CDX page: header row, then one row per capture. */
function cdxRows(...timestamps: string[]) {
  return [
    ["timestamp", "original"],
    ...timestamps.map((ts) => [ts, "https://a.test/"]),
  ];
}

/** An availability answer holding one capture. */
function availableAt(timestamp: string) {
  return {
    archived_snapshots: {
      closest: {
        available: true,
        timestamp,
        url: `http://web.archive.org/web/${timestamp}/https://a.test/`,
      },
    },
  };
}

const signal = () => AbortSignal.timeout(5000);

afterEach(() => vi.unstubAllGlobals());

describe("waybackProvider.check", () => {
  it("reports the recent captures and the year the archive first saw it", async () => {
    stubArchive({
      cdx: { body: cdxRows("20260814000000", "20260815000000") },
      available: { body: availableAt("19981202212610") },
    });

    const r = await waybackProvider.check("a.test", "domain", signal());
    expect(r.status).toBe("ok");
    expect(r.summary).toBe("archived since 1998");
    const data = r.data as Extract<typeof r.data, { type: "wayback" }>;
    expect(data.snapshots.map((s) => s.time.slice(0, 10))).toEqual([
      "2026-08-15",
      "2026-08-14",
    ]);
    expect(data.firstSeen).toBe("1998-12-02T21:26:10.000Z");
  });

  it("claims no year when the age query fails, rather than inventing one", async () => {
    // The recent page's oldest row is days old, not years, so it can never
    // stand in for "archived since".
    stubArchive({
      cdx: { body: cdxRows("20260814000000", "20260815000000") },
      available: { status: 503 },
    });

    const r = await waybackProvider.check("a.test", "domain", signal());
    expect(r.status).toBe("ok");
    expect(r.summary).toBe("archived");
    const data = r.data as Extract<typeof r.data, { type: "wayback" }>;
    expect(data.firstSeen).toBeUndefined();
    expect(data.snapshots).toHaveLength(2);
  });

  it("retries the CDX index once, and takes the second answer", async () => {
    const calls = stubArchive({
      cdx: [{ status: 503 }, { body: cdxRows("20260815000000") }],
      available: { body: availableAt("20200101000000") },
    });

    const r = await waybackProvider.check("a.test", "domain", signal());
    expect(r.status).toBe("ok");
    expect(calls.filter((u) => u.includes("/cdx/")).length).toBe(2);
  });

  it("falls back to the light endpoint when the index will not answer", async () => {
    // One recent capture beats reporting a dead lane.
    stubArchive({
      cdx: { status: 503 },
      available: { body: availableAt("20260815000000") },
    });

    const r = await waybackProvider.check("a.test", "domain", signal());
    expect(r.status).toBe("ok");
    expect(r.summary).toBe("archived");
    const data = r.data as Extract<typeof r.data, { type: "wayback" }>;
    expect(data.snapshots).toHaveLength(1);
  });

  it("says not archived only when the archive answers and has nothing", async () => {
    stubArchive({
      cdx: { status: 503 },
      available: { body: { archived_snapshots: {} } },
    });

    const r = await waybackProvider.check("a.test", "domain", signal());
    expect(r.status).toBe("empty");
    expect(r.summary).toBe("Not archived");
  });

  it("reports a refused archive as an error, not as an empty one", async () => {
    // "Not archived" is a claim about the site. Saying it when the archive did
    // not answer is how a domain archived since 1998 read as brand new.
    stubArchive({ cdx: { status: 503 }, available: { status: 429 } });

    const r = await waybackProvider.check("a.test", "domain", signal());
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/did not answer/);
  });

  it("reports an empty index page as not archived", async () => {
    stubArchive({
      cdx: { body: [["timestamp", "original"]] },
      available: { body: availableAt("20200101000000") },
    });

    const r = await waybackProvider.check("a.test", "domain", signal());
    expect(r.status).toBe("empty");
    expect(r.summary).toBe("Not archived");
  });

  it("survives both endpoints throwing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection reset");
    });

    const r = await waybackProvider.check("a.test", "domain", signal());
    expect(r.status).toBe("error");
    expect(r.error).toBe("connection reset");
  });
});

describe("archiveFrameUrl", () => {
  it("asks the archive for the page without its toolbar", () => {
    expect(
      archiveFrameUrl("https://web.archive.org/web/20260815204553/https://a.test/x"),
    ).toBe("https://web.archive.org/web/20260815204553if_/https://a.test/x");
  });

  it("keeps a query string intact", () => {
    expect(
      archiveFrameUrl("https://web.archive.org/web/19981202212610/http://a.test/?id=1"),
    ).toBe("https://web.archive.org/web/19981202212610if_/http://a.test/?id=1");
  });

  it("refuses anything that is not a playback URL", () => {
    // The result gets embedded, so an unrecognized URL must not be guessed at.
    expect(archiveFrameUrl("https://evil.test/web/20260815204553/x")).toBeNull();
    expect(archiveFrameUrl("https://web.archive.org/web/2026/https://a.test/")).toBeNull();
    expect(archiveFrameUrl("")).toBeNull();
  });
});

describe("cdxUrl", () => {
  it("asks for the newest captures with a negative limit", () => {
    // A positive limit counts from the archive's first capture, which is how a
    // long-lived site reported captures from 2004 as its latest snapshots.
    const url = cdxUrl("bbc.com", -8, true);
    expect(url).toContain("limit=-8");
    expect(url).toContain("collapse=timestamp:8");
    expect(url).toContain("url=bbc.com");
  });

  it("asks for the first capture as one uncollapsed row", () => {
    const url = cdxUrl("bbc.com", 1, false);
    expect(url).toContain("limit=1");
    expect(url).not.toContain("collapse");
  });

  it("encodes an indicator that would otherwise break the query", () => {
    expect(cdxUrl("a b&c.com", 1, false)).toContain("url=a%20b%26c.com");
  });
});

describe("waybackProvider", () => {
  it("researches domains only, since an IP is not archived under a name", () => {
    expect(waybackProvider.supports).toEqual(["domain"]);
    expect(waybackProvider.isEnabled()).toBe(true);
  });
});

describe("parseWayback", () => {
  const rows = [
    ["timestamp", "original"],
    ["20190102030405", "http://evil.com/"],
    ["20210601120000", "http://evil.com/login"],
    ["20240315093000", "http://evil.com/"],
  ];

  it("derives first/last seen from the chronological rows", () => {
    const { firstSeen, lastSeen } = parseWayback(rows);
    expect(firstSeen).toBe("2019-01-02T03:04:05.000Z");
    expect(lastSeen).toBe("2024-03-15T09:30:00.000Z");
  });

  it("builds playback urls and ISO times, most-recent first", () => {
    const { snapshots } = parseWayback(rows);
    expect(snapshots[0]).toEqual({
      url: "https://web.archive.org/web/20240315093000/http://evil.com/",
      time: "2024-03-15T09:30:00.000Z",
    });
    expect(snapshots).toHaveLength(3);
  });

  it("caps the number of snapshots, keeping the most recent", () => {
    const many = [
      ["timestamp", "original"],
      ...Array.from({ length: 20 }, (_, i) => [
        `2020010100000${i % 10}`,
        "http://evil.com/",
      ]),
    ];
    expect(parseWayback(many, 5).snapshots).toHaveLength(5);
  });

  it("returns no snapshots for an empty or header-only response", () => {
    expect(parseWayback([["timestamp", "original"]])).toEqual({
      snapshots: [],
    });
    expect(parseWayback([])).toEqual({ snapshots: [] });
    expect(parseWayback(null)).toEqual({ snapshots: [] });
  });
});
