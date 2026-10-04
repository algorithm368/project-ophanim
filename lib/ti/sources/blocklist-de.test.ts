import { afterEach, describe, expect, it, vi } from "vitest";
import { blocklistDeScore, blocklistDeSource, parseBlocklistDe } from "./blocklist-de";
import { getText } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getText: vi.fn() };
});

describe("parseBlocklistDe", () => {
  it("pulls attack/report counts from the HTML-ish body", () => {
    expect(parseBlocklistDe("attacks: 5<br />reports: 3")).toEqual({
      attacks: 5,
      reports: 3,
    });
  });

  it("defaults missing counts to 0", () => {
    expect(parseBlocklistDe("")).toEqual({ attacks: 0, reports: 0 });
    expect(parseBlocklistDe("reports: 9")).toEqual({ attacks: 0, reports: 9 });
  });
});

describe("blocklistDeScore", () => {
  it("is 0 with no attacks, else 30 base + 5 per attack (capped)", () => {
    expect(blocklistDeScore(0)).toBe(0);
    expect(blocklistDeScore(1)).toBe(35);
    expect(blocklistDeScore(20)).toBe(100);
  });
});

describe("blocklistDeSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (ok: boolean, text: string, status = 200) =>
    vi.mocked(getText).mockResolvedValue({ ok, status, data: null, text });
  afterEach(() => vi.mocked(getText).mockReset());

  it("needs no key", () => expect(blocklistDeSource.isEnabled()).toBe(true));

  it("flags five or more attacks as malicious", async () => {
    reply(true, "attacks: 6<br />reports: 2\n");
    const f = await blocklistDeSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({
      status: "ok",
      malicious: true,
      score: 60,
      summary: "6 attack(s), 2 report(s) in the last 48h",
      raw: "attacks: 6<br />reports: 2",
    });
  });

  it("reports a quiet IP as clean", async () => {
    reply(true, "attacks: 0<br />reports: 0");
    const f = await blocklistDeSource.check("1.2.3.4", signal);
    expect(f.malicious).toBe(false);
    expect(f.summary).toBe("No recent attacks reported");
  });

  it("surfaces HTTP failures, timeouts and errors", async () => {
    reply(false, "", 503);
    expect(await blocklistDeSource.check("1.2.3.4", signal)).toEqual({
      status: "error",
      error: "HTTP 503",
    });
    vi.mocked(getText).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await blocklistDeSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getText).mockRejectedValue(new Error("boom"));
    expect(await blocklistDeSource.check("1.2.3.4", signal)).toEqual({
      status: "error",
      error: "boom",
    });
  });
});
