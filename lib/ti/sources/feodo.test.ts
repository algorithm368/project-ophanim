import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feodoFinding, feodoSource } from "./feodo";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("feodoFinding", () => {
  it("maps a C2 hit to a malicious botnet finding", () => {
    const f = feodoFinding({
      ip_address: "1.2.3.4",
      malware: "Emotet",
      status: "online",
      last_online: "2024-01-01",
      port: 443,
    });
    expect(f.malicious).toBe(true);
    expect(f.score).toBe(95);
    expect(f.categories).toEqual(["botnet-c2", "Emotet"]);
    expect(f.summary).toBe("Known Emotet C2 (status: online)");
    expect(f.lastSeen).toBe("2024-01-01");
  });

  it("falls back to generic labels when malware/status are missing", () => {
    const f = feodoFinding({ ip_address: "9.9.9.9" });
    expect(f.categories).toEqual(["botnet-c2", "malware"]);
    expect(f.summary).toBe("Known malware C2 (status: unknown)");
  });
});

describe("feodoSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, ok = true) =>
    vi.mocked(getJson).mockResolvedValue({ ok, status: ok ? 200 : 503, data, text: "" });
  // The feed is cached for an hour at module scope; each test starts two hours
  // after the last so it always sees a cold cache.
  let now = Date.UTC(2026, 0, 1);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    now += 2 * 60 * 60 * 1000;
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getJson).mockReset();
  });

  it("needs no key", () => expect(feodoSource.isEnabled()).toBe(true));

  it("finds a listed C2, shares one in-flight fetch, then serves from cache", async () => {
    reply([{ ip_address: "1.2.3.4", malware: "QakBot" }, { ip_address: "" }]);
    const [hit, miss] = await Promise.all([
      feodoSource.check("1.2.3.4", signal),
      feodoSource.check("5.6.7.8", signal),
    ]);
    expect(hit.malicious).toBe(true);
    expect(miss).toEqual({ status: "ok", score: 0, summary: "Not a known botnet C2" });
    await feodoSource.check("1.2.3.4", signal);
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it("errors when the feed is unavailable or not a list", async () => {
    reply(null, false);
    expect(await feodoSource.check("1.2.3.4", signal)).toEqual({
      status: "error",
      error: "feed unavailable (HTTP 503)",
    });
    reply({ not: "a list" });
    expect((await feodoSource.check("1.2.3.4", signal)).status).toBe("error");
  });

  it("maps a timeout", async () => {
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await feodoSource.check("1.2.3.4", signal)).status).toBe("timeout");
  });
});
