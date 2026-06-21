import { describe, expect, it } from "vitest";
import { parseWayback } from "./wayback";

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
