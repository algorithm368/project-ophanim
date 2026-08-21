import { afterEach, describe, expect, it, vi } from "vitest";
import { dshieldFinding, dshieldSource, feedWindow } from "@/lib/ti/sources/dshield";
import { getJson } from "@/lib/ti/http";

describe("feedWindow", () => {
  it("takes the earliest first-seen and the latest last-seen across feeds", () => {
    // The live shape for 71.6.146.185: many feeds, each with its own window.
    const w = feedWindow({
      blocklistde110: { firstseen: "2016-05-13", lastseen: "2026-08-20" },
      blocklistde22: { firstseen: "2016-04-10", lastseen: "2026-08-19" },
      ciarmy: { firstseen: "2020-01-01", lastseen: "2021-02-03" },
    });
    expect(w.firstSeen).toBe("2016-04-10");
    expect(w.lastSeen).toBe("2026-08-20");
    expect(w.names).toEqual(["blocklistde110", "blocklistde22", "ciarmy"]);
  });

  it("ignores a feed with no usable dates without dropping its name", () => {
    const w = feedWindow({ mystery: {}, dated: { lastseen: "2026-01-01" } });
    expect(w.names).toEqual(["dated", "mystery"]);
    expect(w.lastSeen).toBe("2026-01-01");
    expect(w.firstSeen).toBeUndefined();
  });

  it("is empty for an address on no feed", () => {
    expect(feedWindow(undefined)).toEqual({ names: [], firstSeen: undefined, lastSeen: undefined });
  });
});

describe("dshieldFinding", () => {
  it("dates the claim, which is the reason this source exists", () => {
    // Only about a third of the sources that report something adverse date it.
    const f = dshieldFinding({
      threatfeeds: { blocklistde: { firstseen: "2016-05-13", lastseen: "2026-08-20" } },
    });
    expect(f.lastSeen).toBe("2026-08-20");
    expect(f.summary).toContain("Tracked on 1 threat feed");
    expect(f.summary).toContain("seen 2016-05-13 to 2026-08-20");
  });

  it("never scores, so it cannot count another feed's evidence twice", () => {
    // The threatfeeds map is largely other people's blocklists, several of
    // which this app queries directly.
    const f = dshieldFinding({
      threatfeeds: { blocklistde: { lastseen: "2026-08-20" } },
      count: 900,
      attacks: 40,
    });
    expect(f.score).toBeUndefined();
    expect(f.malicious).toBeUndefined();
  });

  it("carries the network's abuse contact and announced CIDR", () => {
    const f = dshieldFinding({
      as: 10439,
      asname: "CARINET",
      assize: 106752,
      network: "71.6.128.0/17",
      asabusecontact: "complaints@cari.net",
    });
    expect(f.details).toMatchObject({
      asn: "AS10439",
      asName: "CARINET",
      network: "71.6.128.0/17",
      abuseContact: "complaints@cari.net",
    });
  });

  it("reports sensor activity separately from feed sightings", () => {
    const f = dshieldFinding({ count: 1365, attacks: 12 });
    expect(f.summary).toContain("1365 DShield sensor reports");
    expect(f.details).toMatchObject({ sensorReports: 1365, sensorTargets: 12 });
  });

  it("says so plainly when there is no record", () => {
    // The live response for an unknown address is all nulls, not a 404.
    const f = dshieldFinding({ count: null, attacks: null, maxdate: null, as: 0 });
    expect(f.summary).toBe("No DShield record");
    expect(f.lastSeen).toBeUndefined();
    expect(f.details).toBeUndefined();
  });

  it("rejects an unparseable date rather than passing it through", () => {
    const f = dshieldFinding({ threatfeeds: { odd: { lastseen: "not a date" } } });
    expect(f.lastSeen).toBeUndefined();
  });
});

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn() };
});

describe("dshieldSource.check", () => {
  const signal = () => new AbortController().signal;
  afterEach(() => vi.mocked(getJson).mockReset());

  it("passes a live record through to the finding", async () => {
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ip: { threatfeeds: { blocklistde: { lastseen: "2026-08-20" } } } },
      text: "",
    });
    const f = await dshieldSource.check("71.6.146.185", signal());
    expect(f.status).toBe("ok");
    expect(f.lastSeen).toBe("2026-08-20");
  });

  it("treats the documented 429 as a rate limit, not a failure", async () => {
    // The published guidance is to back off for five minutes on a 429, so it is
    // a quota condition and must not read as a broken source.
    vi.mocked(getJson).mockResolvedValue({ ok: false, status: 429, data: null, text: "" });
    const f = await dshieldSource.check("1.2.3.4", signal());
    expect(f.status).toBe("rate_limited");
  });

  it("reports a bad response as an error", async () => {
    vi.mocked(getJson).mockResolvedValue({ ok: false, status: 500, data: null, text: "" });
    expect((await dshieldSource.check("1.2.3.4", signal())).status).toBe("error");
    // A 200 with no `ip` object is not a record, so it must not read as one.
    vi.mocked(getJson).mockResolvedValue({ ok: true, status: 200, data: {}, text: "" });
    expect((await dshieldSource.check("1.2.3.4", signal())).status).toBe("error");
  });

  it("never throws out of check()", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("network down"));
    expect((await dshieldSource.check("1.2.3.4", signal())).status).toBe("error");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await dshieldSource.check("1.2.3.4", signal())).status).toBe("timeout");
  });
});
