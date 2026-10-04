import { afterEach, describe, expect, it, vi } from "vitest";
import { toNumber, hashlookupSource } from "./hashlookup";
import * as http from "../../http";

describe("toNumber", () => {
  it("coerces numeric strings and passes through numbers", () => {
    expect(toNumber(1234)).toBe(1234);
    expect(toNumber("1234")).toBe(1234);
  });

  it("returns undefined for absent or non-numeric values", () => {
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber("not-a-number")).toBeUndefined();
  });
});

describe("hashlookupSource", () => {
  it("emits fileNames when a FileName is present", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: { FileName: "notepad.exe", MD5: "d".repeat(32) },
    } as never);
    const finding = await hashlookupSource.check("d".repeat(32), new AbortController().signal);
    expect(finding.hashContext?.fileNames).toEqual(["notepad.exe"]);
  });
});

describe("hashlookupSource — remaining paths", () => {
  const signal = new AbortController().signal;
  const MD5 = "d".repeat(32);
  const reply = (data: unknown, status = 200) =>
    vi.spyOn(http, "getJson").mockResolvedValue({ ok: status < 400, status, data, text: "" } as never);
  afterEach(() => vi.restoreAllMocks());

  it("needs no key, and rejects an unsupported length", async () => {
    expect(hashlookupSource.isEnabled()).toBe(true);
    expect(await hashlookupSource.check("abc", signal)).toEqual({
      status: "error",
      error: "Unsupported hash length",
    });
  });

  it("flags a known-malicious file with its sources", async () => {
    reply({ KnownMalicious: " feedA, feedB ,", "SHA-1": "AA", "SHA-256": "BB", FileSize: "12" });
    expect(await hashlookupSource.check(MD5, signal)).toMatchObject({
      malicious: true,
      score: 85,
      summary: "Flagged as known malicious by feedA, feedB ,",
      categories: ["feedA", "feedB"],
      hashContext: { sha1: "aa", sha256: "bb", fileSize: 12 },
    });
  });

  it("vouches for a known file, naming its origin and file name when present", async () => {
    reply({ db: "nsrl", FileName: "calc.exe" });
    expect((await hashlookupSource.check(MD5, signal)).summary).toBe(
      'Known legitimate file (nsrl), "calc.exe"',
    );
    vi.restoreAllMocks();
    reply({ source: "snap", FileName: "  " });
    expect((await hashlookupSource.check(MD5, signal)).summary).toBe("Known legitimate file (snap)");
    vi.restoreAllMocks();
    reply({});
    const f = await hashlookupSource.check(MD5, signal);
    expect(f.summary).toBe("Known legitimate file");
    expect(f.hashContext?.fileNames).toBeUndefined();
  });

  it("maps 404, errors and timeouts", async () => {
    reply(null, 404);
    expect((await hashlookupSource.check(MD5, signal)).summary).toBe(
      "Not in the known-files database",
    );
    vi.restoreAllMocks();
    reply({ message: "bad hash" }, 400);
    expect((await hashlookupSource.check(MD5, signal)).error).toBe("bad hash");
    vi.restoreAllMocks();
    reply(null, 500);
    expect((await hashlookupSource.check(MD5, signal)).error).toBe("HTTP 500");
    vi.restoreAllMocks();
    vi.spyOn(http, "getJson").mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await hashlookupSource.check(MD5, signal)).status).toBe("timeout");
    vi.restoreAllMocks();
    vi.spyOn(http, "getJson").mockRejectedValue(new Error("boom"));
    expect((await hashlookupSource.check(MD5, signal)).error).toBe("boom");
  });
});
