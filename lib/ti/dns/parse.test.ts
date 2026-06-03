import { describe, expect, it } from "vitest";
import {
  extractDmarc,
  extractSpf,
  normalizeMxHosts,
  resolversAgree,
  dnssecStatus,
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

describe("resolversAgree", () => {
  it("is true when answer sets match regardless of order", () => {
    expect(resolversAgree([["1.1.1.1", "2.2.2.2"], ["2.2.2.2", "1.1.1.1"]])).toBe(true);
  });
  it("is false when answer sets differ", () => {
    expect(resolversAgree([["1.1.1.1"], ["9.9.9.9"]])).toBe(false);
  });
  it("ignores resolvers that returned nothing", () => {
    expect(resolversAgree([["1.1.1.1"], []])).toBe(true);
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
