import { describe, expect, it } from "vitest";
import {
  extractDmarc,
  extractSpf,
  normalizeMxHosts,
  dnssecStatus,
  decodeCaa,
} from "./parse";

describe("extractSpf", () => {
  it("finds the SPF record among TXT records", () => {
    expect(extractSpf(['"v=spf1 include:_spf.google.com ~all"', "google-site-verification=x"]))
      .toBe("v=spf1 include:_spf.google.com ~all");
  });
  it("returns undefined when no SPF present", () => {
    expect(extractSpf(["google-site-verification=x"])).toBeUndefined();
  });
});

describe("extractDmarc", () => {
  it("finds the DMARC record and strips quotes", () => {
    expect(extractDmarc(['"v=DMARC1; p=reject; rua=mailto:x@y.com"']))
      .toBe("v=DMARC1; p=reject; rua=mailto:x@y.com");
  });
  it("returns undefined when no DMARC present", () => {
    expect(extractDmarc(['"v=spf1 ~all"'])).toBeUndefined();
  });
});

describe("normalizeMxHosts", () => {
  it("strips the priority prefix and keeps the host", () => {
    expect(normalizeMxHosts(["10 mail.example.com", "20 alt.example.com"]))
      .toEqual(["mail.example.com", "alt.example.com"]);
  });
});

describe("dnssecStatus", () => {
  it("signed when any resolver set AD", () => {
    expect(dnssecStatus([{ AD: true }, { AD: false }])).toBe("signed");
  });
  it("unsigned when all resolvers answered without AD", () => {
    expect(dnssecStatus([{ AD: false }, { Status: 0 }])).toBe("unsigned");
  });
  it("unknown when no resolver responded", () => {
    expect(dnssecStatus([null, null])).toBe("unknown");
  });
});

describe("decodeCaa", () => {
  it("decodes RFC 3597 generic CAA hex into tag + value", () => {
    // flags=00, taglen=05, tag="issue", value="pki.goog"
    expect(decodeCaa("\\# 15 00 05 69 73 73 75 65 70 6b 69 2e 67 6f 6f 67"))
      .toBe("issue pki.goog");
  });
  it("leaves already-textual records unchanged", () => {
    expect(decodeCaa('0 issue "letsencrypt.org"')).toBe('0 issue "letsencrypt.org"');
  });

  // The guard used to reject only NaN, so a token wider than a byte reached
  // String.fromCharCode and was silently truncated mod 65536. It now has to be
  // rejected outright, because String.fromCodePoint would throw RangeError on
  // anything above 0x10FFFF.
  it("rejects hex tokens that are not bytes rather than truncating them", () => {
    expect(decodeCaa("\\# 4 00 05 1FFFFFFF 41")).toBe("\\# 4 00 05 1FFFFFFF 41");
    expect(() => decodeCaa("\\# 4 00 05 1FFFFFFF 41")).not.toThrow();
  });

  it("still rejects malformed hex", () => {
    expect(decodeCaa("\\# 2 zz zz")).toBe("\\# 2 zz zz");
  });
});
