import { describe, expect, it } from "vitest";
import type { SourceResult } from "../types";
import { assembleHashResult } from "../assemble";

function src(id: string, fileName: string, fileNames?: string[]): SourceResult {
  return {
    source: { id, name: id, url: "", category: "reputation", requiresKey: false, weight: 0 },
    enabled: true,
    status: "ok",
    durationMs: 1,
    hashContext: { fileNames: fileNames ?? [fileName], fileName },
  };
}

describe("assembleHashResult filename voting", () => {
  it("picks the voted winner, not the registry-first name", () => {
    const results: SourceResult[] = [
      src("hashlookup", "junkfirst.exe"),
      src("malwarebazaar", "real.exe"),
      src("virustotal", "real.exe"),
    ];
    const out = assembleHashResult("a".repeat(64), "sha256", results, "2026-07-02T00:00:00Z");
    expect(out.context?.fileName).toBe("real.exe");
  });

  it("drops the hash itself as a filename", () => {
    const sha256 = "b".repeat(64);
    const results: SourceResult[] = [src("hashlookup", sha256)];
    const out = assembleHashResult(sha256, "sha256", results, "2026-07-02T00:00:00Z");
    expect(out.context?.fileName).toBeUndefined();
  });
});
