import { describe, expect, it } from "vitest";
import { decode } from "./surbl";

describe("decode (SURBL bitmask)", () => {
  it("decodes a single-list bit", () => {
    expect(decode("127.0.0.8")).toEqual({ labels: ["phishing"], malicious: true });
    expect(decode("127.0.0.16")).toEqual({ labels: ["malware"], malicious: true });
  });

  it("decodes a combined bitmask", () => {
    // 24 = 8 (phishing) | 16 (malware)
    expect(decode("127.0.0.24")).toEqual({
      labels: ["phishing", "malware"],
      malicious: true,
    });
  });

  it("returns null for the refused sentinel and non-127.0.0.x answers", () => {
    expect(decode("127.0.0.255")).toBeNull();
    expect(decode("127.0.0.0")).toBeNull();
    expect(decode("8.8.8.8")).toBeNull();
  });

  it("labels an unknown but non-zero mask without marking malicious", () => {
    expect(decode("127.0.0.2")).toEqual({
      labels: ["listed (mask 2)"],
      malicious: false,
    });
  });
});
