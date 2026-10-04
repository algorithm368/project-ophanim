import { afterEach, describe, expect, it, vi } from "vitest";
import { scannerIdSource, scannerOperator } from "@/lib/ti/sources/scanner-id";
import { dohQuery } from "@/lib/ti/dns/doh";

describe("scannerOperator", () => {
  it.each([
    ["pirate.census.shodan.io", "Shodan"],
    ["1.125.142.162.censys-scanner.com", "Censys"],
    ["scan-01.scanner.shadowserver.org", "Shadowserver"],
    ["probe.onyphe.net", "ONYPHE"],
    ["scanner-05.ch1.censys-scanner.com", "Censys"],
    ["sf01.stretchoid.com", "Stretchoid"],
  ])("identifies %s as %s", (host, operator) => {
    // These are the live PTR records: 71.6.146.185 really does call itself
    // pirate.census.shodan.io, and 162.142.125.1 censys-scanner.com.
    expect(scannerOperator(host)).toBe(operator);
  });

  it("tolerates the trailing dot a PTR record carries", () => {
    expect(scannerOperator("pirate.census.shodan.io.")).toBe("Shodan");
  });

  it("is case insensitive", () => {
    expect(scannerOperator("PIRATE.CENSUS.SHODAN.IO")).toBe("Shodan");
  });

  it("does not let a lookalike domain claim the label", () => {
    // The whole signal is that the operator names its own hosts, so a name that
    // merely contains the string must not qualify.
    expect(scannerOperator("shodan.io.evil.example")).toBeUndefined();
    expect(scannerOperator("notshodan.io")).toBeUndefined();
    expect(scannerOperator("fake-censys-scanner.com.attacker.test")).toBeUndefined();
  });

  it("returns undefined for an ordinary host and for no host at all", () => {
    expect(scannerOperator("dns.google")).toBeUndefined();
    expect(scannerOperator("192-227-144-55-host.colocrossing.com")).toBeUndefined();
    expect(scannerOperator(undefined)).toBeUndefined();
    expect(scannerOperator("   ")).toBeUndefined();
  });
});

// The check() path: the PTR lookup is the whole source, so it is mocked at the
// DoH helper the way the DNS source's own tests do.
vi.mock("@/lib/ti/dns/doh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/dns/doh")>();
  return { ...actual, dohQuery: vi.fn() };
});

describe("scannerIdSource.check", () => {
  const signal = () => new AbortController().signal;
  afterEach(() => vi.mocked(dohQuery).mockReset());

  it("vouches for and names a scanner it recognises", async () => {
    vi.mocked(dohQuery).mockResolvedValue({
      Status: 0,
      Answer: [{ type: 12, data: "pirate.census.shodan.io" }],
    });
    const f = await scannerIdSource.check("71.6.146.185", signal());
    expect(f.status).toBe("ok");
    expect(f.allowlisted).toBe(true);
    expect(f.score).toBe(0);
    expect(f.categories).toContain("internet-scanner");
    expect(f.summary).toContain("Shodan");
    expect(f.details).toMatchObject({ operator: "Shodan" });
  });

  it("does not vouch for an ordinary host", async () => {
    vi.mocked(dohQuery).mockResolvedValue({
      Status: 0,
      Answer: [{ type: 12, data: "dns.google" }],
    });
    const f = await scannerIdSource.check("8.8.8.8", signal());
    expect(f.allowlisted).toBeUndefined();
    expect(f.summary).toBe("Not a recognised research scanner");
  });

  it("says there was nothing to identify when no PTR exists", async () => {
    vi.mocked(dohQuery).mockResolvedValue({ Status: 0 });
    const f = await scannerIdSource.check("103.83.237.2", signal());
    expect(f.summary).toBe("No PTR record to identify");
    expect(f.allowlisted).toBeUndefined();
  });

  it("reports a resolver failure as an error, never as a verdict", async () => {
    vi.mocked(dohQuery).mockRejectedValue(new Error("resolver down"));
    const f = await scannerIdSource.check("1.2.3.4", signal());
    expect(f.status).toBe("error");
    expect(f.error).toContain("resolver down");
  });

  it("reports a timeout as a timeout", async () => {
    // isTimeout() keys on DOMException specifically, which is what an aborted
    // fetch actually throws; a plain Error with the same name is an error.
    vi.mocked(dohQuery).mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    expect((await scannerIdSource.check("1.2.3.4", signal())).status).toBe("timeout");
  });
});

describe("scannerIdSource.isEnabled", () => {
  it("needs no key", () => expect(scannerIdSource.isEnabled()).toBe(true));
});
