import { describe, expect, it, vi } from "vitest";
import { checkDomain } from "@/lib/ti/domain/check";
import type { SourceResult } from "@/lib/ti/types";

vi.mock("@/lib/ti/domain/registry", () => ({
  domainSources: [
    {
      meta: {
        id: "stub",
        name: "Stub",
        url: "https://example.test",
        category: "reputation",
        requiresKey: false,
        weight: 1,
      },
      isEnabled: () => true,
      check: async () => ({ status: "ok", score: 0, summary: "clean" }),
    },
  ],
}));

describe("checkDomain", () => {
  it("runs every registered source and assembles one result", async () => {
    const settled: SourceResult[] = [];
    const result = await checkDomain("example.com", (r) => settled.push(r));
    expect(result.domain).toBe("example.com");
    expect(result.sources.map((r) => r.status)).toEqual(["ok"]);
    expect(settled).toHaveLength(1);
  });
});
