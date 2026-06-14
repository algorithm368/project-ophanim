import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VERDICT_FLOOR,
  metadefenderHashSource,
  metadefenderScore,
} from "./metadefender";
import { getJson } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, getJson: vi.fn() };
});

describe("metadefenderScore", () => {
  it("uses the multi-AV detection ratio when it dominates", () => {
    expect(metadefenderScore(5, 10, "no_threat")).toBe(50);
    expect(metadefenderScore(1, 40, "benign")).toBe(3);
  });

  it("applies the verdict floor when the AV ratio is weak or absent", () => {
    expect(metadefenderScore(0, 0, "malicious")).toBe(75);
    expect(metadefenderScore(0, 10, "suspicious")).toBe(45);
  });

  it("treats an unknown verdict as a 0 floor", () => {
    expect(metadefenderScore(10, 10, "unknown")).toBe(100);
    expect(VERDICT_FLOOR.malicious).toBe(75);
  });
});

// A bare engine tally must meet the same definitive bar as VirusTotal before
// it can floor the aggregate at 75 (P1.1); MetaDefender's own curated
// "malicious" verdict still hard-flags on its own.
describe("metadefenderHashSource.check — definitive-flag wiring (P1.1)", () => {
  afterEach(() => {
    vi.mocked(getJson).mockReset();
  });

  function reputation(over: Record<string, unknown>): Awaited<ReturnType<typeof getJson>> {
    return {
      ok: true,
      status: 200,
      data: { sha256: "A".repeat(64), ...over },
    } as Awaited<ReturnType<typeof getJson>>;
  }

  it("does not hard-flag a 3-engine tally without a malicious verdict", async () => {
    vi.mocked(getJson).mockResolvedValue(
      reputation({
        overall_verdict: "unknown",
        mdcloud: { total_av_engines: 30, detected_av_engines: 3 },
      }),
    );
    const f = await metadefenderHashSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(f.status).toBe("ok");
    expect(f.malicious).toBe(false);
  });

  it("hard-flags a strong engine consensus", async () => {
    vi.mocked(getJson).mockResolvedValue(
      reputation({
        overall_verdict: "unknown",
        mdcloud: { total_av_engines: 30, detected_av_engines: 12 },
      }),
    );
    const f = await metadefenderHashSource.check(
      "b".repeat(64),
      new AbortController().signal,
    );
    expect(f.malicious).toBe(true);
  });

  it("still hard-flags on MetaDefender's own malicious verdict", async () => {
    vi.mocked(getJson).mockResolvedValue(
      reputation({
        overall_verdict: "malicious",
        mdcloud: { total_av_engines: 30, detected_av_engines: 2 },
      }),
    );
    const f = await metadefenderHashSource.check(
      "c".repeat(64),
      new AbortController().signal,
    );
    expect(f.malicious).toBe(true);
  });
});
