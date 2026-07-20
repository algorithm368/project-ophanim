import { describe, expect, it } from "vitest";
import { describeDll, dllKey, dllRank } from "./dll-dictionary";

describe("dllKey", () => {
  it("strips path, casing, and the .dll suffix", () => {
    expect(dllKey("C:\\Windows\\System32\\WS2_32.dll")).toBe("ws2_32");
    expect(dllKey("ADVAPI32.dll")).toBe("advapi32");
    expect(dllKey("ntdll")).toBe("ntdll");
  });
});

describe("describeDll", () => {
  it("describes known DLLs regardless of path/casing", () => {
    expect(describeDll("ws2_32.dll")).toMatch(/network|winsock/i);
    expect(describeDll("C:\\x\\CRYPT32.DLL")).toMatch(/crypto|certificate/i);
  });

  it("returns undefined for unknown libraries", () => {
    expect(describeDll("totally_custom_payload.dll")).toBeUndefined();
  });
});

describe("dllRank", () => {
  it("ranks capability DLLs before boilerplate before unknown", () => {
    expect(dllRank("ws2_32.dll")).toBe(0); // capability
    expect(dllRank("kernel32.dll")).toBe(1); // common boilerplate
    expect(dllRank("custom_thing.dll")).toBe(2); // unknown
  });
});
