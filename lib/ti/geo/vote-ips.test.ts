import { describe, expect, it } from "vitest";
import type { Confidence, GeoResolution } from "../types";
import { voteAcrossIps, type IpGeoVote } from "./vote-ips";

/** Minimal per-IP GeoResolution factory: just what voteAcrossIps reads. */
function res(
  country: string,
  opts?: { countryCode?: string; city?: string; confidence?: Confidence },
): GeoResolution {
  const confidence = opts?.confidence ?? "high";
  return {
    country: { value: country, confidence, score: 1, agreement: 1, sources: ["ip-api"] },
    countryCode: opts?.countryCode,
    city: opts?.city
      ? { value: opts.city, confidence, score: 1, agreement: 1, sources: ["ip-api"] }
      : undefined,
    flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
    providerCount: 1,
  };
}

function vote(ip: string, resolution: GeoResolution): IpGeoVote {
  return { ip, resolution };
}

describe("voteAcrossIps", () => {
  it("returns undefined with no votes", () => {
    expect(voteAcrossIps([])).toBeUndefined();
  });

  it("a single resolved IP is a unanimous, high-confidence vote", () => {
    const out = voteAcrossIps([
      vote("1.2.3.4", res("Singapore", { countryCode: "SG", city: "Singapore" })),
    ])!;
    expect(out.country?.value).toBe("Singapore");
    expect(out.country?.confidence).toBe("high");
    expect(out.country?.sources).toEqual(["1.2.3.4"]);
    expect(out.countryCode).toBe("SG");
    expect(out.city?.value).toBe("Singapore");
    expect(out.providerCount).toBe(1);
  });

  it("multiple IPs agreeing on country is high confidence, with dissent recorded", () => {
    const out = voteAcrossIps([
      vote("1.1.1.1", res("Singapore", { countryCode: "SG" })),
      vote("2.2.2.2", res("Singapore", { countryCode: "SG" })),
      vote("3.3.3.3", res("United States", { countryCode: "US" })),
    ])!;
    expect(out.country?.value).toBe("Singapore");
    expect(out.country?.sources.sort()).toEqual(["1.1.1.1", "2.2.2.2"]);
    expect(out.country?.confidence).toBe("medium");
    expect(out.country?.alternatives).toEqual([
      { value: "United States", sources: ["3.3.3.3"] },
    ]);
  });

  it("drops an IP whose own provider vote was low confidence", () => {
    const out = voteAcrossIps([
      vote("1.1.1.1", res("Singapore", { countryCode: "SG" })),
      vote("2.2.2.2", res("Netherlands", { countryCode: "NL", confidence: "low" })),
    ])!;
    expect(out.country?.value).toBe("Singapore");
    expect(out.country?.sources).toEqual(["1.1.1.1"]);
    expect(out.country?.alternatives).toBeUndefined();
  });

  it("returns undefined when every IP was low confidence", () => {
    const out = voteAcrossIps([
      vote("1.1.1.1", res("Singapore", { confidence: "low" })),
    ]);
    expect(out).toBeUndefined();
  });

  it("sets city only when the winning IPs agree on the same one", () => {
    const agree = voteAcrossIps([
      vote("1.1.1.1", res("Singapore", { city: "Singapore" })),
      vote("2.2.2.2", res("Singapore", { city: "Singapore" })),
    ])!;
    expect(agree.city?.value).toBe("Singapore");

    const disagree = voteAcrossIps([
      vote("1.1.1.1", res("United States", { city: "Ashburn" })),
      vote("2.2.2.2", res("United States", { city: "Chicago" })),
    ])!;
    expect(disagree.country?.value).toBe("United States");
    expect(disagree.city).toBeUndefined();
  });

  it("does not treat a missing city as agreeing with a reported one", () => {
    const out = voteAcrossIps([
      vote("1.1.1.1", res("Singapore", { city: "Singapore" })),
      // No city at all from this IP's own resolution — silence, not agreement.
      vote("2.2.2.2", res("Singapore")),
    ])!;
    expect(out.country?.value).toBe("Singapore");
    expect(out.city).toBeUndefined();
  });

  it("breaks a tied vote deterministically instead of by arrival order", () => {
    const first = voteAcrossIps([
      vote("1.1.1.1", res("United States", { countryCode: "US" })),
      vote("2.2.2.2", res("Singapore", { countryCode: "SG" })),
    ])!;
    const reversed = voteAcrossIps([
      vote("2.2.2.2", res("Singapore", { countryCode: "SG" })),
      vote("1.1.1.1", res("United States", { countryCode: "US" })),
    ])!;
    expect(first.country?.value).toBe(reversed.country?.value);
  });

  it("a code-only and a name-only vote for the same country merge instead of splitting", () => {
    const out = voteAcrossIps([
      vote("1.1.1.1", res("", { countryCode: "SG" })),
      vote("2.2.2.2", res("Singapore")),
    ])!;
    expect(out.country?.sources.sort()).toEqual(["1.1.1.1", "2.2.2.2"]);
    expect(out.country?.alternatives).toBeUndefined();
    expect(out.country?.value).toBe("Singapore");
  });
});

describe("voteAcrossIps — votes with too little to count", () => {
  it("skips an IP with no country at all", () => {
    const none: GeoResolution = { ...res("x"), country: undefined };
    expect(voteAcrossIps([vote("1.1.1.1", none)])).toBeUndefined();
  });

  it("skips a qualifying vote with neither a name nor a code", () => {
    expect(voteAcrossIps([vote("1.1.1.1", res(""))])).toBeUndefined();
  });

  it("labels a code-only winner and loser by their codes", () => {
    const r = voteAcrossIps([
      vote("1.1.1.1", res("", { countryCode: "DE" })),
      vote("1.1.1.2", res("", { countryCode: "DE" })),
      vote("1.1.1.3", res("", { countryCode: "FR" })),
    ]);
    expect(r?.country).toMatchObject({ value: "DE", alternatives: [{ value: "FR" }] });
  });
});
