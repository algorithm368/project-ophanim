import { beforeEach, describe, expect, it, vi } from "vitest";
import { reverseDnsSource } from "./reverse-dns";
import { dohQuery } from "../dns/doh";

// Only dohQuery is mocked; answers() stays real so the response shape is
// exercised too.
vi.mock("../dns/doh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dns/doh")>();
  return { ...actual, dohQuery: vi.fn() };
});

const signal = () => new AbortController().signal;
/** A DoH answer set. Types: 1 = A, 12 = PTR, 28 = AAAA. */
const answer = (type: number, data: string) => ({ Answer: [{ type, data }] });

beforeEach(() => {
  vi.mocked(dohQuery).mockReset();
});

describe("reverseDnsSource", () => {
  it("queries ip6.arpa then AAAA for an IPv6 address", async () => {
    const seen: { name: string; type: string }[] = [];
    vi.mocked(dohQuery).mockImplementation(async (_resolver, name, type) => {
      seen.push({ name, type });
      if (type === "PTR") return answer(12, "dns.google.");
      if (type === "AAAA") return answer(28, "2001:4860:4860:0:0:0:0:8888");
      return null;
    });

    const f = await reverseDnsSource.check("2001:4860:4860::8888", signal());

    expect(seen[0].type).toBe("PTR");
    expect(seen[0].name.endsWith(".ip6.arpa")).toBe(true);
    // AAAA, not A: an A lookup for a v6 host would never confirm.
    expect(seen[1].type).toBe("AAAA");
    // The forward answer is the same address spelled uncompressed, so FCrDNS
    // must still verify it. Raw string equality would call this unconfirmed.
    expect(f.summary).toContain("forward-confirmed");
    expect(f.geo?.fcrdns).toEqual({ hostname: "dns.google", verified: true });
  });

  it("queries in-addr.arpa then A for an IPv4 address", async () => {
    const seen: { name: string; type: string }[] = [];
    vi.mocked(dohQuery).mockImplementation(async (_resolver, name, type) => {
      seen.push({ name, type });
      if (type === "PTR") return answer(12, "dns.google.");
      return answer(1, "8.8.4.4");
    });

    const f = await reverseDnsSource.check("8.8.4.4", signal());

    expect(seen[0].name).toBe("4.4.8.8.in-addr.arpa");
    expect(seen[1].type).toBe("A");
    expect(f.geo?.fcrdns).toEqual({ hostname: "dns.google", verified: true });
  });

  it("marks a mismatched forward record unconfirmed", async () => {
    vi.mocked(dohQuery).mockImplementation(async (_resolver, _name, type) =>
      type === "PTR"
        ? answer(12, "evil.example.com.")
        : answer(28, "2001:db8::99"),
    );

    const f = await reverseDnsSource.check("2001:4860:4860::8888", signal());

    expect(f.summary).toContain("unconfirmed");
    expect(f.geo?.fcrdns?.verified).toBe(false);
  });

  it("reports no PTR record when the reverse lookup is empty", async () => {
    vi.mocked(dohQuery).mockResolvedValue(null);
    const f = await reverseDnsSource.check("2001:4860:4860::8888", signal());
    expect(f.status).toBe("ok");
    expect(f.summary).toBe("No PTR record");
  });

  it("returns an error finding rather than throwing when the resolver fails", async () => {
    vi.mocked(dohQuery).mockRejectedValue(new Error("resolver exploded"));
    const f = await reverseDnsSource.check("2001:4860:4860::8888", signal());
    expect(f.status).toBe("error");
    expect(f.error).toContain("resolver exploded");
  });
});

describe("reverseDnsSource edge paths", () => {
  it("needs no key", () => expect(reverseDnsSource.isEnabled()).toBe(true));

  it("maps a timeout", async () => {
    vi.mocked(dohQuery).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await reverseDnsSource.check("8.8.8.8", signal())).status).toBe("timeout");
  });
});
