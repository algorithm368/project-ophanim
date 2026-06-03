import { describe, expect, it } from "vitest";
import { selectUncertainIps, transposeByIp } from "./bulk";

describe("transposeByIp", () => {
  it("collects each provider's GeoContext per IP, skipping gaps", () => {
    const perIp = transposeByIp(
      ["1.1.1.1", "8.8.8.8"],
      [
        { id: "ip-api", byIp: new Map([["1.1.1.1", { countryCode: "US" }], ["8.8.8.8", { countryCode: "US" }]]) },
        { id: "ipinfo", byIp: new Map([["1.1.1.1", { countryCode: "AU" }]]) },
      ],
    );
    expect(perIp.get("1.1.1.1")).toEqual([
      { id: "ip-api", geo: { countryCode: "US" } },
      { id: "ipinfo", geo: { countryCode: "AU" } },
    ]);
    expect(perIp.get("8.8.8.8")).toEqual([{ id: "ip-api", geo: { countryCode: "US" } }]);
  });
});

describe("selectUncertainIps", () => {
  it("flags disagreements and single-voter IPs, skips confident agreement", () => {
    const perIp = new Map([
      ["d", [{ id: "a", geo: { countryCode: "US" } }, { id: "b", geo: { countryCode: "AU" } }]],
      ["s", [{ id: "a", geo: { countryCode: "US" } }]],
      ["c", [{ id: "a", geo: { countryCode: "US" } }, { id: "b", geo: { countryCode: "US" } }]],
      ["z", [{ id: "a", geo: { city: "Nowhere" } }]],
    ]);
    const picked = selectUncertainIps(perIp, Infinity);
    expect(picked).toContain("d");
    expect(picked).toContain("s");
    expect(picked).toContain("z");
    expect(picked).not.toContain("c");
    expect(picked[0]).toBe("d");
  });

  it("enforces the max ceiling", () => {
    const perIp = new Map([
      ["a", [{ id: "x", geo: { countryCode: "US" } }]],
      ["b", [{ id: "x", geo: { countryCode: "US" } }]],
      ["c", [{ id: "x", geo: { countryCode: "US" } }]],
    ]);
    expect(selectUncertainIps(perIp, 2)).toHaveLength(2);
  });
});
