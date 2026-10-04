import { describe, expect, it, vi } from "vitest";
import { cymruMhrSource, cymruScore, parseCymruTxt } from "./cymru-mhr";

const txtAnswer = vi.hoisted(() => ({ current: [] as string[][] | unknown }));

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    async resolveTxt(): Promise<string[][]> {
      const a = txtAnswer.current;
      if (Array.isArray(a)) return a;
      throw a;
    }
  },
}));

describe("parseCymruTxt", () => {
  it("parses '<ts> <detection>' into an ISO date + percentage", () => {
    expect(parseCymruTxt("1700000000 75")).toEqual({
      lastSeen: "2023-11-14T22:13:20.000Z",
      detection: 75,
    });
  });

  it("yields no date and NaN detection for junk", () => {
    const r = parseCymruTxt("nonsense");
    expect(r.lastSeen).toBeUndefined();
    expect(Number.isNaN(r.detection)).toBe(true);
  });
});

describe("cymruScore", () => {
  it("floors a known sample at 50 and caps at 95", () => {
    expect(cymruScore(10)).toBe(50);
    expect(cymruScore(75)).toBe(75);
    expect(cymruScore(99)).toBe(95);
  });

  it("falls back to 60 when the detection rate is missing", () => {
    expect(cymruScore(NaN)).toBe(60);
  });
});

describe("cymruMhrSource.check", () => {
  const signal = new AbortController().signal;
  const check = (answer: unknown) => {
    txtAnswer.current = answer;
    return cymruMhrSource.check("a".repeat(32), signal);
  };
  const dnsError = (code: string) => Object.assign(new Error(code), { code });

  it("needs no key", () => expect(cymruMhrSource.isEnabled()).toBe(true));

  it("reports a known sample with its detection rate", async () => {
    const f = await check([["1767225600 ", "80"]]);
    expect(f).toMatchObject({
      malicious: true,
      score: 80,
      summary: "Known malware in Team Cymru MHR (80% AV detection)",
      details: { detectionRate: 80 },
    });
  });

  it("omits an unparseable detection rate", async () => {
    const f = await check([["1767225600"]]);
    expect(f.summary).toBe("Known malware in Team Cymru MHR");
    expect(f.details).toMatchObject({ detectionRate: undefined });
  });

  it("maps a miss, a timeout and other failures", async () => {
    expect((await check(dnsError("ENOTFOUND"))).summary).toBe("Not in Team Cymru MHR");
    expect((await check(dnsError("ENODATA"))).summary).toBe("Not in Team Cymru MHR");
    expect(await check(dnsError("ETIMEOUT"))).toEqual({ status: "timeout", error: "ETIMEOUT" });
    expect(await check(new Error("odd"))).toEqual({ status: "error", error: "odd" });
    expect(await check("weird")).toEqual({ status: "error", error: "weird" });
  });
});
