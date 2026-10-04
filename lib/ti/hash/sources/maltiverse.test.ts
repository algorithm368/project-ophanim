import { afterEach, describe, expect, it, vi } from "vitest";
import { classificationScore, maltiverseSource } from "./maltiverse";
import * as http from "../../http";

describe("classificationScore", () => {
  it("scores known classifications", () => {
    expect(classificationScore("malicious")).toEqual({
      score: 85,
      malicious: true,
      allowlisted: false,
    });
    expect(classificationScore("suspicious")).toEqual({
      score: 50,
      malicious: false,
      allowlisted: false,
    });
    expect(classificationScore("whitelist")).toEqual({
      score: 0,
      malicious: false,
      allowlisted: true,
    });
  });

  it("returns undefined score for neutral/unknown (absence is not clean)", () => {
    expect(classificationScore("neutral")).toEqual({
      score: undefined,
      malicious: false,
      allowlisted: false,
    });
    expect(classificationScore(undefined)).toEqual({
      score: undefined,
      malicious: false,
      allowlisted: false,
    });
  });
});

describe("maltiverseSource", () => {
  it("emits fileNames when filename is an array", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        classification: "malicious",
        filename: ["a.exe", "b.exe"],
      },
    } as never);
    const finding = await maltiverseSource.check("a".repeat(64), new AbortController().signal);
    expect(finding.hashContext?.fileNames).toEqual(["a.exe", "b.exe"]);
  });
  // blacklist[].description is sometimes one label and sometimes a comma-joined
  // set, so both shapes have to split into distinct chips rather than one
  // run-on string.
  it("splits comma-joined blacklist descriptions into distinct labels", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        classification: "malicious",
        blacklist: [
          { description: "ransomware,wcry" },
          { description: "wcry" },
          { description: "" },
        ],
      },
    } as never);
    const finding = await maltiverseSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(finding.hashContext?.detectionNames).toEqual(["ransomware", "wcry"]);
  });

  it("turns contacted hosts into typed, deduped pivots", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        classification: "malicious",
        contacted_host: ["evil.com", "evil.com", "8.8.8.8", "", 42],
      },
    } as never);
    const finding = await maltiverseSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(finding.relations).toEqual([
      {
        value: "evil.com",
        type: "domain",
        relation: "contacts",
        sources: ["maltiverse"],
        tier: "observed",
      },
      {
        value: "8.8.8.8",
        type: "ip",
        relation: "contacts",
        sources: ["maltiverse"],
        tier: "observed",
      },
    ]);
  });

  it("caps contacted-host pivots at ten", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        classification: "malicious",
        contacted_host: Array.from({ length: 25 }, (_, i) => `h${i}.example.com`),
      },
    } as never);
    const finding = await maltiverseSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(finding.relations).toHaveLength(10);
  });

  it("reads a single filename string as a one-entry list", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: { classification: "malicious", filename: "only.exe" },
    } as never);
    const finding = await maltiverseSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(finding.hashContext?.fileNames).toEqual(["only.exe"]);
  });
});

describe("maltiverseSource — remaining paths", () => {
  const signal = new AbortController().signal;
  const H = "a".repeat(64);
  const reply = (data: unknown, status = 200) =>
    vi.spyOn(http, "getJson").mockResolvedValue({ ok: status < 400, status, data, text: "" } as never);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("needs no key, but sends one when configured", async () => {
    expect(maltiverseSource.isEnabled()).toBe(true);
    vi.stubEnv("MALTIVERSE_API_KEY", "k");
    const spy = reply({ classification: "malicious", tag: ["rat", "", "rat"], blacklist: [{}] });
    const f = await maltiverseSource.check(H, signal);
    expect(spy.mock.calls[0][2]).toEqual({ Authorization: "Bearer k" });
    expect(f.hashContext?.tags).toEqual(["rat"]);
    expect(f.details).toEqual({ tags: ["rat"] });
    expect(f.categories).toEqual([]);
  });

  it("leaves optional parts out of a bare answer", async () => {
    vi.stubEnv("MALTIVERSE_API_KEY", "");
    const spy = reply({});
    const f = await maltiverseSource.check(H, signal);
    expect(spy.mock.calls[0][2]).toEqual({});
    expect(f.summary).toBe("Maltiverse classification: unknown");
    expect(f.details).toBeUndefined();
    expect(f.relations).toBeUndefined();
    expect(f.hashContext).toMatchObject({ fileNames: undefined, detectionNames: undefined });
  });

  it("maps 404, error bodies, timeouts and errors", async () => {
    reply(null, 404);
    expect((await maltiverseSource.check(H, signal)).summary).toBe("Not indexed by Maltiverse");
    vi.restoreAllMocks();
    reply({ error: "rate limited" });
    expect((await maltiverseSource.check(H, signal)).error).toBe("rate limited");
    vi.restoreAllMocks();
    reply(null, 500);
    expect((await maltiverseSource.check(H, signal)).error).toBe("HTTP 500");
    vi.restoreAllMocks();
    vi.spyOn(http, "getJson").mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await maltiverseSource.check(H, signal)).status).toBe("timeout");
    vi.restoreAllMocks();
    vi.spyOn(http, "getJson").mockRejectedValue(new Error("boom"));
    expect((await maltiverseSource.check(H, signal)).error).toBe("boom");
  });
});
