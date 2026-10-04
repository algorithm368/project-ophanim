import { describe, expect, it, vi } from "vitest";
import { urlIndicatorProblem } from "@/lib/ti/url/validate";

// parseIP's type allows a non-routable address without a scope note. Every
// range it knows today carries one, so this fallback is only reachable through
// a stand-in; it is pinned so a future range added without a note still reads
// as a sentence.
vi.mock("@/lib/ip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ip")>();
  return {
    ...actual,
    parseIP: (raw: string) =>
      raw === "198.51.100.1"
        ? { ip: raw, version: 4, isPrivate: false, isReserved: true }
        : actual.parseIP(raw),
  };
});

describe("urlIndicatorProblem — unnamed reserved range", () => {
  it("names it generically", () => {
    expect(urlIndicatorProblem("http://198.51.100.1/")).toEqual({
      message: "Cannot check non-routable address: reserved range",
      status: 422,
      scope: undefined,
    });
  });
});
