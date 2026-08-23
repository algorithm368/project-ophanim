import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/relative-time";

const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("reads anything under a minute as just now", () => {
    expect(relativeTime(ago(0), NOW)).toBe("just now");
    expect(relativeTime(ago(59 * SECOND), NOW)).toBe("just now");
  });

  it("switches unit on each boundary", () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe("1m ago");
    expect(relativeTime(ago(59 * MINUTE), NOW)).toBe("59m ago");
    expect(relativeTime(ago(HOUR), NOW)).toBe("1h ago");
    expect(relativeTime(ago(23 * HOUR), NOW)).toBe("23h ago");
    expect(relativeTime(ago(DAY), NOW)).toBe("1d ago");
    expect(relativeTime(ago(29 * DAY), NOW)).toBe("29d ago");
    expect(relativeTime(ago(30 * DAY), NOW)).toBe("1mo ago");
    expect(relativeTime(ago(364 * DAY), NOW)).toBe("12mo ago");
    expect(relativeTime(ago(365 * DAY), NOW)).toBe("1y ago");
    expect(relativeTime(ago(800 * DAY), NOW)).toBe("2y ago");
  });

  it("floors rather than rounds, so nothing reads older than it is", () => {
    expect(relativeTime(ago(119 * SECOND), NOW)).toBe("1m ago");
  });

  // The stamp is written by the server and read by the browser, so a clock a
  // few seconds ahead is routine and must not render as a negative age.
  it("treats a future stamp as just now", () => {
    expect(relativeTime(new Date(NOW + 5 * MINUTE).toISOString(), NOW)).toBe(
      "just now",
    );
  });

  it("accepts a number or a Date, not only an ISO string", () => {
    expect(relativeTime(NOW - 2 * HOUR, NOW)).toBe("2h ago");
    expect(relativeTime(new Date(NOW - 2 * DAY), NOW)).toBe("2d ago");
  });

  it("says unknown rather than NaN for an unparseable stamp", () => {
    expect(relativeTime("not a date", NOW)).toBe("unknown");
  });
});
