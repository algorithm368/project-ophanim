import { describe, expect, it } from "vitest";
import { greyNoiseScore, greyNoiseVouches } from "./greynoise";

describe("greyNoiseScore", () => {
  it("maps classifications to a 0-100 contribution", () => {
    expect(greyNoiseScore("malicious")).toBe(80);
    expect(greyNoiseScore("benign")).toBe(0);
    expect(greyNoiseScore("unknown")).toBe(30);
  });

  it("treats an absent classification as unknown", () => {
    expect(greyNoiseScore(undefined)).toBe(30);
  });
});

describe("greyNoiseVouches", () => {
  it("vouches for a benign classification and for a RIOT hit", () => {
    // 71.6.146.185 comes back benign with actor "Shodan.io". Scoring it 0 and
    // stopping there left the aggregate with no way to hear that.
    expect(greyNoiseVouches("benign", false)).toBe(true);
    expect(greyNoiseVouches("unknown", true)).toBe(true);
  });

  it("does not vouch merely because nothing was found", () => {
    // "No record" is not an endorsement.
    expect(greyNoiseVouches("unknown", false)).toBe(false);
    expect(greyNoiseVouches(undefined, undefined)).toBe(false);
  });

  it("never vouches for a malicious classification", () => {
    expect(greyNoiseVouches("malicious", false)).toBe(false);
  });
});
