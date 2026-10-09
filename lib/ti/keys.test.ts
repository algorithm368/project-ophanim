import { afterEach, describe, expect, it } from "vitest";
import { apiKey, currentLane, hasOwnKey, keyFingerprint, withLane } from "./keys";

afterEach(() => {
  delete process.env.TEST_KEY;
  delete process.env.TEST_KEY_BULK;
});

describe("lanes and keys", () => {
  it("defaults to the check lane", () => {
    expect(currentLane()).toBe("check");
  });

  it("prefers the lane's own key, then the shared one", async () => {
    process.env.TEST_KEY = "shared";
    expect(apiKey("TEST_KEY")).toBe("shared");
    await withLane("bulk", async () => {
      expect(currentLane()).toBe("bulk");
      expect(apiKey("TEST_KEY")).toBe("shared");
      process.env.TEST_KEY_BULK = " own ";
      expect(apiKey("TEST_KEY")).toBe("own");
      expect(hasOwnKey("TEST_KEY", "bulk")).toBe(true);
    });
    expect(apiKey("TEST_KEY")).toBe("shared");
    expect(hasOwnKey("TEST_KEY", "check")).toBe(false);
  });

  it("treats blanks and a missing env name as unset", () => {
    process.env.TEST_KEY = "  ";
    expect(apiKey("TEST_KEY")).toBeUndefined();
    expect(apiKey(undefined)).toBeUndefined();
  });

  it("fingerprints without revealing the key", () => {
    expect(keyFingerprint("abc")).toBe("ba7816bf");
  });
});
