import { describe, expect, it } from "vitest";
import { drawGlobe, GLOBE_H, GLOBE_W } from "@/lib/ti/geo/rail-globe";
import { COUNTRY_CENTRES } from "@/lib/ti/geo/country-centres";

describe("drawGlobe", () => {
  it("turns the globe to a point and draws the point at its centre", () => {
    const d = drawGlobe({ lat: 46.4, lon: 13.02 })!;
    expect(d.point![0]).toBeCloseTo(GLOBE_W / 2, 5);
    expect(d.point![1]).toBeCloseTo(GLOBE_H / 2 - 16, 5);
    expect([d.lat, d.lon]).toEqual([46.4, 13.02]);
    expect(d.country).toBeNull();
    for (const p of [d.sphere, d.graticule, d.land, d.ring]) expect(p).toMatch(/^M/);
  });

  it("turns to a country's centre and shades it when there is no point", () => {
    const d = drawGlobe({ countryCode: "it" })!;
    const [lon, lat] = COUNTRY_CENTRES.IT;
    expect([d.lat, d.lon]).toEqual([lat, lon]);
    expect(d.point).toBeNull();
    expect(d.country).toMatch(/^M/);
  });

  it("still places a country too small for the outline, without shading it", () => {
    const d = drawGlobe({ countryCode: "SG" })!;
    expect([d.lat, d.lon]).toEqual([COUNTRY_CENTRES.SG[1], COUNTRY_CENTRES.SG[0]]);
    expect(d.country).toBeNull();
  });

  it("places a country the atlas has no number for", () => {
    const d = drawGlobe({ countryCode: "XK" })!;
    expect(d.lat).toBe(COUNTRY_CENTRES.XK[1]);
    expect(d.country).toBeNull();
  });

  it("draws nothing for a code it does not know, or for no place at all", () => {
    expect(drawGlobe({ countryCode: "ZZ" })).toBeNull();
    expect(drawGlobe({})).toBeNull();
  });
});
