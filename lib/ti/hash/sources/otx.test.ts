import { afterEach, describe, expect, it, vi } from "vitest";
import { otxHashScore, otxHashSource } from "./otx";
import { getJson } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("otxHashScore", () => {
  it("is 0 with no pulses, ramps 20 base + 4 per pulse, capped at 60", () => {
    expect(otxHashScore(0)).toBe(0);
    expect(otxHashScore(1)).toBe(24);
    expect(otxHashScore(10)).toBe(60);
    expect(otxHashScore(100)).toBe(60);
  });
});

describe("otxHashSource.check", () => {
  const signal = new AbortController().signal;
  const H = "a".repeat(64);
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("OTX_API_KEY", "");
    expect(otxHashSource.isEnabled()).toBe(false);
    expect(await otxHashSource.check(H, signal)).toEqual({ status: "skipped" });
  });

  it("scores referenced files and lists pulse names and tags", async () => {
    vi.stubEnv("OTX_API_KEY", "k");
    expect(otxHashSource.isEnabled()).toBe(true);
    reply({ pulse_info: { count: 2, pulses: [{ name: "P", tags: ["rat"] }, {}] } });
    expect(await otxHashSource.check(H, signal)).toMatchObject({
      score: 28,
      categories: ["rat"],
      summary: "Referenced in 2 threat pulse(s)",
      details: { pulses: ["P"] },
    });
  });

  it("emits no score for an unreferenced file", async () => {
    vi.stubEnv("OTX_API_KEY", "k");
    reply({});
    expect(await otxHashSource.check(H, signal)).toEqual({
      status: "ok",
      summary: "Not referenced in any threat pulse",
    });
  });

  it("maps errors and timeouts", async () => {
    vi.stubEnv("OTX_API_KEY", "k");
    reply({ error: "bad key" }, 403);
    expect((await otxHashSource.check(H, signal)).error).toBe("bad key");
    reply(null, 500);
    expect((await otxHashSource.check(H, signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await otxHashSource.check(H, signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await otxHashSource.check(H, signal)).error).toBe("boom");
  });
});
