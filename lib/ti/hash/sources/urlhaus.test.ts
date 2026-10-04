import { afterEach, describe, expect, it, vi } from "vitest";
import { toNumber, urlhausHashSource } from "./urlhaus";
import { postForm } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, postForm: vi.fn() };
});


describe("toNumber", () => {
  it("coerces numeric strings and passes through numbers", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber("42")).toBe(42);
  });

  it("returns undefined for absent or non-numeric values", () => {
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber("not-a-number")).toBeUndefined();
  });
});

describe("urlhausHashSource.check", () => {
  const signal = new AbortController().signal;
  const SHA256 = "a".repeat(64);
  const reply = (data: unknown, status = 200) =>
    vi.mocked(postForm).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(postForm).mockReset();
  });

  it("is skipped without a key, and for SHA-1", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "");
    expect(urlhausHashSource.isEnabled()).toBe(false);
    expect(await urlhausHashSource.check(SHA256, signal)).toEqual({ status: "skipped" });
    vi.stubEnv("THREATFOX_API_KEY", "k");
    expect(urlhausHashSource.isEnabled()).toBe(true);
    expect((await urlhausHashSource.check("a".repeat(40), signal)).status).toBe("skipped");
  });

  it("identifies a payload and its distribution hosts", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({
      query_status: "ok",
      sha256_hash: SHA256,
      file_type: "exe",
      file_size: "1024",
      signature: " AgentTesla ",
      firstseen: "2026-01-01",
      lastseen: "2026-01-02",
      url_count: "3",
      urls: [
        { url: "http://a.example/x.exe", url_status: "online" },
        { url: "http://a.example/y.exe", url_status: "offline" },
        { url: "not a url" },
        {},
      ],
    });
    const f = await urlhausHashSource.check(SHA256, signal);
    expect(vi.mocked(postForm).mock.calls[0][2]).toEqual({ sha256_hash: SHA256 });
    expect(f).toMatchObject({
      categories: ["AgentTesla", "malware-download"],
      lastSeen: "2026-01-02",
      summary: "Malware payload (AgentTesla) distributed via 3 URL(s), 1 still online",
      hashContext: { fileSize: 1024, malwareFamily: "AgentTesla", firstSeen: "2026-01-01" },
    });
    expect(f.relations).toEqual([
      expect.objectContaining({ value: "a.example", relation: "distribution" }),
    ]);
  });

  it("describes a sparse hit without a family or URLs", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "ok", signature: null, firstseen: null, lastseen: null });
    const f = await urlhausHashSource.check("a".repeat(32), signal);
    expect(vi.mocked(postForm).mock.calls[0][2]).toEqual({ md5_hash: "a".repeat(32) });
    expect(f.summary).toBe("Malware payload distributed via 0 URL(s)");
    expect(f.categories).toEqual(["malware-download"]);
    expect(f.relations).toBeUndefined();
    expect(f.hashContext?.distributionUrls).toBeUndefined();
    reply({ query_status: "ok", urls: [{ url: "http://b.example/" }] });
    expect((await urlhausHashSource.check(SHA256, signal)).summary).toBe(
      "Malware payload distributed via 1 URL(s)",
    );
  });

  it("maps no_results, errors and timeouts", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "no_results" });
    expect((await urlhausHashSource.check(SHA256, signal)).summary).toBe(
      "Not seen in URLhaus payloads",
    );
    reply({ query_status: "invalid_sha256_hash" });
    expect((await urlhausHashSource.check(SHA256, signal)).error).toBe("invalid_sha256_hash");
    reply(null, 500);
    expect((await urlhausHashSource.check(SHA256, signal)).error).toBe("HTTP 500");
    vi.mocked(postForm).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await urlhausHashSource.check(SHA256, signal)).status).toBe("timeout");
    vi.mocked(postForm).mockRejectedValue(new Error("boom"));
    expect((await urlhausHashSource.check(SHA256, signal)).error).toBe("boom");
  });
});
