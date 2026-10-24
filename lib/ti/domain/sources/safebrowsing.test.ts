import { afterEach, describe, expect, it, vi } from "vitest";
import { labelThreats, safeBrowsingSource } from "./safebrowsing";
import { postJson } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, postJson: vi.fn() };
});


describe("labelThreats", () => {
  it("maps Safe Browsing threat types to human labels", () => {
    expect(
      labelThreats([
        { threatType: "MALWARE" },
        { threatType: "SOCIAL_ENGINEERING" },
      ]),
    ).toEqual(["malware", "phishing"]);
  });

  it("dedupes repeated threat types", () => {
    expect(labelThreats([{ threatType: "MALWARE" }, { threatType: "MALWARE" }])).toEqual(
      ["malware"],
    );
  });

  it("passes through unknown types and falls back to 'threat'", () => {
    expect(labelThreats([{ threatType: "NEW_KIND" }])).toEqual(["NEW_KIND"]);
    expect(labelThreats([{}])).toEqual(["threat"]);
  });
});

describe("safeBrowsingSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(postJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(postJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "");
    expect(safeBrowsingSource.isEnabled()).toBe(false);
    expect(await safeBrowsingSource.check("a.example", signal)).toEqual({ status: "skipped" });
  });

  it("flags a listed indicator", async () => {
    vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "k");
    expect(safeBrowsingSource.isEnabled()).toBe(true);
    reply({ matches: [{ threatType: "SOCIAL_ENGINEERING" }] });
    const f = await safeBrowsingSource.check("a.example", signal);
    expect(f).toMatchObject({ malicious: true, score: 90, summary: "Flagged by Google for phishing" });
  });

  it("reports a clean indicator from an empty body", async () => {
    vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "k");
    reply({});
    expect((await safeBrowsingSource.check("a.example", signal)).score).toBe(0);
    reply(null);
    expect((await safeBrowsingSource.check("a.example", signal)).summary).toBe(
      "Not on any Safe Browsing list",
    );
  });

  it("maps errors and timeouts", async () => {
    vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "k");
    reply({ error: { message: "API key not valid" } }, 400);
    expect((await safeBrowsingSource.check("a.example", signal)).error).toBe("API key not valid");
    reply(null, 500);
    expect((await safeBrowsingSource.check("a.example", signal)).error).toBe("HTTP 500");
    vi.mocked(postJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await safeBrowsingSource.check("a.example", signal)).status).toBe("timeout");
    vi.mocked(postJson).mockRejectedValue(new Error("boom"));
    expect((await safeBrowsingSource.check("a.example", signal)).error).toBe("boom");
  });
});
