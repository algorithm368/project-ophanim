import { describe, expect, it } from "vitest";
import { blacklistVerdict, urlhausVerdict } from "./urlhaus";

describe("blacklistVerdict", () => {
  it("does not move the score when the host is not listed", () => {
    expect(
      blacklistVerdict({ spamhaus_dbl: "not listed", surbl: "not listed" }),
    ).toEqual({ listed: false, score: 0, categories: [] });
    expect(blacklistVerdict(undefined)).toEqual({
      listed: false,
      score: 0,
      categories: [],
    });
  });

  it("scores + labels a reputable-blocklist listing", () => {
    expect(
      blacklistVerdict({ spamhaus_dbl: "malware_domain", surbl: "listed" }),
    ).toEqual({
      listed: true,
      score: 65,
      categories: ["spamhaus:malware_domain", "surbl:listed"],
    });
  });
});

describe("urlhausVerdict", () => {
  it("treats any live URL as a hard malicious signal", () => {
    expect(urlhausVerdict(2, 5)).toEqual({ score: 70, malicious: true });
    expect(urlhausVerdict(20, 30)).toEqual({ score: 100, malicious: true });
  });

  it("weighs only-historical URLs more softly, malicious at >=5", () => {
    expect(urlhausVerdict(0, 3)).toEqual({ score: 32, malicious: false });
    expect(urlhausVerdict(0, 5)).toEqual({ score: 40, malicious: true });
    expect(urlhausVerdict(0, 100)).toEqual({ score: 70, malicious: true });
  });
});
