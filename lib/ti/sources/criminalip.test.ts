import { afterEach, describe, expect, it, vi } from "vitest";
import { LEVEL, criminalIpScore, criminalIpSource } from "./criminalip";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("criminalIpScore", () => {
  it("takes the stronger of the inbound/outbound bands", () => {
    expect(criminalIpScore("safe", "critical")).toBe(90);
    expect(criminalIpScore("moderate", "low")).toBe(40);
  });

  it("is case-insensitive and treats unknown bands as 0", () => {
    expect(criminalIpScore("DANGEROUS", undefined)).toBe(70);
    expect(criminalIpScore("???", "")).toBe(0);
  });

  it("exposes the band table", () => {
    expect(LEVEL.critical).toBe(90);
    expect(LEVEL.safe).toBe(0);
  });
});

describe("criminalIpSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("CRIMINALIP_API_KEY", "");
    expect(criminalIpSource.isEnabled()).toBe(false);
    expect(await criminalIpSource.check("1.2.3.4", signal)).toEqual({ status: "skipped" });
  });

  it("scores the stronger band and counts open ports", async () => {
    vi.stubEnv("CRIMINALIP_API_KEY", "k");
    expect(criminalIpSource.isEnabled()).toBe(true);
    reply({
      ip_scoring: { inbound: "Dangerous", outbound: "Safe" },
      issue: ["is_scanner"],
      tags: ["vpn"],
      current_open_ports: { TCP: [{ port: 22 }], UDP: [{ port: 53 }] },
    });
    const f = await criminalIpSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({
      malicious: true,
      score: 70,
      categories: ["is_scanner", "vpn"],
      summary: "Inbound risk Dangerous, outbound Safe · 2 open port(s)",
      details: { openPorts: 2, issues: ["is_scanner"] },
    });
  });

  it("honors the provider's malicious flag on a sparse answer", async () => {
    vi.stubEnv("CRIMINALIP_API_KEY", "k");
    reply({ ip_scoring: { is_malicious: true } });
    const f = await criminalIpSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({ malicious: true, score: 0, summary: "Inbound risk ?, outbound ?" });
    reply({ ip_scoring: { current_open_ports: {} }, current_open_ports: {} });
    expect((await criminalIpSource.check("1.2.3.4", signal)).malicious).toBe(false);
  });

  it("treats a spent quota as rate limited", async () => {
    vi.stubEnv("CRIMINALIP_API_KEY", "k");
    reply({ message: "limit exceeded" });
    expect(await criminalIpSource.check("1.2.3.4", signal)).toEqual({
      status: "rate_limited",
      summary: "limit exceeded",
    });
    reply(null, 429);
    expect((await criminalIpSource.check("1.2.3.4", signal)).summary).toBe("Daily quota exceeded");
  });

  it("maps errors", async () => {
    vi.stubEnv("CRIMINALIP_API_KEY", "k");
    reply({ message: "invalid key" }, 401);
    expect((await criminalIpSource.check("1.2.3.4", signal)).error).toBe("invalid key");
    reply(null, 500);
    expect((await criminalIpSource.check("1.2.3.4", signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await criminalIpSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await criminalIpSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
