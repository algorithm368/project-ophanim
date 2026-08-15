import { describe, expect, it } from "vitest";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";

describe("scanTargetsFor", () => {
  it("submits a URL as itself, canonicalized", () => {
    expect(scanTargetsFor("EVIL.com/login#frag", "url")).toEqual([
      "https://evil.com/login",
    ]);
  });

  it("strips credentials before anything leaves for a third party", () => {
    expect(scanTargetsFor("https://user:pass@evil.com/a", "url")).toEqual([
      "https://evil.com/a",
    ]);
  });

  it("submits a domain over https", () => {
    expect(scanTargetsFor("google.com", "domain")).toEqual([
      "https://google.com/",
    ]);
  });

  it("submits both ports for an IP, since a bare address has no scheme", () => {
    expect(scanTargetsFor("8.8.8.8", "ip")).toEqual([
      "http://8.8.8.8/",
      "https://8.8.8.8/",
    ]);
  });

  it("brackets an IPv6 literal so the URL is valid", () => {
    expect(scanTargetsFor("2606:4700:4700::1111", "ip")).toEqual([
      "http://[2606:4700:4700::1111]/",
      "https://[2606:4700:4700::1111]/",
    ]);
  });

  it("returns nothing for a hash, which has no address to visit", () => {
    expect(scanTargetsFor("d41d8cd98f00b204e9800998ecf8427e", "hash")).toEqual(
      [],
    );
  });

  it("returns nothing for an unparseable indicator rather than guessing", () => {
    expect(scanTargetsFor("not a url", "url")).toEqual([]);
  });
});
