import { describe, expect, it } from "vitest";
import { checkUrlFor, ENDPOINTS } from "@/lib/ti/endpoints";

describe("ENDPOINTS", () => {
  it("covers every IOC kind", () => {
    expect(Object.keys(ENDPOINTS).sort()).toEqual([
      "domain",
      "hash",
      "ip",
      "url",
    ]);
  });

  // The parameter names are what each route's `validate` reads. A GET built
  // with the wrong one is a 400 the caller reads as "nothing known".
  it("names each route's parameter the way that route reads it", () => {
    expect(ENDPOINTS.ip).toEqual({ path: "/api/check", param: "ip" });
    expect(ENDPOINTS.domain).toEqual({
      path: "/api/check-domain",
      param: "domain",
    });
    expect(ENDPOINTS.hash).toEqual({ path: "/api/check-hash", param: "hash" });
    expect(ENDPOINTS.url).toEqual({ path: "/api/check-url", param: "url" });
  });
});

describe("checkUrlFor", () => {
  it("builds the GET url for a kind", () => {
    expect(checkUrlFor("ip", "8.8.8.8")).toBe("/api/check?ip=8.8.8.8");
    expect(checkUrlFor("domain", "example.org")).toBe(
      "/api/check-domain?domain=example.org",
    );
  });

  // A url indicator carries slashes, a query of its own, and possibly a "#".
  // Unencoded, its query string merges into ours and the route sees a
  // truncated indicator.
  it("percent-encodes the indicator", () => {
    expect(checkUrlFor("url", "https://evil.test/a?b=1&c=2")).toBe(
      "/api/check-url?url=https%3A%2F%2Fevil.test%2Fa%3Fb%3D1%26c%3D2",
    );
  });
});
