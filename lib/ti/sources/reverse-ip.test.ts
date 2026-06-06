import { describe, expect, it } from "vitest";
import { isQuotaExceeded, parseReverseIp } from "./reverse-ip";

describe("parseReverseIp", () => {
  it("extracts distinct lowercased domains, one per line", () => {
    const body = ["dns.google", "DNS.GOOGLE", "example.com", "sub.example.co.uk"].join(
      "\n",
    );
    expect(parseReverseIp(body, "8.8.8.8")).toEqual([
      "dns.google",
      "example.com",
      "sub.example.co.uk",
    ]);
  });

  it("strips trailing dots and blank lines", () => {
    expect(parseReverseIp("evil.com.\n\n  good.org  \n", "1.2.3.4")).toEqual([
      "evil.com",
      "good.org",
    ]);
  });

  it("drops bare IPs, the queried IP, and junk lines", () => {
    const body = ["1.2.3.4", "8.8.8.8", "not a domain", "real.com"].join("\n");
    expect(parseReverseIp(body, "8.8.8.8")).toEqual(["real.com"]);
  });

  it("returns an empty list for an empty body", () => {
    expect(parseReverseIp("", "1.2.3.4")).toEqual([]);
  });
});

describe("isQuotaExceeded", () => {
  it("detects the free-tier quota message", () => {
    expect(
      isQuotaExceeded("API count exceeded - Increase Quota with Membership"),
    ).toBe(true);
  });

  it("is false for a normal result body", () => {
    expect(isQuotaExceeded("dns.google\nexample.com")).toBe(false);
  });
});
