import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threatFoxHashSource, threatFoxScore } from "./threatfox";
import { postJson } from "../../http";

describe("threatFoxScore", () => {
  it("floors any hit at 60 and caps at 100", () => {
    expect(threatFoxScore(0)).toBe(60);
    expect(threatFoxScore(80)).toBe(80);
    expect(threatFoxScore(150)).toBe(100);
  });
});

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, postJson: vi.fn() };
});

// lastSeen picks the newest sighting by sorting the timestamps and taking the
// last. That only holds because ThreatFox's format sorts chronologically by
// code unit, which is what the shared comparator promises, so the case worth
// pinning is entries arriving out of order with a blank one mixed in.
describe("threatFoxHashSource.check newest sighting", () => {
  const mockPostJson = vi.mocked(postJson);
  // Key-gated source: without the env var check() returns { status: "skipped" }
  // before it ever reaches the request.
  const originalKey = process.env.THREATFOX_API_KEY;
  beforeEach(() => {
    process.env.THREATFOX_API_KEY = "test-key";
  });
  afterEach(() => {
    mockPostJson.mockReset();
    if (originalKey === undefined) delete process.env.THREATFOX_API_KEY;
    else process.env.THREATFOX_API_KEY = originalKey;
  });

  const entry = (last_seen?: string) => ({
    ioc_type: "sha256_hash",
    confidence_level: 75,
    malware_printable: "Emotet",
    threat_type: "botnet_cc",
    ...(last_seen === undefined ? {} : { last_seen }),
  });

  const respond = (entries: unknown[]) =>
    mockPostJson.mockResolvedValue({
      ok: true,
      status: 200,
      data: { query_status: "ok", data: entries },
    } as Awaited<ReturnType<typeof postJson>>);

  it("takes the newest last_seen regardless of entry order", async () => {
    respond([
      entry("2026-03-04 09:00:00 UTC"),
      entry("2026-08-14 19:38:23 UTC"),
      entry(""),
    ]);
    const finding = await threatFoxHashSource.check("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new AbortController().signal);
    expect(finding.status).toBe("ok");
    expect(finding.malicious).toBe(true);
    expect(finding.lastSeen).toBe("2026-08-14 19:38:23 UTC");
  });

  it("leaves lastSeen undefined when no entry carries one", async () => {
    respond([entry()]);
    const finding = await threatFoxHashSource.check("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new AbortController().signal);
    expect(finding.lastSeen).toBeUndefined();
  });
});

describe("threatFoxHashSource.check — remaining paths", () => {
  const signal = new AbortController().signal;
  const H = "a".repeat(64);
  const reply = (data: unknown, status = 200) =>
    vi.mocked(postJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(postJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "");
    expect(threatFoxHashSource.isEnabled()).toBe(false);
    expect(await threatFoxHashSource.check(H, signal)).toEqual({ status: "skipped" });
  });

  it("names malware, types and tags", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    expect(threatFoxHashSource.isEnabled()).toBe(true);
    reply({
      query_status: "ok",
      data: [
        { malware: "win.x", malware_printable: "X", threat_type: "payload", confidence_level: 80, tags: ["t"] },
        { malware: "win.y", tags: null },
      ],
    });
    expect(await threatFoxHashSource.check(H, signal)).toMatchObject({
      score: 80,
      categories: ["payload", "X", "win.y", "t"],
      summary: "Linked to X, win.y across 2 IOC(s)",
      hashContext: { malwareFamily: "X", tags: ["t"] },
    });
  });

  it("falls back to a generic malware name with no tags", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "ok", data: [{}] });
    const f = await threatFoxHashSource.check(H, signal);
    expect(f.summary).toBe("Linked to malware across 1 IOC(s)");
    expect(f.hashContext?.tags).toBeUndefined();
  });

  it("treats no_result and illegal_hash as no data, and maps errors", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    for (const query_status of ["no_result", "illegal_hash"]) {
      reply({ query_status });
      expect((await threatFoxHashSource.check(H, signal)).summary).toBe(
        "No malware IOCs reference this hash",
      );
    }
    reply({ query_status: "x", data: "Bad request" });
    expect((await threatFoxHashSource.check(H, signal)).error).toBe("Bad request");
    reply({ query_status: "unknown_auth_key" });
    expect((await threatFoxHashSource.check(H, signal)).error).toBe("unknown_auth_key");
    reply(null, 502);
    expect((await threatFoxHashSource.check(H, signal)).error).toBe("HTTP 502");
    vi.mocked(postJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await threatFoxHashSource.check(H, signal)).status).toBe("timeout");
    vi.mocked(postJson).mockRejectedValue(new Error("boom"));
    expect((await threatFoxHashSource.check(H, signal)).error).toBe("boom");
  });
});
