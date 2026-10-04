import { describe, expect, it, vi } from "vitest";
import { classifyDbl, isAbusedLegit, isBlockedCode, spamhausDblSource } from "./spamhaus-dbl";

const dnsAnswer = vi.hoisted(() => ({ current: [] as string[] | Error | string }));

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    async resolve4(): Promise<string[]> {
      const a = dnsAnswer.current;
      if (Array.isArray(a)) return a;
      throw a;
    }
  },
}));

const dnsError = (code: string) => Object.assign(new Error(code), { code });


describe("isBlockedCode / isAbusedLegit", () => {
  it("identifies the refused/open-resolver sentinels", () => {
    expect(isBlockedCode("127.0.1.255")).toBe(true);
    expect(isBlockedCode("127.255.255.1")).toBe(true);
    expect(isBlockedCode("127.0.1.4")).toBe(false);
  });

  it("identifies the abused-legit (127.0.1.10x) range", () => {
    expect(isAbusedLegit("127.0.1.104")).toBe(true);
    expect(isAbusedLegit("127.0.1.4")).toBe(false);
  });
});

describe("classifyDbl", () => {
  it("reports not-listed for an empty answer", () => {
    expect(classifyDbl([])).toEqual({ listed: false, refused: false });
  });

  it("reports refused when every answer is a block sentinel", () => {
    expect(classifyDbl(["127.0.1.255"])).toEqual({ listed: false, refused: true });
  });

  it("scores a direct listing as malicious (80)", () => {
    expect(classifyDbl(["127.0.1.4"])).toEqual({
      listed: true,
      codes: ["127.0.1.4"],
      meanings: ["phishing domain"],
      malicious: true,
      score: 80,
    });
  });

  it("softens an abused-legit-only listing (45, not malicious)", () => {
    expect(classifyDbl(["127.0.1.104"])).toEqual({
      listed: true,
      codes: ["127.0.1.104"],
      meanings: ["abused legit phishing"],
      malicious: false,
      score: 45,
    });
  });

  it("ignores block sentinels mixed in with real listings", () => {
    expect(classifyDbl(["127.0.1.255", "127.0.1.5"])).toMatchObject({
      listed: true,
      codes: ["127.0.1.5"],
      meanings: ["malware domain"],
      malicious: true,
    });
  });

  it("labels an unknown listing code", () => {
    expect(classifyDbl(["127.0.1.9"])).toMatchObject({
      meanings: ["listed (127.0.1.9)"],
    });
  });
});

describe("spamhausDblSource.check", () => {
  const signal = new AbortController().signal;
  const check = (answer: string[] | Error | string) => {
    dnsAnswer.current = answer;
    return spamhausDblSource.check("a.example", signal);
  };

  it("needs no key", () => expect(spamhausDblSource.isEnabled()).toBe(true));

  it("maps listings, refusals and misses", async () => {
    expect(await check(["127.0.1.4"])).toMatchObject({
      malicious: true,
      score: 80,
      summary: "Listed on Spamhaus DBL: phishing domain",
    });
    expect((await check(["127.0.1.255"])).summary).toBe("Query refused (open-resolver limit)");
    expect((await check([])).summary).toBe("Not listed");
    expect((await check(dnsError("ENOTFOUND"))).summary).toBe("Not listed");
    expect((await check(dnsError("ENODATA"))).summary).toBe("Not listed");
  });

  it("reports resolver failures, thrown Errors or not", async () => {
    expect(await check(dnsError("ETIMEOUT"))).toEqual({ status: "error", error: "ETIMEOUT" });
    expect(await check("weird")).toEqual({ status: "error", error: "weird" });
  });
});
