import { describe, expect, it } from "vitest";
import { parseUrl } from "@/lib/url";
import { heuristicsFinding, urlHeuristics } from "@/lib/ti/url/heuristics";

const hits = (input: string) => urlHeuristics(parseUrl(input)!).map((h) => h.id);

describe("urlHeuristics", () => {
  it("flags a punycode host", () => {
    expect(hits("https://xn--pypal-4ve.com/login")).toContain("punycode");
  });

  it("flags a brand lookalike", () => {
    expect(hits("https://paypa1-secure.com/login")).toContain("brand-lookalike");
  });

  it("flags a raw IP host", () => {
    expect(hits("http://185.220.101.1/admin")).toContain("ip-host");
  });

  it("flags embedded credentials", () => {
    expect(hits("https://user:pass@evil.com/a")).toContain("credentials");
  });

  it("flags an open-redirect parameter", () => {
    expect(hits("https://ok.com/go?next=https://evil.com")).toContain(
      "open-redirect",
    );
  });

  it("flags a base64 blob in the path", () => {
    expect(
      hits(`https://ok.com/${"QUJDREVGR0hJSktMTU5PUFFSU1Q".repeat(2)}`),
    ).toContain("encoded-blob");
  });

  it("flags an executable path", () => {
    expect(hits("https://ok.com/invoice.pdf.exe")).toContain("executable");
  });

  it("flags a known shortener", () => {
    expect(hits("https://bit.ly/3abcdef")).toContain("shortener");
  });

  it("flags a non-standard port", () => {
    expect(hits("https://ok.com:8443/a")).toContain("odd-port");
  });

  it("finds nothing on an ordinary URL", () => {
    expect(hits("https://www.google.com/search?q=hello")).toEqual([]);
  });

  it("does not call a brand its own domain a lookalike", () => {
    expect(hits("https://www.paypal.com/signin")).not.toContain(
      "brand-lookalike",
    );
  });
});

describe("heuristicsFinding", () => {
  const WORST =
    "https://user:pass@xn--pypal-4ve.com:8443/invoice.pdf.exe?next=https://evil.com";

  it("never declares a definitive malicious listing", () => {
    // computeFloor pins the score to 75 for any weighted source that declares
    // malicious. A guess about URL shape must not be able to reach that gate,
    // for any input at all.
    const inputs = [
      WORST,
      "http://185.220.101.1/admin",
      "https://bit.ly/3abcdef",
      "https://www.google.com/",
    ];
    for (const input of inputs) {
      expect(heuristicsFinding(parseUrl(input)!).malicious).toBeUndefined();
    }
  });

  it("caps the score below the malicious cutoff", () => {
    const worst = heuristicsFinding(parseUrl(WORST)!);
    expect(worst.score).toBeLessThan(70);
    expect(worst.status).toBe("ok");
  });

  it("scores an ordinary URL at zero with a plain summary", () => {
    const finding = heuristicsFinding(parseUrl("https://www.google.com/")!);
    expect(finding.score).toBe(0);
    expect(finding.summary).toBe("No structural red flags");
  });

  it("names the single hit when there is only one", () => {
    const finding = heuristicsFinding(parseUrl("https://bit.ly/3abcdef")!);
    expect(finding.summary).toContain("shortener");
  });
});
