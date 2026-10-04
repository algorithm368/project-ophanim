import { afterEach, describe, it, expect, vi } from "vitest";
import { makeMnemonicPassiveDnsSource, parseMnemonicPdns } from "./passive-dns";
import { getJson } from "./http";

vi.mock("./http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./http")>();
  return { ...actual, getJson: vi.fn() };
});


const A_ROW = {
  query: "evil.example.com",
  answer: "1.2.3.4",
  rrtype: "a",
  firstSeenTimestamp: 1_700_000_000_000,
  lastSeenTimestamp: 1_710_000_000_000,
};

describe("parseMnemonicPdns", () => {
  it("domain lookup: A/AAAA answers become IP resolutions", () => {
    const out = parseMnemonicPdns([A_ROW], "domain");
    expect(out).toEqual([
      {
        value: "1.2.3.4",
        type: "ip",
        firstSeen: new Date(1_700_000_000_000).toISOString(),
        lastSeen: new Date(1_710_000_000_000).toISOString(),
        recordType: "A",
      },
    ]);
  });

  it("domain lookup: CNAME answer becomes a domain resolution", () => {
    const out = parseMnemonicPdns(
      [{ query: "www.example.com", answer: "example.com", rrtype: "cname" }],
      "domain",
    );
    expect(out[0]).toMatchObject({ value: "example.com", type: "domain", recordType: "CNAME" });
  });

  it("ip lookup: the query name becomes a domain that resolved to the IP", () => {
    const out = parseMnemonicPdns([A_ROW], "ip");
    expect(out[0]).toMatchObject({ value: "evil.example.com", type: "domain" });
  });

  it("ignores rrtypes that don't carry a resolution for the lookup direction", () => {
    // a TXT row yields nothing in either direction
    const txt = [{ query: "example.com", answer: "v=spf1 -all", rrtype: "txt" }];
    expect(parseMnemonicPdns(txt, "domain")).toEqual([]);
    expect(parseMnemonicPdns(txt, "ip")).toEqual([]);
  });
});

describe("parseMnemonicPdns — rows without a type", () => {
  it("skips them", () => {
    expect(parseMnemonicPdns([{ answer: "1.2.3.4" }], "domain")).toEqual([]);
  });
});

describe("makeMnemonicPassiveDnsSource", () => {
  const source = makeMnemonicPassiveDnsSource({ id: "pdns", lookup: "domain" });
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => vi.mocked(getJson).mockReset());

  it("needs no key", () => expect(source.isEnabled()).toBe(true));

  it("counts resolutions, singular and plural", async () => {
    reply({ data: [{ rrtype: "A", answer: "1.2.3.4" }] });
    expect((await source.check("a.example", signal)).summary).toBe("1 passive-DNS resolution");
    reply({ data: [{ rrtype: "A", answer: "1.2.3.4" }, { rrtype: "AAAA", answer: "::1" }] });
    expect((await source.check("a.example", signal)).summary).toBe("2 passive-DNS resolutions");
  });

  it("reports no records, rate limits, failures and errors", async () => {
    reply({});
    expect((await source.check("a.example", signal)).summary).toBe("No passive-DNS records");
    reply(null, 429);
    expect((await source.check("a.example", signal)).status).toBe("rate_limited");
    reply(null, 500);
    expect((await source.check("a.example", signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await source.check("a.example", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await source.check("a.example", signal)).error).toBe("boom");
  });
});
