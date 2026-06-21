import { describe, expect, it } from "vitest";
import { parseUrlScan } from "./urlscan";

describe("parseUrlScan", () => {
  it("maps search results to normalized scan items", () => {
    const payload = {
      total: 1,
      results: [
        {
          _id: "abc-123",
          task: {
            time: "2026-06-01T10:00:00.000Z",
            url: "http://evil.com/login",
          },
          page: {
            url: "http://evil.com/login",
            domain: "evil.com",
            ip: "93.184.216.34",
            country: "US",
            asn: "AS15133",
          },
          screenshot: "https://urlscan.io/screenshots/abc-123.png",
        },
      ],
    };

    const items = parseUrlScan(payload);

    expect(items).toEqual([
      {
        scanUrl: "https://urlscan.io/result/abc-123/",
        pageUrl: "http://evil.com/login",
        screenshot: "https://urlscan.io/screenshots/abc-123.png",
        time: "2026-06-01T10:00:00.000Z",
        ip: "93.184.216.34",
        country: "US",
        asn: "AS15133",
      },
    ]);
  });

  it("falls back to the task url and derives a screenshot from the id", () => {
    const [item] = parseUrlScan({
      results: [{ _id: "xy-9", task: { url: "http://a.test/" }, page: {} }],
    });

    expect(item.pageUrl).toBe("http://a.test/");
    expect(item.scanUrl).toBe("https://urlscan.io/result/xy-9/");
    expect(item.screenshot).toBe("https://urlscan.io/screenshots/xy-9.png");
  });

  it("caps the number of items returned", () => {
    const results = Array.from({ length: 30 }, (_, i) => ({
      _id: `id-${i}`,
      task: { url: `http://h${i}.test/` },
      page: {},
    }));
    expect(parseUrlScan({ results }, 6)).toHaveLength(6);
  });

  it("returns an empty array for a missing or malformed payload", () => {
    expect(parseUrlScan(null)).toEqual([]);
    expect(parseUrlScan({})).toEqual([]);
    expect(parseUrlScan({ results: "nope" })).toEqual([]);
  });

  it("skips entries without an id", () => {
    expect(parseUrlScan({ results: [{ page: {}, task: {} }] })).toEqual([]);
  });
});
