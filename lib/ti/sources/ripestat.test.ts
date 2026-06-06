import { describe, expect, it } from "vitest";
import { ripestatFinding } from "./ripestat";

describe("ripestatFinding", () => {
  it("summarizes the announced prefix and ASN, and seeds geo.asn", () => {
    const f = ripestatFinding({ prefix: "27.254.104.0/23", asns: ["4750"] });
    expect(f.status).toBe("ok");
    expect(f.summary).toBe("Announced as 27.254.104.0/23 by AS4750");
    expect(f.geo).toEqual({ asn: "AS4750" });
    expect(f.details).toEqual({ prefix: "27.254.104.0/23", asns: ["4750"] });
  });

  it("joins multiple origin ASNs", () => {
    const f = ripestatFinding({ prefix: "1.0.0.0/24", asns: ["13335", "15169"] });
    expect(f.summary).toBe("Announced as 1.0.0.0/24 by AS13335, AS15169");
  });

  it("reports unannounced space when there is no prefix or ASN", () => {
    const f = ripestatFinding({ prefix: undefined, asns: [] });
    expect(f.summary).toBe("Not announced in BGP");
    expect(f.geo).toBeUndefined();
  });
});
