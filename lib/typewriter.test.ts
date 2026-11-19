import { describe, expect, it } from "vitest";
import { MAX_STEPS, TICK_MS, typingDuration, typingFrom, typingStep } from "@/lib/typewriter";

describe("typingStep", () => {
  it("types a short value one character at a time", () => {
    expect(typingStep(1)).toBe(1);
    expect(typingStep(MAX_STEPS)).toBe(1);
  });

  it("types a long value several characters at a time", () => {
    expect(typingStep(MAX_STEPS + 1)).toBe(2);
    expect(typingStep(400)).toBe(10);
  });

  it("never stalls on an empty value", () => {
    expect(typingStep(0)).toBe(1);
  });
});

describe("typingDuration", () => {
  it("is one tick per character for a word", () => {
    expect(typingDuration(10)).toBe(10 * TICK_MS);
  });

  // The whole point of the step: a summary paragraph must not still be typing
  // long after the page has finished.
  it("never runs past the step cap, however long the value", () => {
    for (const length of [41, 120, 399, 400, 401, 5000]) {
      expect(typingDuration(length)).toBeLessThanOrEqual(MAX_STEPS * TICK_MS);
    }
  });
});

describe("typingFrom", () => {
  it("starts at the beginning when nothing is shown yet", () => {
    expect(typingFrom(undefined, "Amsterdam")).toBe(0);
  });

  it("keeps the run a changed value shares with the old one", () => {
    expect(typingFrom("Amsterdam", "Amsterdam, North Holland")).toBe(9);
    expect(typingFrom("AS49870", "AS49871")).toBe(6);
  });

  it("retypes from the start when the values share nothing", () => {
    expect(typingFrom("none published", "Alsycon B.V.")).toBe(0);
  });

  it("starts at the end when the value did not change", () => {
    expect(typingFrom("ONKIW.STORE", "ONKIW.STORE")).toBe(11);
  });

  it("handles a value that got shorter", () => {
    expect(typingFrom("Amsterdam, NL", "Amsterdam")).toBe(9);
  });
});
