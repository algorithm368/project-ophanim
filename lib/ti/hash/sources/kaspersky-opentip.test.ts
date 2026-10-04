import { afterEach, describe, expect, it, vi } from "vitest";
import { kasperskyOpenTipSource, zoneToScore } from "@/lib/ti/hash/sources/kaspersky-opentip";
import { getJson } from "@/lib/ti/http";

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("zoneToScore", () => {
  it("maps Kaspersky zones to score + malicious", () => {
    expect(zoneToScore("Red")).toEqual({ score: 90, malicious: true });
    expect(zoneToScore("Yellow")).toEqual({ score: 45, malicious: false });
    expect(zoneToScore("Green")).toEqual({ score: 0, malicious: false });
    // Grey = unknown: no score, not clean.
    expect(zoneToScore("Grey")).toEqual({ score: undefined, malicious: false });
    expect(zoneToScore(undefined)).toEqual({
      score: undefined,
      malicious: false,
    });
  });
});

describe("kasperskyOpenTipSource.check", () => {
  const signal = new AbortController().signal;
  const H = "a".repeat(64);
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("KASPERSKY_OPENTIP_API_KEY", "");
    expect(kasperskyOpenTipSource.isEnabled()).toBe(false);
    expect(await kasperskyOpenTipSource.check(H, signal)).toEqual({ status: "skipped" });
  });

  it("maps a red zone with detections and file info", async () => {
    vi.stubEnv("KASPERSKY_OPENTIP_API_KEY", "k");
    expect(kasperskyOpenTipSource.isEnabled()).toBe(true);
    reply({
      Zone: "Red",
      DetectionsInfo: [{ DetectionName: "Trojan.Win32.X" }, {}],
      FileGeneralInfo: { Md5: "AB", Sha1: "CD", Sha256: "EF", Type: "PE", Signer: "Acme" },
    });
    expect(await kasperskyOpenTipSource.check(H, signal)).toMatchObject({
      malicious: true,
      score: 90,
      summary: "Kaspersky zone: Red, Trojan.Win32.X",
      hashContext: { md5: "ab", sha1: "cd", sha256: "ef", detectionNames: ["Trojan.Win32.X"] },
      details: { signer: "Acme" },
    });
  });

  it("handles an answer with no zone, detections or file info", async () => {
    vi.stubEnv("KASPERSKY_OPENTIP_API_KEY", "k");
    reply({ DetectionsInfo: null });
    const f = await kasperskyOpenTipSource.check(H, signal);
    expect(f.summary).toBe("Kaspersky zone: Unknown");
    expect(f.hashContext).toMatchObject({ md5: undefined, detectionNames: undefined });
    reply({ Zone: "Green", FileGeneralInfo: {} });
    expect((await kasperskyOpenTipSource.check(H, signal)).hashContext?.sha256).toBeUndefined();
  });

  it("maps 404, failures and timeouts", async () => {
    vi.stubEnv("KASPERSKY_OPENTIP_API_KEY", "k");
    reply(null, 404);
    expect((await kasperskyOpenTipSource.check(H, signal)).summary).toBe(
      "Not found in Kaspersky OpenTIP",
    );
    reply(null, 500);
    expect((await kasperskyOpenTipSource.check(H, signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await kasperskyOpenTipSource.check(H, signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await kasperskyOpenTipSource.check(H, signal)).error).toBe("boom");
  });
});
