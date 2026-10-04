import { afterEach, describe, expect, it, vi } from "vitest";
import { dnsblScore, dnsblSource, isBlockedCode } from "./dnsbl";

describe("isBlockedCode", () => {
  it("recognizes the 127.255.255.x rate-limit sentinel", () => {
    expect(isBlockedCode("127.255.255.254")).toBe(true);
    expect(isBlockedCode("127.0.0.2")).toBe(false);
  });
});

describe("dnsblScore", () => {
  it("is 0 when unlisted and ramps with multi-zone consensus", () => {
    expect(dnsblScore(0)).toBe(0);
    expect(dnsblScore(1)).toBe(20);
    expect(dnsblScore(2)).toBe(38);
  });

  it("caps at 90", () => {
    expect(dnsblScore(10)).toBe(90);
  });
});

const zoneAnswers = vi.hoisted(() => new Map<string, string[] | { code?: string }>());

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    async resolve4(name: string): Promise<string[]> {
      const zone = [...zoneAnswers.keys()].find((z) => name.endsWith(z));
      const answer = zone ? zoneAnswers.get(zone) : { code: "ENOTFOUND" };
      if (Array.isArray(answer)) return answer;
      throw Object.assign(new Error("dns"), answer);
    }
  },
}));

describe("dnsblSource.check", () => {
  afterEach(() => zoneAnswers.clear());

  it("needs no key", () => expect(dnsblSource.isEnabled()).toBe(true));

  it("separates listed, clean, blocked and errored zones", async () => {
    zoneAnswers.set("zen.spamhaus.org", ["127.0.0.2", "127.255.255.254"]);
    zoneAnswers.set("bl.spamcop.net", []);
    zoneAnswers.set("b.barracudacentral.org", ["127.255.255.252"]);
    zoneAnswers.set("dnsbl.dronebl.org", { code: "ESERVFAIL" });
    zoneAnswers.set("dnsbl-1.uceprotect.net", { code: "ENODATA" });
    const f = await dnsblSource.check("1.2.3.4", new AbortController().signal);
    expect(f.status).toBe("ok");
    expect(f.malicious).toBe(false);
    expect(f.score).toBe(20);
    expect(f.summary).toBe("Listed on 1 blocklist(s): Spamhaus ZEN");
    expect(f.details).toMatchObject({
      listedOn: ["Spamhaus ZEN (127.0.0.2)"],
      checked: 4,
      blocked: ["Barracuda"],
      errored: ["DroneBL"],
    });
  });

  it("calls three zones a hard listing", async () => {
    for (const z of ["zen.spamhaus.org", "bl.spamcop.net", "all.s5h.net"]) {
      zoneAnswers.set(z, ["127.0.0.2"]);
    }
    const f = await dnsblSource.check("1.2.3.4", new AbortController().signal);
    expect(f.malicious).toBe(true);
  });

  it("reports clean when nothing lists it", async () => {
    const f = await dnsblSource.check("1.2.3.4", new AbortController().signal);
    expect(f.summary).toBe("Not listed on 6 blocklist(s)");
    expect(f.error).toBeUndefined();
  });

  it("errors when no zone could be queried", async () => {
    for (const z of [
      "zen.spamhaus.org",
      "bl.spamcop.net",
      "b.barracudacentral.org",
      "dnsbl.dronebl.org",
      "dnsbl-1.uceprotect.net",
      "all.s5h.net",
    ]) {
      zoneAnswers.set(z, { code: "ETIMEOUT" });
    }
    const f = await dnsblSource.check("1.2.3.4", new AbortController().signal);
    expect(f.status).toBe("error");
    expect(f.error).toBe("No blocklist could be queried");
    expect(f.summary).toBe("All blocklist queries were blocked or failed");
  });
});
