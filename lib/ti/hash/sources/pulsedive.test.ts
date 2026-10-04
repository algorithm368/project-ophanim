import { afterEach, describe, expect, it, vi } from "vitest";
import { pdIso, pulsediveSource, riskToScore } from "@/lib/ti/hash/sources/pulsedive";
import { getJson } from "@/lib/ti/http";

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("pdIso", () => {
  it("normalizes a 'YYYY-MM-DD HH:MM:SS' UTC stamp to ISO", () => {
    expect(pdIso("2017-10-18 04:03:08")).toBe("2017-10-18T04:03:08.000Z");
  });

  it("returns undefined for missing or unparseable stamps", () => {
    expect(pdIso(undefined)).toBeUndefined();
    expect(pdIso("")).toBeUndefined();
    expect(pdIso("not a date")).toBeUndefined();
  });
});

describe("riskToScore", () => {
  it("maps Pulsedive risk levels to 0-100", () => {
    expect(riskToScore("critical")).toBe(90);
    expect(riskToScore("high")).toBe(75);
    expect(riskToScore("medium")).toBe(45);
    expect(riskToScore("low")).toBe(20);
    expect(riskToScore("none")).toBe(0);
    expect(riskToScore("unknown")).toBeUndefined();
    expect(riskToScore(undefined)).toBeUndefined();
  });
});

describe("pulsediveSource.check", () => {
  const signal = new AbortController().signal;
  const H = "a".repeat(64);
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("PULSEDIVE_API_KEY", "");
    expect(pulsediveSource.isEnabled()).toBe(false);
    expect(await pulsediveSource.check(H, signal)).toEqual({ status: "skipped" });
  });

  it("maps risk, threats, feeds and sightings", async () => {
    vi.stubEnv("PULSEDIVE_API_KEY", "k");
    expect(pulsediveSource.isEnabled()).toBe(true);
    reply({
      risk: "high",
      threats: [{ name: "Emotet" }, { name: "Emotet" }, {}],
      feeds: [{ name: "Feed A" }, {}],
      stamp_added: "2026-01-01 00:00:00",
      stamp_seen: "2026-01-02 00:00:00",
    });
    const f = await pulsediveSource.check(H, signal);
    expect(f).toMatchObject({
      malicious: true,
      score: 75,
      categories: ["Emotet"],
      summary: "Pulsedive risk: high (Emotet)",
      hashContext: {
        detectionNames: ["Emotet"],
        firstSeen: "2026-01-01T00:00:00.000Z",
        lastSeen: "2026-01-02T00:00:00.000Z",
      },
      details: { feeds: ["Feed A"] },
    });
  });

  it("builds context from either sighting alone, and none from nothing", async () => {
    vi.stubEnv("PULSEDIVE_API_KEY", "k");
    reply({ risk: "critical", stamp_added: "2026-01-01 00:00:00" });
    expect((await pulsediveSource.check(H, signal)).hashContext).toEqual({
      detectionNames: undefined,
      firstSeen: "2026-01-01T00:00:00.000Z",
      lastSeen: undefined,
    });
    reply({ stamp_seen: "2026-01-02 00:00:00", threats: null, feeds: null });
    expect((await pulsediveSource.check(H, signal)).hashContext?.lastSeen).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    reply({});
    const f = await pulsediveSource.check(H, signal);
    expect(f.hashContext).toBeUndefined();
    expect(f.details).toBeUndefined();
    expect(f.summary).toBe("Pulsedive risk: unknown");
    expect(f.malicious).toBe(false);
  });

  it("maps 404, API errors, timeouts and errors", async () => {
    vi.stubEnv("PULSEDIVE_API_KEY", "k");
    reply(null, 404);
    expect((await pulsediveSource.check(H, signal)).summary).toBe("Not indexed by Pulsedive");
    reply({ error: "Invalid API key" });
    expect((await pulsediveSource.check(H, signal)).error).toBe("Invalid API key");
    reply(null, 500);
    expect((await pulsediveSource.check(H, signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await pulsediveSource.check(H, signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await pulsediveSource.check(H, signal)).error).toBe("boom");
  });
});
