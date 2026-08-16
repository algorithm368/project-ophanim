import { describe, expect, it } from "vitest";
import {
  archiveFrameUrl,
  cdxUrl,
  parseWayback,
  waybackProvider,
} from "./wayback";

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
