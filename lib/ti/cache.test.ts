import { describe, expect, it } from "vitest";
import { truncateAtReceived } from "@/lib/ti/cache";

describe("truncateAtReceived", () => {
  // The whole point of this function: an Upstash config error quotes the URL it
  // was handed, and a rediss:// URL embeds the password. It must not be logged.
  it("drops the Received tail that would echo the URL", () => {
    expect(
      truncateAtReceived(
        'Invalid URL. Received: "rediss://default:hunter2@eu1.upstash.io:6379"',
      ),
    ).toBe("Invalid URL.");
  });

  it("leaves a message without the tail alone", () => {
    expect(truncateAtReceived("Missing token")).toBe("Missing token");
    expect(truncateAtReceived("")).toBe("");
  });

  it("trims the whitespace that ran up to the tail", () => {
    expect(truncateAtReceived("Bad config   \n Received: x")).toBe("Bad config");
  });

  // Regression guard for the quadratic regex this replaced: a long message with
  // no tail used to be rescanned from every offset.
  it("is linear on a long message with no tail", () => {
    const long = "x".repeat(200_000);
    expect(truncateAtReceived(long)).toBe(long);
  });
});
