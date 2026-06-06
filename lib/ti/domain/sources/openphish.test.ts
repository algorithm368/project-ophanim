import { describe, expect, it } from "vitest";
import { hostOf } from "./openphish";

describe("hostOf", () => {
  it("extracts a lowercased hostname from a URL", () => {
    expect(hostOf("https://EVIL.com/login")).toBe("evil.com");
    expect(hostOf("  https://sub.evil.com:8080/x  ")).toBe("sub.evil.com");
  });

  it("strips a trailing dot (FQDN form)", () => {
    expect(hostOf("http://evil.com./path")).toBe("evil.com");
  });

  it("returns null for non-URL lines", () => {
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});
