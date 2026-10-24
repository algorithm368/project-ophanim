import { afterEach, describe, expect, it, vi } from "vitest";
import { greyNoiseScore, greyNoiseSource, greyNoiseVouches } from "./greynoise";
import { getJson } from "../http";
import {
  getCachedGreyNoiseIdentification,
  setCachedGreyNoiseIdentification,
} from "../cache";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

vi.mock("../cache", () => ({
  getCachedGreyNoiseIdentification: vi.fn(),
  setCachedGreyNoiseIdentification: vi.fn(),
}));

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

// #37: a rate-limited day used to hand threatTypeOf() nothing at all, which
// is how a Shodan census host stopped typing as "scanner" and started typing
// as "brute force" off the abuse reports filed by the people it scanned.
describe("greyNoiseSource.check — quota exhaustion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
    vi.mocked(getCachedGreyNoiseIdentification).mockReset();
    vi.mocked(setCachedGreyNoiseIdentification).mockReset();
  });

  it("falls back to the cached identification when the quota is exhausted", async () => {
    vi.stubEnv("GREYNOISE_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue({
      ok: false,
      status: 429,
      data: { message: "Daily quota exceeded" },
    } as Awaited<ReturnType<typeof getJson>>);
    vi.mocked(getCachedGreyNoiseIdentification).mockResolvedValue({
      classification: "benign",
      noise: true,
      riot: false,
      actor: "Shodan.io",
    });

    const f = await greyNoiseSource.check(
      "71.6.146.185",
      new AbortController().signal,
    );

    expect(f.status).toBe("ok");
    expect(f.categories).toEqual(["internet-scanner", "benign"]);
    expect(f.allowlisted).toBe(true);
    expect(f.summary).toContain("cached identification");
  });

  it("drops GreyNoise's own 'unknown' actor sentinel instead of rendering it", async () => {
    vi.stubEnv("GREYNOISE_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue({
      ok: false,
      status: 429,
      data: { message: "Daily quota exceeded" },
    } as Awaited<ReturnType<typeof getJson>>);
    vi.mocked(getCachedGreyNoiseIdentification).mockResolvedValue({
      classification: "unknown",
      noise: true,
      riot: false,
      actor: "unknown",
    });

    const f = await greyNoiseSource.check(
      "203.0.113.9",
      new AbortController().signal,
    );

    expect(f.summary).not.toContain("(unknown)");
  });


  it("reports rate_limited when the quota is exhausted and nothing was cached", async () => {
    vi.stubEnv("GREYNOISE_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue({
      ok: false,
      status: 429,
      data: { message: "Daily quota exceeded" },
    } as Awaited<ReturnType<typeof getJson>>);
    vi.mocked(getCachedGreyNoiseIdentification).mockResolvedValue(null);

    const f = await greyNoiseSource.check(
      "203.0.113.9",
      new AbortController().signal,
    );

    expect(f.status).toBe("rate_limited");
  });

  it("stores the identification on a live answer, for a later quota-exhausted day", async () => {
    vi.stubEnv("GREYNOISE_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { classification: "benign", noise: true, name: "Shodan.io" },
    } as Awaited<ReturnType<typeof getJson>>);

    const f = await greyNoiseSource.check(
      "71.6.146.185",
      new AbortController().signal,
    );

    expect(f.status).toBe("ok");
    expect(setCachedGreyNoiseIdentification).toHaveBeenCalledWith(
      "71.6.146.185",
      expect.objectContaining({ classification: "benign", actor: "Shodan.io" }),
    );
  });
});

describe("greyNoiseSource.check — remaining paths", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
    vi.mocked(getCachedGreyNoiseIdentification).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("GREYNOISE_API_KEY", "");
    expect(greyNoiseSource.isEnabled()).toBe(false);
    expect(await greyNoiseSource.check("1.2.3.4", signal)).toEqual({ status: "skipped" });
  });

  it("labels an active scanner and a RIOT service", async () => {
    vi.stubEnv("GREYNOISE_API_KEY", "k");
    expect(greyNoiseSource.isEnabled()).toBe(true);
    reply({ classification: "benign", noise: true, riot: true, name: "Shodan" });
    const f = await greyNoiseSource.check("1.2.3.4", signal);
    expect(f.categories).toEqual(["internet-scanner", "common-business-service", "benign"]);
    expect(f.summary).toBe("benign (Shodan) (active scanner)");
    expect(f.allowlisted).toBe(true);
  });

  it("calls a classless answer unknown", async () => {
    vi.stubEnv("GREYNOISE_API_KEY", "k");
    reply({});
    expect((await greyNoiseSource.check("1.2.3.4", signal)).summary).toBe("unknown");
  });

  it("maps 404, quota wording, errors and timeouts", async () => {
    vi.stubEnv("GREYNOISE_API_KEY", "k");
    reply(null, 404);
    expect((await greyNoiseSource.check("1.2.3.4", signal)).summary).toBe(
      "Not observed scanning the internet",
    );
    vi.mocked(getCachedGreyNoiseIdentification).mockResolvedValue(null);
    reply({ message: "Daily limit reached" });
    expect((await greyNoiseSource.check("1.2.3.4", signal)).summary).toBe("Daily limit reached");
    reply(null, 429);
    expect((await greyNoiseSource.check("1.2.3.4", signal)).summary).toBe("Daily quota exceeded");
    reply({ message: "invalid key" }, 401);
    expect((await greyNoiseSource.check("1.2.3.4", signal)).error).toBe("invalid key");
    reply(null, 500);
    expect((await greyNoiseSource.check("1.2.3.4", signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await greyNoiseSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await greyNoiseSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
