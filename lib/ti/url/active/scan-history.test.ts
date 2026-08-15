import { describe, expect, it } from "vitest";
import {
  MAX_PREVIOUS,
  rememberBatch,
  summarizeBatch,
} from "@/lib/ti/url/active/scan-history";
import type { ActiveScan, ActiveScanBatch } from "@/lib/ti/url/active/types";

const scan = (
  over: Partial<ActiveScan> & Pick<ActiveScan, "engine">,
): ActiveScan => ({
  target: "https://evil.com/a",
  status: "done",
  ...over,
});

const batch = (over: Partial<ActiveScanBatch> = {}): ActiveScanBatch => ({
  indicator: "evil.com",
  submittedAt: "2026-08-12T09:00:00.000Z",
  scans: [
    scan({
      engine: "urlscan",
      uuid: "u-1",
      resultUrl: "https://urlscan.io/result/u-1/",
      verdict: { malicious: true },
    }),
  ],
  ...over,
});

describe("summarizeBatch", () => {
  it("keeps when, what it said, and how to reopen it, and nothing else", () => {
    // The spec's rule: the latest scan is stored in full, earlier ones shrink
    // to uuid, timestamp and verdict. Keeping details would be an archive.
    expect(summarizeBatch(batch())).toEqual({
      at: "2026-08-12T09:00:00.000Z",
      malicious: true,
      engines: ["urlscan"],
      reports: [
        { engine: "urlscan", uuid: "u-1", resultUrl: "https://urlscan.io/result/u-1/" },
      ],
    });
  });

  it("counts a target malicious when any engine flagged it", () => {
    const summary = summarizeBatch(
      batch({
        scans: [
          scan({ engine: "urlscan", verdict: { malicious: false } }),
          scan({ engine: "cloudflare", verdict: { malicious: true } }),
        ],
      }),
    );
    expect(summary?.malicious).toBe(true);
    expect(summary?.engines).toEqual(["urlscan", "cloudflare"]);
  });

  it("does not record an attempt where nothing finished", () => {
    // A failed submission is not a past reading. Storing it would render as
    // "scanned before, not malicious", which is a claim nobody made.
    expect(
      summarizeBatch(
        batch({ scans: [scan({ engine: "urlscan", status: "error", error: "Rate limited" })] }),
      ),
    ).toBeNull();
    expect(summarizeBatch(batch({ scans: [] }))).toBeNull();
  });
});

describe("rememberBatch", () => {
  it("folds the finished batch into the new one's history", () => {
    const next = rememberBatch(batch(), {
      indicator: "evil.com",
      submittedAt: "2026-08-15T09:00:00.000Z",
      scans: [scan({ engine: "urlscan", status: "running", uuid: "u-2" })],
    });
    expect(next.previous).toEqual([
      {
        at: "2026-08-12T09:00:00.000Z",
        malicious: true,
        engines: ["urlscan"],
        reports: [
          { engine: "urlscan", uuid: "u-1", resultUrl: "https://urlscan.io/result/u-1/" },
        ],
      },
    ]);
    expect(next.scans[0].uuid).toBe("u-2");
  });

  it("carries the older history forward, newest first", () => {
    const older = {
      at: "2026-01-01T00:00:00.000Z",
      malicious: false,
      engines: ["urlscan" as const],
      reports: [],
    };
    const next = rememberBatch(
      batch({ previous: [older] }),
      { indicator: "evil.com", submittedAt: "2026-08-15T09:00:00.000Z", scans: [] },
    );
    expect(next.previous?.map((p) => p.at)).toEqual([
      "2026-08-12T09:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("keeps the history bounded rather than growing an archive", () => {
    const old = Array.from({ length: MAX_PREVIOUS + 3 }, (_, i) => ({
      at: `2026-01-0${(i % 9) + 1}T00:00:00.000Z`,
      malicious: false,
      engines: [],
      reports: [],
    }));
    const next = rememberBatch(batch({ previous: old }), {
      indicator: "evil.com",
      submittedAt: "2026-08-15T09:00:00.000Z",
      scans: [],
    });
    expect(next.previous).toHaveLength(MAX_PREVIOUS);
  });

  it("leaves the new batch alone when there was nothing worth remembering", () => {
    const fresh = {
      indicator: "evil.com",
      submittedAt: "2026-08-15T09:00:00.000Z",
      scans: [],
    };
    expect(rememberBatch(null, fresh)).toEqual(fresh);
    expect(rememberBatch(null, fresh).previous).toBeUndefined();
  });
});
