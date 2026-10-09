import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VOUCHING_IDS, familyOf, inBulkProfile, isMetered, pass0Sources,
  pass1Sources, pass2Ids, PASS2_KEY_ENVS, registryFor, sourceById,
} from "./profile";
import { METERED_IDS } from "./types";
import { sourceWeight } from "../weight";

/** Source ids whose adapter can set `allowlisted`, read from the source text so
 *  a new vouching adapter cannot slip past VOUCHING_IDS unnoticed. */
function vouchingIdsOnDisk(): Set<string> {
  const found = new Set<string>();
  for (const dir of ["lib/ti/sources", "lib/ti/domain/sources"]) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const text = readFileSync(join(dir, file), "utf8");
      const id = /id:\s*"([^"]+)"/.exec(text)?.[1];
      if (id && /allowlisted\s*[:=]/.test(text)) found.add(id);
    }
  }
  return found;
}

describe("bulk source profile", () => {
  it("knows every vouching adapter", () => {
    for (const id of vouchingIdsOnDisk()) expect(VOUCHING_IDS.has(id)).toBe(true);
  });

  it("excludes only weight-0 sources that never vouch", () => {
    for (const kind of ["ip", "domain"] as const) {
      for (const s of registryFor(kind)) {
        if (inBulkProfile(s)) continue;
        expect(sourceWeight(s.meta)).toBe(0);
        expect(VOUCHING_IDS.has(s.meta.id)).toBe(false);
      }
    }
  });

  it("keeps metered sources out of pass 1 and drops the context fan-out", () => {
    const ids = pass1Sources("ip").map((s) => s.meta.id);
    expect(ids.some(isMetered)).toBe(false);
    expect(ids).not.toContain("ip-api");
    expect(ids).not.toContain("reverse-ip");
    expect(ids).toEqual(expect.arrayContaining(["scanner-id", "feodo"]));
    expect(pass1Sources("domain").map((s) => s.meta.id)).toContain("tranco");
  });

  it("filters IP sources by family", () => {
    const v6 = pass1Sources("ip", 6).map((s) => s.meta.id);
    expect(v6).not.toContain("ipsum");
    expect(v6).toContain("spamhaus-drop");
  });

  it("builds pass 0 from the four feeds, by family", () => {
    expect(pass0Sources(4).map((s) => s.meta.id).sort()).toEqual(["et-open", "feodo", "ipsum", "spamhaus-drop"]);
    expect(pass0Sources(6).map((s) => s.meta.id)).toEqual(["spamhaus-drop"]);
  });

  it("reads the family of an indicator", () => {
    expect(familyOf("ip", "2001:db8::1")).toBe(6);
    expect(familyOf("ip", "1.2.3.4")).toBe(4);
    expect(familyOf("domain", "a.com")).toBe(4);
    expect(familyOf("ip", "not-an-ip")).toBe(4);
  });

  it("orders pass 2 by bucket, without VirusTotal or GreyNoise", () => {
    for (const bucket of ["A", "B", "C"] as const) {
      expect(pass2Ids("ip", bucket)).toEqual(["abuseipdb", "otx"]);
      expect(pass2Ids("domain", bucket)).toEqual(["safebrowsing"]);
    }
    expect(pass2Ids("ip", "D")).toEqual([]);
  });

  it("names exactly the key pools pass 2 spends", () => {
    const envs = new Set<string>();
    for (const kind of ["ip", "domain"] as const) {
      for (const bucket of ["A", "B", "C"] as const) {
        for (const id of pass2Ids(kind, bucket)) envs.add(sourceById(kind, id)?.meta.keyEnv ?? "");
      }
    }
    expect([...envs].sort()).toEqual([...PASS2_KEY_ENVS].sort());
  });

  it("only names metered ids that exist in the registry", () => {
    for (const kind of ["ip", "domain"] as const) {
      for (const bucket of ["A", "B", "C"] as const) {
        for (const id of pass2Ids(kind, bucket)) {
          expect(METERED_IDS).toContain(id);
          expect(sourceById(kind, id)?.meta.keyEnv).toBeTruthy();
        }
      }
    }
    expect(sourceById("ip", "nope")).toBeUndefined();
  });
});
