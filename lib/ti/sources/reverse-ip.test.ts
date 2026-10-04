import { afterEach, describe, expect, it, vi } from "vitest";
import { describeTenancy, isQuotaExceeded, parseReverseIp, reverseIpSource } from "./reverse-ip";
import { getText } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getText: vi.fn() };
});

/** n distinct hostnames, for exercising the two ceilings. */
const names = (n: number) => Array.from({ length: n }, (_, i) => `h${i}.example.test`);

describe("describeTenancy", () => {
  it("reports a real count as a count", () => {
    const f = describeTenancy(names(12));
    expect(f.summary).toBe("12 domains share this IP");
    expect(f.details).toMatchObject({ domainCount: 12, atCeiling: false });
  });

  it("says more-than once the provider stops counting", () => {
    // HackerTarget's free tier returns 500 lines and says nothing about what
    // it left out. Reporting that as "500 domains" reads as a measurement of
    // an address that actually carries tens of thousands.
    const f = describeTenancy(names(500));
    expect(f.summary).toContain("More than 500 domains");
    expect(f.details).toMatchObject({ domainCount: 500, atCeiling: true });
  });

  it("keeps our display cap separate from theirs", () => {
    // Showing 40 of 120 is a choice we made knowing the number; stopping at
    // 500 is an admission that we do not know it.
    const f = describeTenancy(names(120));
    expect(f.summary).toBe("120 domains share this IP (showing 40)");
    expect(f.details).toMatchObject({ atCeiling: false });
    expect(f.details?.domains as string[]).toHaveLength(40);
    expect(f.relations).toHaveLength(40);
  });

  it("does not pluralise a single neighbour", () => {
    expect(describeTenancy(names(1)).summary).toBe("1 domain shares this IP");
  });

  it("says nothing was found rather than reporting zero tenants", () => {
    const f = describeTenancy([]);
    expect(f.summary).toBe("No other domains found on this IP");
    expect(f.details).toBeUndefined();
  });
});

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

describe("reverseIpSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (text: string, status = 200) =>
    vi.mocked(getText).mockResolvedValue({ ok: status < 400, status, data: null, text });
  afterEach(() => vi.mocked(getText).mockReset());

  it("needs no key", () => expect(reverseIpSource.isEnabled()).toBe(true));

  it("lists co-hosted domains", async () => {
    reply("a.example\nb.example\n");
    const f = await reverseIpSource.check("1.2.3.4", signal);
    expect(f.details).toMatchObject({ domainCount: 2 });
    expect(f.raw).toBe("a.example\nb.example");
  });

  it("maps the quota message, HTTP failures, timeouts and errors", async () => {
    reply("API count exceeded - Increase Quota with Membership");
    expect((await reverseIpSource.check("1.2.3.4", signal)).status).toBe("rate_limited");
    reply("", 500);
    expect((await reverseIpSource.check("1.2.3.4", signal)).error).toBe("HTTP 500");
    vi.mocked(getText).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await reverseIpSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getText).mockRejectedValue(new Error("boom"));
    expect((await reverseIpSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
