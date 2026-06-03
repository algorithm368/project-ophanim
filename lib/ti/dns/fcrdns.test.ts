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
