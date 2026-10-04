import { afterEach, describe, expect, it, vi } from "vitest";
import { blacklistVerdict, urlhausSource, urlhausVerdict } from "./urlhaus";
import { postForm } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, postForm: vi.fn() };
});


describe("blacklistVerdict", () => {
  it("does not move the score when the host is not listed", () => {
    expect(
      blacklistVerdict({ spamhaus_dbl: "not listed", surbl: "not listed" }),
    ).toEqual({ listed: false, score: 0, categories: [] });
    expect(blacklistVerdict(undefined)).toEqual({
      listed: false,
      score: 0,
      categories: [],
    });
  });

  it("scores + labels a reputable-blocklist listing", () => {
    expect(
      blacklistVerdict({ spamhaus_dbl: "malware_domain", surbl: "listed" }),
    ).toEqual({
      listed: true,
      score: 65,
      categories: ["spamhaus:malware_domain", "surbl:listed"],
    });
  });
});

describe("urlhausVerdict", () => {
  it("treats any live URL as a hard malicious signal", () => {
    expect(urlhausVerdict(2, 5)).toEqual({ score: 70, malicious: true });
    expect(urlhausVerdict(20, 30)).toEqual({ score: 100, malicious: true });
  });

  it("weighs only-historical URLs more softly, malicious at >=5", () => {
    expect(urlhausVerdict(0, 3)).toEqual({ score: 32, malicious: false });
    expect(urlhausVerdict(0, 5)).toEqual({ score: 40, malicious: true });
    expect(urlhausVerdict(0, 100)).toEqual({ score: 70, malicious: true });
  });
});

describe("urlhausSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(postForm).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(postForm).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "");
    expect(urlhausSource.isEnabled()).toBe(false);
    expect(await urlhausSource.check("a.example", signal)).toEqual({ status: "skipped" });
  });

  it("scores online URLs and folds in a blocklist listing", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    expect(urlhausSource.isEnabled()).toBe(true);
    reply({
      query_status: "ok",
      url_count: "2",
      firstseen: "2026-01-01",
      blacklists: { spamhaus_dbl: "malware_domain", surbl: "not listed" },
      urls: [
        { url_status: "online", threat: "malware_download", tags: ["elf"] },
        { url_status: "offline", tags: null },
      ],
    });
    const f = await urlhausSource.check("a.example", signal);
    expect(f).toMatchObject({
      malicious: true,
      score: 65,
      categories: ["malware_download", "elf", "spamhaus:malware_domain"],
      summary: "Hosts 2 malicious URL(s), 1 online; spamhaus:malware_domain",
      lastSeen: "2026-01-01",
    });
  });

  it("counts the URL list when url_count is missing or unusable", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "ok", url_count: "n/a", urls: [{}] });
    expect((await urlhausSource.check("a.example", signal)).summary).toBe(
      "Hosts 1 malicious URL(s)",
    );
    reply({ query_status: "ok" });
    expect((await urlhausSource.check("a.example", signal)).summary).toBe(
      "Hosts 0 malicious URL(s)",
    );
  });

  it("reports no results, or a blocklist listing alone", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "no_results" });
    expect((await urlhausSource.check("a.example", signal)).summary).toBe(
      "No malicious URLs on record",
    );
    reply({ query_status: "no_results", blacklists: { surbl: "listed" } });
    const f = await urlhausSource.check("a.example", signal);
    expect(f).toMatchObject({ malicious: true, summary: "On reputable blocklist: surbl:listed" });
  });

  it("maps errors and timeouts", async () => {
    vi.stubEnv("THREATFOX_API_KEY", "k");
    reply({ query_status: "invalid_host" });
    expect((await urlhausSource.check("a.example", signal)).error).toBe("invalid_host");
    reply(null, 500);
    expect((await urlhausSource.check("a.example", signal)).error).toBe("HTTP 500");
    vi.mocked(postForm).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await urlhausSource.check("a.example", signal)).status).toBe("timeout");
    vi.mocked(postForm).mockRejectedValue(new Error("boom"));
    expect((await urlhausSource.check("a.example", signal)).error).toBe("boom");
  });
});
