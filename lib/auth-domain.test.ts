import { describe, expect, it } from "vitest";
import { isAllowedProfile } from "@/lib/auth-domain";

describe("isAllowedProfile", () => {
  it("admits a Workspace account in the allowed domain", () => {
    expect(isAllowedProfile({ hd: "example.com" }, "example.com")).toBe(true);
  });

  it("refuses a Workspace account in another domain", () => {
    expect(isAllowedProfile({ hd: "evil.com" }, "example.com")).toBe(false);
  });

  it("refuses a personal account, which carries no hd claim", () => {
    expect(isAllowedProfile({}, "example.com")).toBe(false);
    expect(isAllowedProfile({ hd: undefined }, "example.com")).toBe(false);
  });

  it("refuses a missing profile", () => {
    expect(isAllowedProfile(null, "example.com")).toBe(false);
    expect(isAllowedProfile(undefined, "example.com")).toBe(false);
  });

  // A misconfigured deployment must lock everyone out rather than let
  // everyone in: an empty allowlist is not an empty gate.
  it("refuses everyone when no domain is configured", () => {
    expect(isAllowedProfile({ hd: "example.com" }, undefined)).toBe(false);
    expect(isAllowedProfile({ hd: "example.com" }, "")).toBe(false);
    expect(isAllowedProfile({ hd: "example.com" }, "   ")).toBe(false);
  });

  it("compares domains case-insensitively, ignoring surrounding space", () => {
    expect(isAllowedProfile({ hd: "Example.COM" }, " example.com ")).toBe(true);
  });

  it("refuses a non-string hd claim", () => {
    expect(isAllowedProfile({ hd: 42 }, "example.com")).toBe(false);
  });
});
