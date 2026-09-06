import { afterEach, describe, expect, it, vi } from "vitest";
import { domainFcrdnsSource } from "./fcrdns";
import { dohQuery, resolveA } from "../../dns/doh";

// resolveA is mocked directly (not just dohQuery) for the same reason
// documented in tls-cert.test.ts: it is defined in the same module as
// dohQuery and its internal call to dohQuery is not intercepted by mocking
// dohQuery's export alone. dohQuery itself is also mocked because
// domainFcrdnsSource calls it directly (from a different module) for the
// PTR/forward-resolve step.
vi.mock("../../dns/doh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../dns/doh")>();
  return { ...actual, resolveA: vi.fn(), dohQuery: vi.fn() };
});

const mockResolveA = vi.mocked(resolveA);
const mockDohQuery = vi.mocked(dohQuery);
const SIGNAL = new AbortController().signal;
const answer = (type: number, data: string) => ({ Answer: [{ type, data }] });

describe("domainFcrdnsSource.check", () => {
  afterEach(() => {
    mockResolveA.mockReset();
    mockDohQuery.mockReset();
  });

  it("reports no finding when the domain has no resolved IP", async () => {
    mockResolveA.mockResolvedValue([]);
    const f = await domainFcrdnsSource.check("no-such.example", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.summary).toContain("No resolved IP");
  });

  it("reports no PTR when the resolved IP has none", async () => {
    mockResolveA.mockResolvedValue(["93.184.216.34"]);
    mockDohQuery.mockResolvedValue(null);
    const f = await domainFcrdnsSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.summary).toContain("has no PTR record");
  });

  it("forward-confirms a matching PTR", async () => {
    mockResolveA.mockResolvedValue(["8.8.4.4"]);
    mockDohQuery.mockImplementation(async (_resolver, _name, type) =>
      type === "PTR" ? answer(12, "dns.google.") : answer(1, "8.8.4.4"),
    );
    const f = await domainFcrdnsSource.check("dns.google", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.summary).toContain("forward-confirmed");
    expect(f.details).toEqual({
      ip: "8.8.4.4",
      hostname: "dns.google",
      forwardConfirmed: true,
    });
  });

  it("marks a mismatched forward record unconfirmed", async () => {
    mockResolveA.mockResolvedValue(["93.184.216.34"]);
    mockDohQuery.mockImplementation(async (_resolver, _name, type) =>
      type === "PTR" ? answer(12, "evil.example.com.") : answer(1, "1.2.3.4"),
    );
    const f = await domainFcrdnsSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.summary).toContain("unconfirmed");
    expect(f.details?.forwardConfirmed).toBe(false);
  });
});
