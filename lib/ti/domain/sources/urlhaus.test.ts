import { describe, expect, it } from "vitest";
import { urlhausVerdict } from "./urlhaus";

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
