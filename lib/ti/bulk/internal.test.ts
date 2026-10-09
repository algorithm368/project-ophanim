import { afterEach, describe, expect, it } from "vitest";
import { isInternalName } from "./internal";

afterEach(() => delete process.env.TI_INTERNAL_SUFFIXES);

describe("isInternalName", () => {
  it("matches a configured suffix on a label boundary, any case", () => {
    process.env.TI_INTERNAL_SUFFIXES = " dc01.fujixerox.net , corp.example.co.th";
    expect(isInternalName("sgpaphq-addc04.dc01.fujixerox.net")).toBe(true);
    expect(isInternalName("DC01.FUJIXEROX.NET")).toBe(true);
    expect(isInternalName("fujixerox.net")).toBe(false);
    expect(isInternalName("evildc01.fujixerox.net")).toBe(false);
  });
  it("treats single labels and internal-use TLDs as internal", () => {
    expect(isInternalName("fileserver01")).toBe(true);
    expect(isInternalName("nas.lan")).toBe(true);
    expect(isInternalName("printer.home.arpa")).toBe(true);
    expect(isInternalName("evil.com")).toBe(false);
  });
});
