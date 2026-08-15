import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threatFoxScore, threatFoxSource } from "./threatfox";
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
