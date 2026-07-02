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
});
