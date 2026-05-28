import { describe, expect, it } from "vitest";
import { HASH_ALGO_LABEL, parseHash } from "@/lib/hash";

const MD5 = "44d88612fea8a8f36de82e1278abb02f";
const SHA1 = "3395856ce81f2b7382dee72602f798b642f14140";
const SHA256 =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

describe("parseHash", () => {
  it("classifies by hex length", () => {
    expect(parseHash(MD5)).toEqual({ hash: MD5, algorithm: "md5" });
    expect(parseHash(SHA1)).toEqual({ hash: SHA1, algorithm: "sha1" });
    expect(parseHash(SHA256)).toEqual({ hash: SHA256, algorithm: "sha256" });
  });

  it("lowercases and trims", () => {
    expect(parseHash(`  ${MD5.toUpperCase()}  `)?.hash).toBe(MD5);
  });

  it("drops an algorithm label prefix", () => {
    expect(parseHash(`sha256:${SHA256}`)?.algorithm).toBe("sha256");
    expect(parseHash(`md5:${MD5}`)?.hash).toBe(MD5);
  });

  it.each([
    [`${MD5}a`], // 33 chars
    [MD5.slice(0, 31)], // 31 chars
    ["g".repeat(32)], // non-hex
    ["sha256:"], // empty after prefix
    [""],
  ])("rejects %s", (input) => {
    expect(parseHash(input)).toBeNull();
  });
});

describe("HASH_ALGO_LABEL", () => {
  it("maps algorithms to display labels", () => {
    expect(HASH_ALGO_LABEL.md5).toBe("MD5");
    expect(HASH_ALGO_LABEL.sha1).toBe("SHA-1");
    expect(HASH_ALGO_LABEL.sha256).toBe("SHA-256");
  });
});
