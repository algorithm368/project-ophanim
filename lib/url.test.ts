import { describe, expect, it } from "vitest";
import { hostFromUrl, looksLikeUrl, parseUrl } from "@/lib/url";

describe("hostFromUrl", () => {
  it("extracts a lowercased hostname from a full URL", () => {
    expect(hostFromUrl("https://Evil.Example.com/path?x=1")).toBe(
      "evil.example.com",
    );
  });

  it("keeps an IPv4 host (drops the port)", () => {
    expect(hostFromUrl("http://1.2.3.4:8080/a.exe")).toBe("1.2.3.4");
  });

  it("returns undefined for a scheme-less or garbage string", () => {
    expect(hostFromUrl("evil.example.com/x")).toBeUndefined();
    expect(hostFromUrl("not a url")).toBeUndefined();
    expect(hostFromUrl("")).toBeUndefined();
  });
});

describe("parseUrl — canonicalization", () => {
  it("defaults a missing scheme to https", () => {
    expect(parseUrl("evil.com/login")!.canonical).toBe("https://evil.com/login");
  });

  it("drops the fragment, which is never sent to the server", () => {
    expect(parseUrl("https://evil.com/a#section")!.canonical).toBe(
      "https://evil.com/a",
    );
  });

  it("lowercases the host but preserves path and query case", () => {
    const p = parseUrl("https://EVIL.com/LogIn?Token=AbC")!;
    expect(p.host).toBe("evil.com");
    expect(p.path).toBe("/LogIn");
    expect(p.query).toBe("Token=AbC");
  });

  it("removes a default port and keeps a non-default one", () => {
    expect(parseUrl("https://evil.com:443/a")!.port).toBeUndefined();
    expect(parseUrl("https://evil.com:8443/a")!.port).toBe(8443);
    expect(parseUrl("https://evil.com:8443/a")!.canonical).toBe(
      "https://evil.com:8443/a",
    );
  });

  it("punycodes a unicode host", () => {
    // The "а" here is Cyrillic U+0430, the classic paypal homograph.
    expect(parseUrl("https://pаypal.com/")!.host).toMatch(/^xn--/);
  });

  it("strips userinfo from canonical but keeps it on the parse", () => {
    const p = parseUrl("https://user:pass@evil.com/a")!;
    expect(p.canonical).toBe("https://evil.com/a");
    expect(p.userinfo).toBe("user:pass");
  });

  it("gives an empty path the root slash", () => {
    expect(parseUrl("https://evil.com")!.path).toBe("/");
  });

  it("marks an IP-literal host", () => {
    expect(parseUrl("http://185.220.101.1/x")!.isIpHost).toBe(true);
    expect(parseUrl("http://evil.com/x")!.isIpHost).toBe(false);
  });
});

describe("parseUrl — rejection", () => {
  it.each([
    ["ftp://evil.com/a", "non-http scheme"],
    ["javascript:alert(1)", "non-http scheme"],
    ["https://", "no host"],
    ["not a url at all", "no host"],
  ])("rejects %s (%s)", (input) => {
    expect(parseUrl(input)).toBeNull();
  });

  it("rejects a URL longer than 2048 characters", () => {
    expect(parseUrl(`https://evil.com/${"a".repeat(2100)}`)).toBeNull();
  });
});

describe("looksLikeUrl", () => {
  it.each([
    ["evil.com", false],
    ["evil.com/login", true],
    ["evil.com?a=1", true],
    ["https://evil.com", true],
    ["8.8.8.8", false],
  ])("%s -> %s", (input, expected) => {
    expect(looksLikeUrl(input)).toBe(expected);
  });
});

describe("url helpers — edge cases", () => {
  it("has no host for a URL without one", () => {
    expect(hostFromUrl("file:///etc/passwd")).toBeUndefined();
  });

  it("does not read empty input as a URL", () => {
    expect(looksLikeUrl("   ")).toBe(false);
  });

  it("rejects a host that is only the root dot", () => {
    expect(parseUrl("https://./")).toBeNull();
  });

  it("keeps a username given without a password", () => {
    expect(parseUrl("https://admin@a.test/")?.userinfo).toBe("admin");
  });
});
