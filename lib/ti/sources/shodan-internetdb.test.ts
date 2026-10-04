import { afterEach, describe, expect, it, vi } from "vitest";
import { exposureScore, maliciousTags, shodanInternetDbSource } from "./shodan-internetdb";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("maliciousTags", () => {
  it("keeps only known-bad tags, case-insensitively", () => {
    expect(maliciousTags(["self-signed", "C2", "Malware", "cdn"])).toEqual([
      "C2",
      "Malware",
    ]);
  });

  it("returns nothing for an all-benign tag set", () => {
    expect(maliciousTags(["cloud", "cdn"])).toEqual([]);
  });
});

describe("exposureScore", () => {
  it("scores CVEs on a ramp capped at 50", () => {
    expect(exposureScore(0, false)).toBe(0);
    expect(exposureScore(1, false)).toBe(15);
    expect(exposureScore(20, false)).toBe(50);
  });

  it("adds 50 for malicious tags and caps the total at 100", () => {
    expect(exposureScore(0, true)).toBe(50);
    expect(exposureScore(20, true)).toBe(100);
  });
});

describe("shodanInternetDbSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => vi.mocked(getJson).mockReset());

  it("needs no key", () => expect(shodanInternetDbSource.isEnabled()).toBe(true));

  it("summarizes ports, CVEs and malicious tags", async () => {
    reply({
      ip: "1.2.3.4",
      ports: [22, 80],
      vulns: ["CVE-2024-1"],
      tags: ["c2", "cloud"],
      hostnames: ["h.test"],
      cpes: ["cpe:/a:x"],
    });
    const f = await shodanInternetDbSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({
      malicious: true,
      score: 65,
      categories: ["c2", "cloud"],
      summary: "2 open port(s) · 1 known CVE(s) · tags: c2",
      details: { hostnames: ["h.test"], cpes: ["cpe:/a:x"] },
    });
  });

  it("calls an indexed host with nothing notable quiet", async () => {
    reply({ ip: "1.2.3.4" });
    const f = await shodanInternetDbSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({ malicious: false, score: 0, summary: "Indexed, no notable exposure" });
  });

  it("treats 404 as not indexed and other failures as errors", async () => {
    reply(null, 404);
    expect((await shodanInternetDbSource.check("1.2.3.4", signal)).summary).toBe(
      "No exposure data indexed for this host",
    );
    reply(null, 500);
    expect((await shodanInternetDbSource.check("1.2.3.4", signal)).error).toBe("HTTP 500");
    reply(null, 200);
    expect((await shodanInternetDbSource.check("1.2.3.4", signal)).error).toBe("HTTP 200");
  });

  it("maps timeouts and errors", async () => {
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await shodanInternetDbSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await shodanInternetDbSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
