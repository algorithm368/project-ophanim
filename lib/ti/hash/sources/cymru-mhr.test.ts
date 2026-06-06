import { describe, expect, it } from "vitest";
import { cymruScore, parseCymruTxt } from "./cymru-mhr";

describe("parseCymruTxt", () => {
  it("parses '<ts> <detection>' into an ISO date + percentage", () => {
    expect(parseCymruTxt("1700000000 75")).toEqual({
      lastSeen: "2023-11-14T22:13:20.000Z",
      detection: 75,
    });
  });

  it("yields no date and NaN detection for junk", () => {
    const r = parseCymruTxt("nonsense");
    expect(r.lastSeen).toBeUndefined();
    expect(Number.isNaN(r.detection)).toBe(true);
  });
});

describe("cymruScore", () => {
  it("floors a known sample at 50 and caps at 95", () => {
    expect(cymruScore(10)).toBe(50);
    expect(cymruScore(75)).toBe(75);
    expect(cymruScore(99)).toBe(95);
  });

  it("falls back to 60 when the detection rate is missing", () => {
    expect(cymruScore(NaN)).toBe(60);
  });
});
