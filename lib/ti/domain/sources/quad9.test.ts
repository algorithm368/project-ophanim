import { describe, expect, it, vi } from "vitest";
import { quad9Source, quad9Verdict } from "./quad9";

// Answers keyed by the first server the resolver was pointed at.
const answers = vi.hoisted(() => new Map<string, string[] | Error>());

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    private server = "";
    setServers(servers: string[]) {
      this.server = servers[0];
    }
    async resolve4(): Promise<string[]> {
      const a = answers.get(this.server) ?? [];
      if (Array.isArray(a)) return a;
      throw a;
    }
  },
}));

const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe("quad9Verdict", () => {
  it("flags a domain Quad9 blocks but the control resolves", () => {
    expect(quad9Verdict("nxdomain", "resolves")).toMatchObject({
      status: "ok",
      malicious: true,
      score: 80,
      categories: ["dns-blocked"],
      details: { quad9: "nxdomain", control: "resolves" },
    });
  });

  it("errors only when both resolvers fail", () => {
    expect(quad9Verdict("error", "error").status).toBe("error");
  });

  it("is inconclusive when the control resolver can't resolve the domain", () => {
    const v = quad9Verdict("resolves", "nxdomain");
    expect(v.status).toBe("ok");
    expect(v.score).toBe(0);
    expect(v.malicious).toBeUndefined();
  });

  it("is clean when both resolvers answer", () => {
    const v = quad9Verdict("resolves", "resolves");
    expect(v.status).toBe("ok");
    expect(v.score).toBe(0);
    expect(v.malicious).toBeUndefined();
  });
});

describe("quad9Source.check", () => {
  const signal = new AbortController().signal;
  const run = (quad9: string[] | Error, control: string[] | Error) => {
    answers.set("9.9.9.9", quad9);
    answers.set("1.1.1.1", control);
    return quad9Source.check("a.example", signal);
  };

  it("needs no key", () => expect(quad9Source.isEnabled()).toBe(true));

  it("calls a domain blocked when only Quad9 withholds it", async () => {
    expect((await run(dnsError("ENOTFOUND"), ["1.2.3.4"])).malicious).toBe(true);
    expect((await run([], ["1.2.3.4"])).malicious).toBe(true);
  });

  it("is inconclusive or errors when the control cannot answer", async () => {
    expect((await run(dnsError("ENODATA"), dnsError("ENODATA"))).summary).toMatch(/^Inconclusive/);
    expect((await run(dnsError("ESERVFAIL"), dnsError("ETIMEOUT"))).status).toBe("error");
  });
});
