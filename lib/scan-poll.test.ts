import { describe, expect, it } from "vitest";
import { pollIntervalFor } from "@/lib/scan-poll";

describe("pollIntervalFor", () => {
  it("polls tightly while the scan is young", () => {
    expect(pollIntervalFor(0)).toBe(1500);
    expect(pollIntervalFor(9_000)).toBe(1500);
  });

  it("widens once most targets should have landed", () => {
    expect(pollIntervalFor(10_000)).toBe(3000);
    expect(pollIntervalFor(29_000)).toBe(3000);
  });

  it("backs off to the old interval past the expected finish", () => {
    expect(pollIntervalFor(30_000)).toBe(6000);
    expect(pollIntervalFor(120_000)).toBe(6000);
  });

  // A clock that jumps backwards must not produce a zero or negative delay,
  // which would spin the poll loop.
  it("treats a negative age as brand new", () => {
    expect(pollIntervalFor(-5_000)).toBe(1500);
  });
});
