import { describe, expect, it } from "vitest";
import { resolveFamily, parseFamilyFromDetections } from "./family";

describe("parseFamilyFromDetections", () => {
  it("extracts the family from vendor labels, ignoring platform/type/generic", () => {
    const family = parseFamilyFromDetections([
      "Trojan-Downloader.Win32.Upatre.afcl",
      "HEUR:Trojan.Win32.Generic",
    ]);
    expect(family).toBe("Upatre");
  });

  it("keeps a 5-letter capitalized family on a non-Windows platform", () => {
    expect(parseFamilyFromDetections(["Trojan.Linux.Mirai"])).toBe("Mirai");
  });

  it("prefers the family two vendors agree on", () => {
    const family = parseFamilyFromDetections([
      "Win32.Emotet.gen",
      "Trojan.Emotet",
      "HEUR:Trojan.Win32.Generic",
    ]);
    expect(family).toBe("Emotet");
  });

  it("returns undefined when only generic/type tokens are present", () => {
    expect(parseFamilyFromDetections(["HEUR:Trojan.Win32.Generic"])).toBeUndefined();
    expect(parseFamilyFromDetections([])).toBeUndefined();
  });
});

describe("resolveFamily", () => {
  it("uses an explicit malwareFamily verbatim", () => {
    expect(resolveFamily({ malwareFamily: "Emotet" })).toBe("Emotet");
  });

  it("falls back to parsing detectionNames", () => {
    expect(
      resolveFamily({ detectionNames: ["Trojan-Downloader.Win32.Upatre.afcl"] }),
    ).toBe("Upatre");
  });

  it("returns undefined with neither signal", () => {
    expect(resolveFamily({})).toBeUndefined();
  });
});
