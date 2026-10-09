import { afterEach, describe, expect, it } from "vitest";
import { invalidSummary, parseBulkInput } from "./parse";

afterEach(() => delete process.env.TI_INTERNAL_SUFFIXES);

describe("parseBulkInput", () => {
  it("handles CRLF, trailing spaces, separators and refang", () => {
    const r = parseBulkInput("1.1.1.1 \r\nevil[.]com, 8.8.8.8;\r\n");
    expect(r.items.map((i) => i.indicator)).toEqual(["1.1.1.1", "evil.com", "8.8.8.8"]);
  });

  it("collapses case variants", () => {
    const r = parseBulkInput("Gvaq70s7he.ru \ngvaq70s7he.ru");
    expect(r.items).toEqual([{ indicator: "gvaq70s7he.ru", kind: "domain" }]);
    expect(r.duplicates).toBe(1);
  });

  it("converts a Thai IDN to punycode, keeps the display form, and dedupes it", () => {
    const r = parseBulkInput("หีหอม.com\nxn--y3ctai2b.com");
    expect(r.items).toEqual([{ indicator: "xn--y3ctai2b.com", kind: "domain", display: "หีหอม.com" }]);
    expect(r.duplicates).toBe(1);
  });

  it("reads leading zeros as decimal, with a note", () => {
    expect(parseBulkInput("15.03.05.16").items).toEqual([
      { indicator: "15.3.5.16", kind: "ip", note: "Read as 15.3.5.16, written with leading zeros" },
    ]);
  });

  it("marks internal names, configured and single-label", () => {
    process.env.TI_INTERNAL_SUFFIXES = "dc01.fujixerox.net";
    const r = parseBulkInput("SGPAPHQ-ADDC04.dc01.fujixerox.net fileserver01");
    expect(r.items).toEqual([
      { indicator: "sgpaphq-addc04.dc01.fujixerox.net", kind: "domain", internal: true },
      { indicator: "fileserver01", kind: "domain", internal: true },
    ]);
  });

  it("refuses CIDR, hashes, URLs, non-routable IPs, special-use names and junk, with reasons", () => {
    const r = parseBulkInput("216.126.237.0/24 d41d8cd98f00b204e9800998ecf8427e hxxps://bad.example.org/x 10.0.0.1 foo.test ???");
    expect(r.items).toEqual([]);
    expect(r.invalid.map((i) => i.reason)).toEqual([
      "CIDR range, not expanded",
      "Not supported in bulk, hash",
      "Not supported in bulk, url",
      expect.stringMatching(/^Non-routable address, /),
      expect.stringMatching(/^Special-use domain, /),
      "Not an IP or domain",
    ]);
  });

  it("keeps IPv6 and returns nothing for blank input", () => {
    expect(parseBulkInput("2001:4860:4860::8888").items[0]).toMatchObject({ kind: "ip" });
    expect(parseBulkInput("  \r\n ")).toEqual({ items: [], invalid: [], duplicates: 0 });
  });
});

describe("invalidSummary", () => {
  it("groups by the reason's head", () => {
    expect(
      invalidSummary([
        { input: "a", reason: "Non-routable address, private" },
        { input: "b", reason: "Non-routable address, loopback" },
        { input: "c", reason: "CIDR range, not expanded" },
      ]),
    ).toEqual({ "Non-routable address": 2, "CIDR range": 1 });
  });
});
