import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iocHost, threatFoxDomainSource, threatFoxScore } from "./threatfox";
import { postJson } from "../../http";

describe("iocHost", () => {
  it("pins URL IOCs to their hostname", () => {
    expect(iocHost("https://evil.com/a/b", "url")).toBe("evil.com");
  });

  it("normalizes non-URL IOCs (drops path/port, lowercases, strips trailing dot)", () => {
    expect(iocHost("EVIL.com.", "domain")).toBe("evil.com");
    expect(iocHost("evil.com:8080", "ip:port")).toBe("evil.com");
    expect(iocHost("evil.com/path", "domain")).toBe("evil.com");
  });

  it("returns empty string for missing or unparseable input", () => {
    expect(iocHost(undefined, "domain")).toBe("");
    expect(iocHost("not a url", "url")).toBe("");
  });
});

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
describe("threatFoxDomainSource.check newest sighting", () => {
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
    ioc: "evil.example", ioc_type: "domain",
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
    const finding = await threatFoxDomainSource.check("evil.example", new AbortController().signal);
    expect(finding.status).toBe("ok");
    expect(finding.malicious).toBe(true);
    expect(finding.lastSeen).toBe("2026-08-14 19:38:23 UTC");
  });

  it("leaves lastSeen undefined when no entry carries one", async () => {
    respond([entry()]);
    const finding = await threatFoxDomainSource.check("evil.example", new AbortController().signal);
    expect(finding.lastSeen).toBeUndefined();
  });
});

describe("threatFoxDomainSource.check — remaining paths", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(postJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(postJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "");
    expect(threatFoxDomainSource.isEnabled()).toBe(false);
    expect(await threatFoxDomainSource.check("a.example", signal)).toEqual({ status: "skipped" });
  });

  it("names the malware on an exact-host hit, ignoring other hosts", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    expect(threatFoxDomainSource.isEnabled()).toBe(true);
    reply({
      query_status: "ok",
      data: [
        { ioc: "a.example", ioc_type: "domain", malware: "win.x", malware_printable: "X", threat_type: "botnet_cc", confidence_level: 70, tags: ["t"] },
        { ioc: "a.example:443", ioc_type: "domain", malware: "win.y", tags: null },
        { ioc: "https://sub.a.example/p", ioc_type: "url", malware: "win.z" },
      ],
    });
    const f = await threatFoxDomainSource.check("A.example", signal);
    expect(f).toMatchObject({
      score: 70,
      categories: ["botnet_cc", "X", "win.y", "t"],
      summary: "Linked to X, win.y across 2 IOC(s)",
    });
  });

  it("falls back to a generic malware name", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "ok", data: [{ ioc: "a.example" }] });
    expect((await threatFoxDomainSource.check("a.example", signal)).summary).toBe(
      "Linked to malware across 1 IOC(s)",
    );
  });

  it("reports no hit for no_result and for substring-only matches", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "no_result" });
    expect((await threatFoxDomainSource.check("a.example", signal)).score).toBe(0);
    reply({ query_status: "ok", data: [{ ioc: "b.a.example" }] });
    expect((await threatFoxDomainSource.check("a.example", signal)).summary).toBe(
      "No malware IOCs reference this domain",
    );
  });

  it("maps error bodies, timeouts and errors", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "illegal", data: "Invalid IOC" });
    expect((await threatFoxDomainSource.check("a.example", signal)).error).toBe("Invalid IOC");
    reply({ query_status: "unknown_auth_key" });
    expect((await threatFoxDomainSource.check("a.example", signal)).error).toBe("unknown_auth_key");
    reply(null, 502);
    expect((await threatFoxDomainSource.check("a.example", signal)).error).toBe("HTTP 502");
    vi.mocked(postJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await threatFoxDomainSource.check("a.example", signal)).status).toBe("timeout");
    vi.mocked(postJson).mockRejectedValue(new Error("boom"));
    expect((await threatFoxDomainSource.check("a.example", signal)).error).toBe("boom");
  });
});
