import { describe, expect, it, vi } from "vitest";
import { decode, surblSource } from "./surbl";

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


describe("decode (SURBL bitmask)", () => {
  it("decodes a single-list bit", () => {
    expect(decode("127.0.0.8")).toEqual({ labels: ["phishing"], malicious: true });
    expect(decode("127.0.0.16")).toEqual({ labels: ["malware"], malicious: true });
  });

  it("decodes a combined bitmask", () => {
    // 24 = 8 (phishing) | 16 (malware)
    expect(decode("127.0.0.24")).toEqual({
      labels: ["phishing", "malware"],
      malicious: true,
    });
  });

  it("returns null for the refused sentinel and non-127.0.0.x answers", () => {
    expect(decode("127.0.0.255")).toBeNull();
    expect(decode("127.0.0.0")).toBeNull();
    expect(decode("8.8.8.8")).toBeNull();
  });

  it("labels an unknown but non-zero mask without marking malicious", () => {
    expect(decode("127.0.0.2")).toEqual({
      labels: ["listed (mask 2)"],
      malicious: false,
    });
  });
});

describe("surblSource.check", () => {
  const signal = new AbortController().signal;
  const check = (answer: string[] | Error | string) => {
    dnsAnswer.current = answer;
    return surblSource.check("a.example", signal);
  };

  it("needs no key", () => expect(surblSource.isEnabled()).toBe(true));

  it("maps listings and misses", async () => {
    expect(await check(["127.0.0.24", "127.0.0.8"])).toMatchObject({
      malicious: true,
      score: 65,
      summary: "Listed on SURBL: phishing, malware",
    });
    expect((await check(["127.0.0.255"])).summary).toBe("Not listed");
    expect((await check(dnsError("ENOTFOUND"))).summary).toBe("Not listed");
    expect((await check(dnsError("ENODATA"))).summary).toBe("Not listed");
  });

  it("reports resolver failures, thrown Errors or not", async () => {
    expect(await check(dnsError("ETIMEOUT"))).toEqual({ status: "error", error: "ETIMEOUT" });
    expect(await check("weird")).toEqual({ status: "error", error: "weird" });
  });
});
