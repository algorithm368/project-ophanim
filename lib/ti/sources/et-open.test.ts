import { describe, expect, it } from "vitest";
import { parseCompromisedFeed } from "./et-open";

describe("parseCompromisedFeed", () => {
  it("collects IPs, skipping comments and blank lines and trimming", () => {
    const set = parseCompromisedFeed(
      ["# header", "1.2.3.4", "", "  5.6.7.8  ", "#trailing"].join("\n"),
    );
    expect([...set]).toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  it("dedupes repeated IPs", () => {
    expect(parseCompromisedFeed("1.1.1.1\n1.1.1.1").size).toBe(1);
  });
});
