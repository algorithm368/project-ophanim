import { describe, expect, it } from "vitest";
import { answers, UNFILTERED_RESOLVERS, type DohResponse } from "./doh";

describe("answers", () => {
  it("returns the answer data values, trailing dot stripped", () => {
    const res: DohResponse = {
      Answer: [
        { name: "example.com", type: 1, data: "1.2.3.4" },
        { name: "example.com", type: 1, data: "5.6.7.8" },
      ],
    };
    expect(answers(res)).toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  it("drops DNSSEC meta records (RRSIG, etc.) that ride along with do=1", () => {
    const res: DohResponse = {
      Answer: [
        { name: "cloudflare.com", type: 1, data: "104.16.132.229" },
        // RRSIG (type 46) — its data is a signature blob, not an IP
        { name: "cloudflare.com", type: 46, data: "A ECDSAP256SHA256 2 300 ..." },
      ],
    };
    expect(answers(res)).toEqual(["104.16.132.229"]);
  });

  it("handles null / empty responses", () => {
    expect(answers(null)).toEqual([]);
    expect(answers({})).toEqual([]);
  });
});

describe("UNFILTERED_RESOLVERS", () => {
  it("includes the known-good anchors", () => {
    expect(UNFILTERED_RESOLVERS.cloudflare).toContain("cloudflare-dns.com");
    expect(UNFILTERED_RESOLVERS.google).toContain("dns.google");
    expect(UNFILTERED_RESOLVERS.rethinkdns).toContain("rethinkdns.com");
    expect(UNFILTERED_RESOLVERS["dns.sb"]).toContain("dns.sb");
  });

  it("lists at least two https endpoints and no bare-http", () => {
    const urls = Object.values(UNFILTERED_RESOLVERS);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) expect(url.startsWith("https://")).toBe(true);
  });
});
