import { describe, expect, it } from "vitest";
import { modeHref, modeRouteFor, passiveHref } from "@/lib/route-mode";

describe("modeRouteFor", () => {
  it("reads the passive and the active page", () => {
    expect(modeRouteFor("/check/8.8.8.8")).toEqual({
      mode: "passive",
      indicator: "8.8.8.8",
    });
    expect(modeRouteFor("/scan/evil.test")).toEqual({
      mode: "active",
      indicator: "evil.test",
    });
  });

  it("decodes an indicator that was encoded to survive the path", () => {
    const route = modeRouteFor(`/scan/${encodeURIComponent("https://a.test/x?id=1")}`);
    expect(route?.indicator).toBe("https://a.test/x?id=1");
  });

  it("tolerates a trailing slash", () => {
    expect(modeRouteFor("/check/a.test/")?.indicator).toBe("a.test");
  });

  it("reads each landing page as its mode, with nothing read in it yet", () => {
    // This is what puts the switch on screen before anything is typed.
    expect(modeRouteFor("/")).toEqual({ mode: "passive" });
    expect(modeRouteFor("/scan")).toEqual({ mode: "active" });
    expect(modeRouteFor("/scan/")).toEqual({ mode: "active" });
  });

  it("names no mode for a path in neither", () => {
    expect(modeRouteFor("/check")).toBeNull();
    expect(modeRouteFor("/about")).toBeNull();
    expect(modeRouteFor("/about/us")).toBeNull();
    expect(modeRouteFor("/check/a.test/extra")).toBeNull();
  });

  it("refuses a malformed escape rather than guessing at the indicator", () => {
    expect(modeRouteFor("/check/%E0%A4%A")).toBeNull();
  });
});

describe("modeHref", () => {
  it("points at the landing page when there is no indicator to carry across", () => {
    expect(modeHref("passive")).toBe("/");
    expect(modeHref("active")).toBe("/scan");
    expect(modeHref("active", "")).toBe("/scan");
  });

  it("builds each page's path, encoding the indicator once", () => {
    expect(modeHref("passive", "8.8.8.8")).toBe("/check/8.8.8.8");
    expect(modeHref("active", "https://a.test/x?id=1")).toBe(
      "/scan/https%3A%2F%2Fa.test%2Fx%3Fid%3D1",
    );
  });

  it("round-trips with the reader, which is the property that matters", () => {
    for (const indicator of [
      "8.8.8.8",
      "evil.test",
      "https://a.test/x?id=1&b=2",
      "sub.domain.co.uk",
    ]) {
      for (const mode of ["passive", "active"] as const) {
        expect(modeRouteFor(modeHref(mode, indicator))).toEqual({
          mode,
          indicator,
        });
      }
    }
  });
});

describe("passiveHref", () => {
  it("carries an ip, domain, or hash across unchanged", () => {
    expect(passiveHref("8.8.8.8")).toBe("/check/8.8.8.8");
    expect(passiveHref("example.org")).toBe("/check/example.org");
  });

  // Passive mode has no reading of a URL, and /check/<url> redirects back to
  // the scan page, so linking there would go in a circle.
  it("carries a url across as its host", () => {
    expect(passiveHref("https://evil.test/login?x=1")).toBe("/check/evil.test");
    expect(passiveHref("http://1.2.3.4/a")).toBe("/check/1.2.3.4");
  });

  it("leaves input it cannot read alone", () => {
    expect(passiveHref("not an indicator")).toBe("/check/not%20an%20indicator");
  });
});
