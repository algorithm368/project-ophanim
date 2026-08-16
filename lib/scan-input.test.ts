import { describe, expect, it } from "vitest";
import { isScanProblem, readScanInput, type ScanInput } from "@/lib/scan-input";

/** Read a value that is expected to be scannable. */
function ok(raw: string): ScanInput {
  const read = readScanInput(raw);
  if (!read || isScanProblem(read)) {
    throw new Error(`expected ${raw} to be scannable, got ${JSON.stringify(read)}`);
  }
  return read;
}

/** The complaint for a value that is not scannable. */
function problem(raw: string): string {
  const read = readScanInput(raw);
  if (!read || !isScanProblem(read)) {
    throw new Error(`expected ${raw} to be refused, got ${JSON.stringify(read)}`);
  }
  return read.message;
}

describe("readScanInput", () => {
  it("says nothing about an empty box", () => {
    expect(readScanInput("")).toBeNull();
    expect(readScanInput("   ")).toBeNull();
  });

  it("reads a domain, and names the one URL it would visit", () => {
    expect(ok("google.com")).toEqual({
      indicator: "google.com",
      kind: "domain",
      targets: ["https://google.com/"],
    });
  });

  it("reads an IP as both ports, because a bare address carries no scheme", () => {
    const read = ok("8.8.8.8");
    expect(read.kind).toBe("ip");
    expect(read.targets).toEqual(["http://8.8.8.8/", "https://8.8.8.8/"]);
  });

  it("keeps a URL whole, path and query included", () => {
    const read = ok("https://secure-login.top/auth?id=7");
    expect(read.kind).toBe("url");
    expect(read.indicator).toBe("https://secure-login.top/auth?id=7");
    expect(read.targets).toEqual(["https://secure-login.top/auth?id=7"]);
  });

  it("undefangs what a ticket hands over", () => {
    // The analyst was given a deliberately unclickable string; making them edit
    // it back by hand is how a typo becomes the wrong scan.
    expect(ok("evil[.]com").indicator).toBe("evil.com");
    expect(ok("hxxps://evil[.]com/pay").indicator).toBe("https://evil.com/pay");
  });

  it("canonicalizes, so one site is not two pages", () => {
    expect(ok("GOOGLE.COM").indicator).toBe("google.com");
  });

  it("scans an IPv6 address, bracketing it into the authority", () => {
    const read = ok("2606:4700:4700::1111");
    expect(read.indicator).toBe("2606:4700:4700::1111");
    expect(read.targets).toEqual([
      "http://[2606:4700:4700::1111]/",
      "https://[2606:4700:4700::1111]/",
    ]);
  });

  it("refuses a hash, and says where its reputation does live", () => {
    const message = problem("44d88612fea8a8f36de82e1278abb02f");
    expect(message).toMatch(/no address to visit/);
    expect(message).toMatch(/passively/);
  });

  it("refuses what is not an indicator at all", () => {
    expect(problem("not an indicator")).toMatch(/nothing to visit/);
  });

  it("refuses a non-routable address at the same boundary the route does", () => {
    // Asking a third party to fetch this both wastes quota and tells them about
    // internal addressing.
    expect(problem("192.168.1.1")).toMatch(/non-routable/i);
    expect(problem("http://10.0.0.1/admin")).toMatch(/non-routable/i);
  });

  it("refuses a special-use name", () => {
    expect(problem("example.com")).toMatch(/special-use/i);
    expect(problem("something.localhost")).toMatch(/special-use/i);
  });
});
