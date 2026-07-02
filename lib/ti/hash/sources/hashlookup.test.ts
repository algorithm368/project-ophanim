import { describe, expect, it, vi } from "vitest";
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
