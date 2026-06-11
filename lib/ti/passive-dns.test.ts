import { describe, it, expect } from "vitest";
import { parseMnemonicPdns } from "./passive-dns";

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
