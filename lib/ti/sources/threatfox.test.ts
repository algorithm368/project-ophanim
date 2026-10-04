import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threatFoxScore, threatFoxSource, threatFoxWindow } from "./threatfox";
import { postJson } from "../http";

describe("threatFoxScore", () => {
  it("floors any IOC hit at 60 and caps at 100", () => {
    expect(threatFoxScore(0)).toBe(60);
    expect(threatFoxScore(50)).toBe(60);
    expect(threatFoxScore(75)).toBe(75);
    expect(threatFoxScore(100)).toBe(100);
    expect(threatFoxScore(150)).toBe(100);
  });
});

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, postJson: vi.fn() };
});

// lastSeen picks the newest sighting by sorting the timestamps and taking the
// last. That only holds because ThreatFox's format sorts chronologically by
// code unit, which is what the shared comparator promises, so the case worth
// pinning is entries arriving out of order with a blank one mixed in.
describe("threatFoxSource.check newest sighting", () => {
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
    ioc: "203.0.113.9:443", ioc_type: "ip:port",
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
    const finding = await threatFoxSource.check("203.0.113.9", new AbortController().signal);
    expect(finding.status).toBe("ok");
    expect(finding.malicious).toBe(true);
    expect(finding.lastSeen).toBe("2026-08-14 19:38:23 UTC");
  });

  it("leaves lastSeen undefined when no entry carries one", async () => {
    respond([entry()]);
    const finding = await threatFoxSource.check("203.0.113.9", new AbortController().signal);
    expect(finding.lastSeen).toBeUndefined();
  });
});

describe("threatFoxWindow", () => {
  it("takes the earliest first_seen and the latest last_seen, skipping blanks", () => {
    expect(
      threatFoxWindow([
        { first_seen: "2025-03-01 10:00:00 UTC", last_seen: "2026-08-14 19:38:23 UTC" },
        { first_seen: "", last_seen: "2026-03-04 09:00:00 UTC" },
        { first_seen: "2025-01-19 08:00:00 UTC" },
      ]),
    ).toEqual({ firstSeen: "2025-01-19 08:00:00 UTC", lastSeen: "2026-08-14 19:38:23 UTC" });
  });

  it("answers undefined for both when no entry is dated", () => {
    expect(threatFoxWindow([{}, { first_seen: "" }])).toEqual({
      firstSeen: undefined,
      lastSeen: undefined,
    });
  });
});

describe("threatFoxSource.check — remaining paths", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(postJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(postJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "");
    expect(threatFoxSource.isEnabled()).toBe(false);
    expect(await threatFoxSource.check("1.2.3.4", signal)).toEqual({ status: "skipped" });
  });

  it("names the malware, types and tags of a hit", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    expect(threatFoxSource.isEnabled()).toBe(true);
    reply({
      query_status: "ok",
      data: [
        { malware: "win.cobalt", malware_printable: "Cobalt Strike", threat_type: "botnet_cc", confidence_level: 90, tags: ["cs"] },
        { malware: "win.qakbot", tags: null },
      ],
    });
    const f = await threatFoxSource.check("1.2.3.4", signal);
    expect(f.summary).toBe("Linked to Cobalt Strike, win.qakbot across 2 IOC(s)");
    expect(f.categories).toEqual(["botnet_cc", "Cobalt Strike", "win.qakbot", "cs"]);
    expect(f.score).toBe(90);
  });

  it("falls back to a generic malware name", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "ok", data: [{}] });
    expect((await threatFoxSource.check("1.2.3.4", signal)).summary).toBe(
      "Linked to malware across 1 IOC(s)",
    );
  });

  it("maps no_result, error bodies, timeouts and errors", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "no_result" });
    expect((await threatFoxSource.check("1.2.3.4", signal)).score).toBe(0);
    reply({ query_status: "illegal_search_term", data: "Invalid IOC" });
    expect((await threatFoxSource.check("1.2.3.4", signal)).error).toBe("Invalid IOC");
    reply({ query_status: "unknown_auth_key" });
    expect((await threatFoxSource.check("1.2.3.4", signal)).error).toBe("unknown_auth_key");
    reply(null, 502);
    expect((await threatFoxSource.check("1.2.3.4", signal)).error).toBe("HTTP 502");
    vi.mocked(postJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await threatFoxSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(postJson).mockRejectedValue(new Error("boom"));
    expect((await threatFoxSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
