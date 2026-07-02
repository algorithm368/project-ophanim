import { describe, expect, it } from "vitest";
import type { SourceResult } from "../types";
import { resolveFileName } from "./resolve-name";

// Minimal ok-result stub carrying only what the resolver reads.
function src(
  id: string,
  hashContext: SourceResult["hashContext"],
): SourceResult {
  return {
    source: {
      id,
      name: id,
      url: "",
      category: "reputation",
      requiresKey: false,
      weight: 0,
    },
    enabled: true,
    status: "ok",
    durationMs: 1,
    hashContext,
  };
}

const NO_HASHES = {};

describe("resolveFileName", () => {
  it("drops a name equal to the hash", () => {
    const sha256 = "a".repeat(64);
    const out = resolveFileName([src("s1", { fileName: sha256 })], {
      sha256,
    });
    expect(out.fileName).toBeUndefined();
    expect(out.fileNames).toBeUndefined();
  });

  it("drops a bare-hex name with or without an extension", () => {
    const md5 = "d".repeat(32);
    const out = resolveFileName(
      [src("s1", { fileNames: ["b".repeat(64), "c".repeat(40) + ".exe"] })],
      { md5 },
    );
    expect(out.fileName).toBeUndefined();
  });

  it("drops generic placeholder names", () => {
    const out = resolveFileName(
      [src("s1", { fileNames: ["file", "sample.bin", "desktop.ini", "invoice.exe"] })],
      NO_HASHES,
    );
    expect(out.fileName).toBe("invoice.exe");
    expect(out.fileNames).toEqual(["invoice.exe"]);
  });

  it("drops pure-numeric, single-char, and extension-only names", () => {
    const out = resolveFileName(
      [src("s1", { fileNames: ["123", "a", ".exe", "real.dll"] })],
      NO_HASHES,
    );
    expect(out.fileNames).toEqual(["real.dll"]);
  });

  it("picks the name reported by the most distinct sources", () => {
    const out = resolveFileName(
      [
        src("s1", { fileNames: ["popular.exe", "rare.exe"] }),
        src("s2", { fileName: "popular.exe" }),
        src("s3", { fileName: "popular.exe" }),
      ],
      NO_HASHES,
    );
    expect(out.fileName).toBe("popular.exe");
    expect(out.fileNames).toEqual(["popular.exe", "rare.exe"]);
  });

  it("does not let one source out-vote others by repeating a name", () => {
    const out = resolveFileName(
      [
        src("s1", { fileNames: ["dup.exe", "dup.exe", "DUP.EXE"] }),
        src("hashlookup", { fileName: "other.exe" }),
        src("virustotal", { fileName: "other.exe" }),
      ],
      NO_HASHES,
    );
    // "dup.exe" has 1 distinct source, "other.exe" has 2.
    expect(out.fileName).toBe("other.exe");
  });

  it("breaks vote ties by source name-trust order", () => {
    const out = resolveFileName(
      [
        src("hashlookup", { fileName: "weak.exe" }),
        src("malwarebazaar", { fileName: "strong.exe" }),
      ],
      NO_HASHES,
    );
    expect(out.fileName).toBe("strong.exe");
  });

  it("returns undefined when every name is junk", () => {
    const sha1 = "e".repeat(40);
    const out = resolveFileName(
      [src("s1", { fileNames: ["file", sha1, "1"] })],
      { sha1 },
    );
    expect(out).toEqual({ fileName: undefined, fileNames: undefined });
  });

  it("ignores non-ok sources", () => {
    const bad: SourceResult = { ...src("s1", { fileName: "ghost.exe" }), status: "error" };
    const out = resolveFileName([bad], NO_HASHES);
    expect(out.fileName).toBeUndefined();
  });
});
