import { describe, expect, it, vi } from "vitest";
import { classificationScore, maltiverseSource } from "./maltiverse";
import * as http from "../../http";

describe("classificationScore", () => {
  it("scores known classifications", () => {
    expect(classificationScore("malicious")).toEqual({
      score: 85,
      malicious: true,
      allowlisted: false,
    });
    expect(classificationScore("suspicious")).toEqual({
      score: 50,
      malicious: false,
      allowlisted: false,
    });
    expect(classificationScore("whitelist")).toEqual({
      score: 0,
      malicious: false,
      allowlisted: true,
    });
  });

  it("returns undefined score for neutral/unknown (absence is not clean)", () => {
    expect(classificationScore("neutral")).toEqual({
      score: undefined,
      malicious: false,
      allowlisted: false,
    });
    expect(classificationScore(undefined)).toEqual({
      score: undefined,
      malicious: false,
      allowlisted: false,
    });
  });
});

describe("maltiverseSource", () => {
  it("emits fileNames when filename is an array", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        classification: "malicious",
        filename: ["a.exe", "b.exe"],
      },
    } as never);
    const finding = await maltiverseSource.check("a".repeat(64), new AbortController().signal);
    expect(finding.hashContext?.fileNames).toEqual(["a.exe", "b.exe"]);
  });
  // blacklist[].description is sometimes one label and sometimes a comma-joined
  // set, so both shapes have to split into distinct chips rather than one
  // run-on string.
  it("splits comma-joined blacklist descriptions into distinct labels", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        classification: "malicious",
        blacklist: [
          { description: "ransomware,wcry" },
          { description: "wcry" },
          { description: "" },
        ],
      },
    } as never);
    const finding = await maltiverseSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(finding.hashContext?.detectionNames).toEqual(["ransomware", "wcry"]);
  });

  it("turns contacted hosts into typed, deduped pivots", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        classification: "malicious",
        contacted_host: ["evil.com", "evil.com", "8.8.8.8", "", 42],
      },
    } as never);
    const finding = await maltiverseSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(finding.relations).toEqual([
      {
        value: "evil.com",
        type: "domain",
        relation: "contacts",
        sources: ["maltiverse"],
        tier: "observed",
      },
      {
        value: "8.8.8.8",
        type: "ip",
        relation: "contacts",
        sources: ["maltiverse"],
        tier: "observed",
      },
    ]);
  });

  it("caps contacted-host pivots at ten", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        classification: "malicious",
        contacted_host: Array.from({ length: 25 }, (_, i) => `h${i}.example.com`),
      },
    } as never);
    const finding = await maltiverseSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(finding.relations).toHaveLength(10);
  });

  it("reads a single filename string as a one-entry list", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: { classification: "malicious", filename: "only.exe" },
    } as never);
    const finding = await maltiverseSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(finding.hashContext?.fileNames).toEqual(["only.exe"]);
  });
});
