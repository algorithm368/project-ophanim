import { describe, expect, it } from "vitest";
import { labelThreats } from "./safebrowsing";

describe("labelThreats", () => {
  it("maps Safe Browsing threat types to human labels", () => {
    expect(
      labelThreats([
        { threatType: "MALWARE" },
        { threatType: "SOCIAL_ENGINEERING" },
      ]),
    ).toEqual(["malware", "phishing"]);
  });

  it("dedupes repeated threat types", () => {
    expect(labelThreats([{ threatType: "MALWARE" }, { threatType: "MALWARE" }])).toEqual(
      ["malware"],
    );
  });

  it("passes through unknown types and falls back to 'threat'", () => {
    expect(labelThreats([{ threatType: "NEW_KIND" }])).toEqual(["NEW_KIND"]);
    expect(labelThreats([{}])).toEqual(["threat"]);
  });
});
