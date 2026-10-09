import { describe, expect, it, vi } from "vitest";

// detectIOC only names a kind its parser accepts, so the "parser said no"
// fallbacks in checkIp/checkDomain are unreachable through real input. Force
// the disagreement here so a future detectIOC that loosens up still yields a
// reason rather than a crash.
vi.mock("@/lib/ioc", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ioc")>();
  return {
    ...real,
    detectIOC: (v: string) => {
      if (v.startsWith("ip")) return "ip";
      if (v.startsWith("dn")) return "domain";
      return real.detectIOC(v);
    },
  };
});

const { parseBulkInput } = await import("./parse");

describe("parseBulkInput when detectIOC and the parsers disagree", () => {
  it("reports an IP its parser rejects as reserved", () => {
    expect(parseBulkInput("ip-junk").invalid[0].reason).toBe("Non-routable address, reserved");
  });

  it("reports a domain its parser rejects as reserved", () => {
    expect(parseBulkInput("dn_junk").invalid[0].reason).toBe("Special-use domain, reserved");
  });
});
