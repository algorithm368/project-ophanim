import { describe, expect, it } from "vitest";
import { reversePointer, verifyFcrdns } from "./fcrdns";

describe("reversePointer", () => {
  it("builds the in-addr.arpa name for IPv4", () => {
    expect(reversePointer("8.8.4.4")).toBe("4.4.8.8.in-addr.arpa");
  });
});

describe("verifyFcrdns", () => {
  it("verified when forward resolution includes the original IP", async () => {
    const res = await verifyFcrdns(
      "8.8.4.4",
      async (name, type) =>
        type === "PTR" ? ["dns.google"] : name === "dns.google" ? ["8.8.4.4", "8.8.8.8"] : [],
    );
    expect(res).toEqual({ hostname: "dns.google", verified: true });
  });

  it("unverified when forward resolution does not include the IP", async () => {
    const res = await verifyFcrdns(
      "1.2.3.4",
      async (_name, type) => (type === "PTR" ? ["evil.example.com"] : ["9.9.9.9"]),
    );
    expect(res).toEqual({ hostname: "evil.example.com", verified: false });
  });

  it("null when there is no PTR", async () => {
    const res = await verifyFcrdns("1.2.3.4", async () => []);
    expect(res).toBeNull();
  });
});

describe("reversePointer — IPv6", () => {
  it("builds the ip6.arpa nibble name", () => {
    // 32 nibbles, reversed, dot-separated.
    expect(reversePointer("2001:db8::1")).toBe(
      "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa",
    );
  });

  it("produces the same name for any spelling of one address", () => {
    expect(reversePointer("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe(
      reversePointer("2001:db8::1"),
    );
  });
});

describe("verifyFcrdns — IPv6", () => {
  it("queries AAAA (not A) for a v6 address", async () => {
    const seen: string[] = [];
    await verifyFcrdns("2001:4860:4860::8888", async (_name, type) => {
      seen.push(type);
      return type === "PTR" ? ["dns.google"] : ["2001:4860:4860::8888"];
    });
    expect(seen).toEqual(["PTR", "AAAA"]);
  });

  it("verified when the forward answer is the same address, spelled differently", async () => {
    // The bug this guards: raw string equality would call this unverified.
    const res = await verifyFcrdns("2001:4860:4860::8888", async (_name, type) =>
      type === "PTR"
        ? ["dns.google"]
        : ["2001:4860:4860:0000:0000:0000:0000:8888"],
    );
    expect(res).toEqual({ hostname: "dns.google", verified: true });
  });

  it("unverified when the forward answer is a different v6 address", async () => {
    const res = await verifyFcrdns("2001:db8::1", async (_name, type) =>
      type === "PTR" ? ["evil.example.com"] : ["2001:db8::2"],
    );
    expect(res).toEqual({ hostname: "evil.example.com", verified: false });
  });
});
