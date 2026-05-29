import { describe, expect, it } from "vitest";
import { hostFromUrl } from "@/lib/url";

describe("hostFromUrl", () => {
  it("extracts a lowercased hostname from a full URL", () => {
    expect(hostFromUrl("https://Evil.Example.com/path?x=1")).toBe(
      "evil.example.com",
    );
  });

  it("keeps an IPv4 host (drops the port)", () => {
    expect(hostFromUrl("http://1.2.3.4:8080/a.exe")).toBe("1.2.3.4");
  });

  it("returns undefined for a scheme-less or garbage string", () => {
    expect(hostFromUrl("evil.example.com/x")).toBeUndefined();
    expect(hostFromUrl("not a url")).toBeUndefined();
    expect(hostFromUrl("")).toBeUndefined();
  });
});
