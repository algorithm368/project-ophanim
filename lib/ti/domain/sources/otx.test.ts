import { afterEach, describe, expect, it, vi } from "vitest";
import { otxDomainScore, otxDomainSource } from "./otx";
import { getJson } from "../../http";
import { fetchOtxMalwareRelations } from "../../otx-malware";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, getJson: vi.fn() };
});

vi.mock("../../otx-malware", () => ({ fetchOtxMalwareRelations: vi.fn(async () => []) }));

describe("otxDomainScore", () => {
  it("is a low, capped nudge (2 per pulse, max 35)", () => {
    expect(otxDomainScore(0)).toBe(0);
    expect(otxDomainScore(1)).toBe(2);
    expect(otxDomainScore(10)).toBe(20);
    expect(otxDomainScore(100)).toBe(35);
  });
});

describe("otxDomainSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
    vi.mocked(fetchOtxMalwareRelations).mockResolvedValue([]);
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("OTX_API_KEY", "");
    expect(otxDomainSource.isEnabled()).toBe(false);
    expect(await otxDomainSource.check("a.example", signal)).toEqual({ status: "skipped" });
  });

  it("collects pulses, tags and malware relations", async () => {
    vi.stubEnv("OTX_API_KEY", "k");
    expect(otxDomainSource.isEnabled()).toBe(true);
    vi.mocked(fetchOtxMalwareRelations).mockResolvedValue([
      { value: "a".repeat(64), type: "hash", relation: "malware" },
    ]);
    reply({ pulse_info: { count: 3, pulses: [{ name: "P", tags: ["phish"] }, {}] } });
    const f = await otxDomainSource.check("a.example", signal);
    expect(f).toMatchObject({
      score: 6,
      categories: ["phish"],
      summary: "Referenced in 3 threat pulse(s)",
      details: { pulses: ["P"] },
    });
    expect(f.relations).toHaveLength(1);
  });

  it("reports an unreferenced domain", async () => {
    vi.stubEnv("OTX_API_KEY", "k");
    reply({});
    const f = await otxDomainSource.check("a.example", signal);
    expect(f.summary).toBe("Not referenced in any threat pulse");
    expect(f.relations).toBeUndefined();
  });

  it("maps errors and timeouts", async () => {
    vi.stubEnv("OTX_API_KEY", "k");
    reply({ error: "bad key" }, 403);
    expect((await otxDomainSource.check("a.example", signal)).error).toBe("bad key");
    reply(null, 500);
    expect((await otxDomainSource.check("a.example", signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await otxDomainSource.check("a.example", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await otxDomainSource.check("a.example", signal)).error).toBe("boom");
  });
});
