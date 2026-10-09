import { describe, expect, it } from "vitest";
import { aggregateRisk } from "../aggregate";
import type { SourceResult } from "../types";
import { sourceWeight } from "../weight";
import { inBulkProfile, registryFor } from "./profile";

type Shape = "listed" | "mixed" | "quiet" | "vouched";

/** One plausible answer per registry source. Context sources get a score too,
 *  to prove their weight of 0 keeps them out of the sum. */
function fixture(kind: "ip" | "domain", shape: Shape): SourceResult[] {
  return registryFor(kind).map((s, i) => {
    const weighted = sourceWeight(s.meta) > 0;
    const base: SourceResult = { source: s.meta, enabled: true, durationMs: 1, status: "ok", score: weighted ? 0 : 50 };
    if (shape === "listed" && ["feodo", "openphish"].includes(s.meta.id)) return { ...base, score: 100, malicious: true };
    if (shape === "mixed" && weighted && i % 3 === 0) return { ...base, score: 55 };
    if (shape === "vouched" && ["tranco", "scanner-id"].includes(s.meta.id)) return { ...base, allowlisted: true };
    return base;
  });
}

describe("bulk scores match /check", () => {
  for (const kind of ["ip", "domain"] as const) {
    for (const shape of ["listed", "mixed", "quiet", "vouched"] as const) {
      it(`${kind}, ${shape}`, () => {
        const full = fixture(kind, shape);
        const ids = new Set(registryFor(kind).filter(inBulkProfile).map((s) => s.meta.id));
        expect(aggregateRisk(full.filter((r) => ids.has(r.source.id)))).toEqual(aggregateRisk(full));
      });
    }
  }
});
