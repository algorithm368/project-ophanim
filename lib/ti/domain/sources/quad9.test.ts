import { describe, expect, it } from "vitest";
import { quad9Verdict } from "./quad9";

describe("quad9Verdict", () => {
  it("flags a domain Quad9 blocks but the control resolves", () => {
    expect(quad9Verdict("nxdomain", "resolves")).toMatchObject({
      status: "ok",
      malicious: true,
      score: 80,
      categories: ["dns-blocked"],
      details: { quad9: "nxdomain", control: "resolves" },
    });
  });

  it("errors only when both resolvers fail", () => {
    expect(quad9Verdict("error", "error").status).toBe("error");
  });

  it("is inconclusive when the control resolver can't resolve the domain", () => {
    const v = quad9Verdict("resolves", "nxdomain");
    expect(v.status).toBe("ok");
    expect(v.score).toBe(0);
    expect(v.malicious).toBeUndefined();
  });

  it("is clean when both resolvers answer", () => {
    const v = quad9Verdict("resolves", "resolves");
    expect(v.status).toBe("ok");
    expect(v.score).toBe(0);
    expect(v.malicious).toBeUndefined();
  });
});
