import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOTABLE_RANK,
  VOUCH_RANK,
  latestRank,
  trancoFinding,
  trancoSource,
} from "@/lib/ti/domain/sources/tranco";
import { getJson } from "@/lib/ti/http";

describe("latestRank", () => {
  it("takes the most recent entry, not the first in the array", () => {
    expect(
      latestRank([
        { date: "2026-08-17", rank: 30 },
        { date: "2026-08-19", rank: 12 },
        { date: "2026-08-18", rank: 20 },
      ]),
    ).toBe(12);
  });

  it("is undefined for an empty or absent series", () => {
    // The live response for an unknown domain is `{"ranks": [], "domain": ...}`.
    expect(latestRank([])).toBeUndefined();
    expect(latestRank(undefined)).toBeUndefined();
  });

  it("ignores a nonsense rank", () => {
    expect(latestRank([{ date: "2026-08-19", rank: 0 }])).toBeUndefined();
  });
});

describe("trancoFinding", () => {
  it("vouches for a top-ranked domain", () => {
    // google.com returns rank 1 from the live API.
    const f = trancoFinding({ ranks: [{ date: "2026-08-19", rank: 1 }] });
    expect(f.allowlisted).toBe(true);
    expect(f.summary).toContain("Tranco rank 1");
    expect(f.summary).toContain("a top-ranked domain");
  });

  it("reports a middling rank without vouching for it", () => {
    // Being in the top million is not an endorsement. Plenty of the tail exists
    // to host user content.
    const f = trancoFinding({ ranks: [{ date: "2026-08-19", rank: 250_000 }] });
    expect(f.allowlisted).toBe(false);
    expect(f.summary).toContain("250,000");
    expect(f.summary).not.toContain("top-ranked");
  });

  it("treats the vouch threshold as inclusive", () => {
    expect(trancoFinding({ ranks: [{ date: "d", rank: VOUCH_RANK }] }).allowlisted).toBe(true);
    expect(trancoFinding({ ranks: [{ date: "d", rank: VOUCH_RANK + 1 }] }).allowlisted).toBe(false);
  });

  it("says nothing at all about a domain outside the list", () => {
    // Absence is the common case and means nothing: most ordinary domains are
    // not in the top million.
    const f = trancoFinding({ ranks: [], domain: "evil-nonexistent-xyz123.com" });
    expect(f.summary).toBe("Not in the Tranco top million");
    expect(f.allowlisted).toBeUndefined();
    expect(f.score).toBeUndefined();
  });

  it("ignores a rank past the notable cutoff", () => {
    const f = trancoFinding({ ranks: [{ date: "d", rank: NOTABLE_RANK + 1 }] });
    expect(f.summary).toBe("Not in the Tranco top million");
  });

  it("never contributes a risk score in either direction", () => {
    // Popularity is not safety, so it must not move the number.
    const top = trancoFinding({ ranks: [{ date: "d", rank: 1 }] });
    expect(top.score).toBe(0);
    expect(top.malicious).toBeUndefined();
  });
});

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn() };
});

describe("trancoSource.check", () => {
  const signal = () => new AbortController().signal;
  afterEach(() => vi.mocked(getJson).mockReset());

  it("passes a live rank through to the finding", async () => {
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { domain: "google.com", ranks: [{ date: "2026-08-19", rank: 1 }] },
      text: "",
    });
    const f = await trancoSource.check("google.com", signal());
    expect(f.allowlisted).toBe(true);
  });

  it("reports a rate limit as one", async () => {
    vi.mocked(getJson).mockResolvedValue({ ok: false, status: 429, data: null, text: "" });
    expect((await trancoSource.check("x.com", signal())).status).toBe("rate_limited");
  });

  it("never throws out of check()", async () => {
    vi.mocked(getJson).mockResolvedValue({ ok: false, status: 503, data: null, text: "" });
    expect((await trancoSource.check("x.com", signal())).status).toBe("error");
    vi.mocked(getJson).mockRejectedValue(new Error("dns fail"));
    expect((await trancoSource.check("x.com", signal())).status).toBe("error");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await trancoSource.check("x.com", signal())).status).toBe("timeout");
  });
});

describe("trancoSource.isEnabled", () => {
  it("needs no key", () => expect(trancoSource.isEnabled()).toBe(true));
});
