import { afterEach, describe, expect, it, vi } from "vitest";
import { answers, resolveA, UNFILTERED_RESOLVERS, type DohResponse } from "./doh";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

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

describe("resolveA", () => {
  afterEach(() => {
    vi.mocked(getJson).mockReset();
  });

  it("filters out a CNAME record riding along with the final A record", async () => {
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        Answer: [
          { name: "www.example.com", type: 5, data: "example.com." },
          { name: "example.com", type: 1, data: "93.184.216.34" },
        ],
      },
    } as Awaited<ReturnType<typeof getJson>>);

    expect(await resolveA("www.example.com", new AbortController().signal)).toEqual([
      "93.184.216.34",
    ]);
  });

  it("returns [] rather than a hostname when only a CNAME answers", async () => {
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { Answer: [{ name: "www.example.com", type: 5, data: "example.com." }] },
    } as Awaited<ReturnType<typeof getJson>>);

    expect(await resolveA("www.example.com", new AbortController().signal)).toEqual([]);
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
