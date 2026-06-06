import { describe, expect, it } from "vitest";
import { blocklistDeScore, parseBlocklistDe } from "./blocklist-de";

describe("parseBlocklistDe", () => {
  it("pulls attack/report counts from the HTML-ish body", () => {
    expect(parseBlocklistDe("attacks: 5<br />reports: 3")).toEqual({
      attacks: 5,
      reports: 3,
    });
  });

  it("defaults missing counts to 0", () => {
    expect(parseBlocklistDe("")).toEqual({ attacks: 0, reports: 0 });
    expect(parseBlocklistDe("reports: 9")).toEqual({ attacks: 0, reports: 9 });
  });
});

describe("blocklistDeScore", () => {
  it("is 0 with no attacks, else 30 base + 5 per attack (capped)", () => {
    expect(blocklistDeScore(0)).toBe(0);
    expect(blocklistDeScore(1)).toBe(35);
    expect(blocklistDeScore(20)).toBe(100);
  });
});
