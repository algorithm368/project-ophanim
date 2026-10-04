import { afterEach, describe, expect, it, vi } from "vitest";
import { dnsSource } from "./dns";
import { dohQuery, UNFILTERED_RESOLVERS } from "../../dns/doh";

const UNFILTERED_COUNT = Object.keys(UNFILTERED_RESOLVERS).length;

vi.mock("../../dns/doh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../dns/doh")>();
  return { ...actual, dohQuery: vi.fn() };
});

// This source is the sole producer of domainContext.nxdomain — the field the
// P1.2 verdict downgrade (assembleDomainResult clean→unknown) keys on. Pin
// the propagation so severing this line can't silently revert NXDOMAIN
// domains to "clean".
describe("dnsSource.check — nxdomain propagation (P1.2)", () => {
  afterEach(() => {
    vi.mocked(dohQuery).mockReset();
  });

  it("sets domainContext.nxdomain for a name that does not exist", async () => {
    vi.mocked(dohQuery).mockResolvedValue({ Status: 3 });
    const f = await dnsSource.check(
      "no-such-name.example",
      new AbortController().signal,
    );
    expect(f.status).toBe("ok");
    expect(f.domainContext?.nxdomain).toBe(true);
    expect(f.domainContext?.resolvedIps).toEqual([]);
    expect(f.summary).toContain("NXDOMAIN");
  });

  it("reports nxdomain false for a resolving name", async () => {
    vi.mocked(dohQuery).mockImplementation(async (_resolver, _name, type) =>
      type === "A"
        ? { Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }
        : { Status: 0 },
    );
    const f = await dnsSource.check("example.com", new AbortController().signal);
    expect(f.status).toBe("ok");
    // mergeFields keeps `false` (only undefined/null/""/[] are empty), so the
    // merged DomainContext stays coherent for resolving domains.
    expect(f.domainContext?.nxdomain).toBe(false);
    expect(f.domainContext?.resolvedIps).toEqual(["93.184.216.34"]);
  });
});

describe("dnsSource.check — resolver consensus", () => {
  afterEach(() => {
    vi.mocked(dohQuery).mockReset();
  });

  it("emits a high-confidence consensus when resolvers agree", async () => {
    vi.mocked(dohQuery).mockImplementation(async (_resolver, _name, type) =>
      type === "A"
        ? { Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }
        : { Status: 0 },
    );
    const f = await dnsSource.check("example.com", new AbortController().signal);
    const c = f.domainContext?.resolverConsensus;
    expect(c?.bucket).toBe("high");
    expect(c?.respondingResolvers).toBe(UNFILTERED_COUNT);
    expect(f.domainContext?.resolvedIps).toEqual(["93.184.216.34"]);
  });

  it("does not lower confidence when a resolver times out", async () => {
    vi.mocked(dohQuery).mockImplementation(async (resolver, _name, type) => {
      if (type === "A" && String(resolver).includes("adguard")) {
        throw new Error("timeout");
      }
      return type === "A"
        ? { Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }
        : { Status: 0 };
    });
    const f = await dnsSource.check("example.com", new AbortController().signal);
    const c = f.domainContext?.resolverConsensus;
    expect(c?.bucket).toBe("high");
    expect(c?.respondingResolvers).toBe(UNFILTERED_COUNT - 1);
    expect(c?.totalResolvers).toBe(UNFILTERED_COUNT);
    expect(c?.respondingResolvers).toBeLessThan(c?.totalResolvers ?? 0);
  });
});

describe("dnsSource.check — summaries and failures", () => {
  const signal = new AbortController().signal;
  afterEach(() => vi.mocked(dohQuery).mockReset());

  it("needs no key", () => expect(dnsSource.isEnabled()).toBe(true));

  it("leads with IPv6 when there is no A record, and names the mail host", async () => {
    vi.mocked(dohQuery).mockImplementation(async (resolver, _name, type) => {
      if (type === "A" && /cloudflare|google/.test(String(resolver))) throw new Error("down");
      if (type === "AAAA") {
        return { Status: 0, Answer: [{ type: 28, data: "2001:db8::1" }, { type: 28, data: "2001:db8::2" }] };
      }
      if (type === "MX") return { Status: 0, Answer: [{ type: 15, data: "10 mx.example.com." }] };
      return { Status: 0 };
    });
    const f = await dnsSource.check("example.com", signal);
    expect(f.summary).toBe(
      "Live infrastructure at check time. Apex resolves to 2001:db8::1 (+1 more host). Mail routed via mx.example.com.",
    );
  });

  it("says so when the resolvers split on the A record", async () => {
    let n = 0;
    vi.mocked(dohQuery).mockImplementation(async (_resolver, _name, type) =>
      type === "A"
        ? { Status: 0, Answer: [{ type: 1, data: `10.0.0.${++n}` }] }
        : { Status: 0 },
    );
    const f = await dnsSource.check("example.com", signal);
    expect(f.summary).toMatch(/Resolvers split on the A record/);
  });

  it("describes a zone with no apex address", async () => {
    vi.mocked(dohQuery).mockResolvedValue({ Status: 0 });
    expect((await dnsSource.check("example.com", signal)).summary).toMatch(
      /^DNS zone present but no A\/AAAA/,
    );
  });

  it("maps a failed record query to timeout or error", async () => {
    vi.mocked(dohQuery).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await dnsSource.check("example.com", signal)).status).toBe("timeout");
    vi.mocked(dohQuery).mockRejectedValue(new Error("boom"));
    expect((await dnsSource.check("example.com", signal)).error).toBe("boom");
  });
});
