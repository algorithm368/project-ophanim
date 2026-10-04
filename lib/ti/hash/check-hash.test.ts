import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHash } from "@/lib/ti/hash/check";
import { fetchFamilyDescription } from "@/lib/ti/hash/sources/malpedia";
import type { HashContext, SourceFinding, SourceResult, TiSource } from "@/lib/ti/types";

// checkHash end to end over an in-memory registry: no network, and Malpedia
// stubbed so the family enrichment can be steered.
const registry = vi.hoisted(() => ({ sources: [] as TiSource[] }));

vi.mock("@/lib/ti/hash/registry", () => ({
  get hashSources() {
    return registry.sources;
  },
}));

vi.mock("@/lib/ti/hash/sources/malpedia", () => ({
  fetchFamilyDescription: vi.fn(),
}));

function source(
  id: string,
  finding: SourceFinding,
  algorithms?: ("md5" | "sha1" | "sha256")[],
): TiSource {
  return {
    meta: {
      id,
      name: id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: 1,
      algorithms,
    },
    isEnabled: () => true,
    check: async () => finding,
  };
}

const SHA256 = "a".repeat(64);

describe("checkHash", () => {
  afterEach(() => vi.mocked(fetchFamilyDescription).mockReset());

  it("skips sources that cannot take the algorithm, keeping registry order", async () => {
    registry.sources = [
      source("md5-only", { status: "ok", summary: "x" }, ["md5"]),
      source("any", { status: "ok", score: 0, summary: "y" }),
    ];
    const settled: SourceResult[] = [];
    const result = await checkHash(SHA256, "sha256", (r) => settled.push(r));
    expect(result.sources.map((r) => [r.source.id, r.status])).toEqual([
      ["md5-only", "skipped"],
      ["any", "ok"],
    ]);
    expect(settled.map((r) => r.source.id).sort()).toEqual(["any", "md5-only"]);
    expect(result.context).toBeUndefined();
    expect(fetchFamilyDescription).not.toHaveBeenCalled();
  });

  it("leaves a context without a family untouched", async () => {
    const hashContext: HashContext = { fileType: "PE" };
    registry.sources = [source("ctx", { status: "ok", hashContext })];
    const result = await checkHash(SHA256, "sha256");
    expect(result.context?.fileType).toBe("PE");
    expect(result.context?.familyDescription).toBeUndefined();
    expect(fetchFamilyDescription).not.toHaveBeenCalled();
  });

  it("describes the resolved family from Malpedia", async () => {
    vi.mocked(fetchFamilyDescription).mockResolvedValue({
      description: "A stealer",
      refs: ["https://ref.example"],
    });
    registry.sources = [source("ctx", { status: "ok", hashContext: { malwareFamily: "Lumma" } })];
    const result = await checkHash(SHA256, "sha256");
    expect(fetchFamilyDescription).toHaveBeenCalledWith("Lumma", expect.any(AbortSignal));
    expect(result.context).toMatchObject({
      malwareFamily: "Lumma",
      familyDescription: "A stealer",
      familyRefs: ["https://ref.example"],
    });
  });

  it("fills the family from detections and degrades quietly when Malpedia fails", async () => {
    vi.mocked(fetchFamilyDescription).mockRejectedValue(new Error("down"));
    registry.sources = [
      source("ctx", {
        status: "ok",
        hashContext: { detectionNames: ["Trojan.Win32.Emotet.abc", "Win32/Emotet.A"] },
      }),
    ];
    const result = await checkHash(SHA256, "sha256");
    expect(result.context?.malwareFamily).toBeTruthy();
    expect(result.context?.familyDescription).toBeUndefined();
    expect(result.context?.familyRefs).toBeUndefined();
  });
});
