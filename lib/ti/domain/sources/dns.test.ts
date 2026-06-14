import { afterEach, describe, expect, it, vi } from "vitest";
import { dnsSource } from "./dns";
import { dohQuery } from "../../dns/doh";

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
