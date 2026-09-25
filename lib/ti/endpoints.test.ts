import { describe, expect, it } from "vitest";
import { checkUrlFor, ENDPOINTS } from "@/lib/ti/endpoints";

describe("ENDPOINTS", () => {
  it("covers every IOC kind", () => {
    expect(Object.keys(ENDPOINTS).sort()).toEqual([
      "domain",
      "hash",
      "ip",
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
  });
});

describe("checkUrlFor", () => {
  it("builds the GET url for a kind", () => {
    expect(checkUrlFor("ip", "8.8.8.8")).toBe("/api/check?ip=8.8.8.8");
    expect(checkUrlFor("domain", "example.org")).toBe(
      "/api/check-domain?domain=example.org",
    );
  });

  // Unencoded, a "&" or "#" in the indicator would merge into our own query
  // string and the route would see a truncated indicator.
  it("percent-encodes the indicator", () => {
    expect(checkUrlFor("domain", "a&b#c")).toBe(
      "/api/check-domain?domain=a%26b%23c",
    );
  });
});
