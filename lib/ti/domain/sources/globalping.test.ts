import { afterEach, describe, expect, it, vi } from "vitest";
import { globalpingSource } from "./globalping";
import { getJson, postJson } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, postJson: vi.fn(), getJson: vi.fn() };
});

const mockPostJson = vi.mocked(postJson);
const mockGetJson = vi.mocked(getJson);
const SIGNAL = new AbortController().signal;

const created = (id: string) =>
  ({ ok: true, status: 202, data: { id, probesCount: 2 } }) as Awaited<ReturnType<typeof postJson>>;

function finished(results: unknown[]) {
  return {
    ok: true,
    status: 200,
    data: { id: "m1", status: "finished", probesCount: results.length, results },
  } as Awaited<ReturnType<typeof getJson>>;
}

const probeResult = (
  probe: { city?: string; country?: string; continent?: string },
  ips: string[] | null,
) => ({
  probe,
  result: {
    status: ips === null ? "failed" : "finished",
    statusCodeName: "NOERROR",
    answers: (ips ?? []).map((v) => ({ type: "A", value: v })),
  },
});

describe("globalpingSource.check", () => {
  afterEach(() => {
    mockPostJson.mockReset();
    mockGetJson.mockReset();
  });

  it("reports agreement when every probe resolves the same IP", async () => {
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson.mockResolvedValue(
      finished([
        probeResult({ city: "Frankfurt", country: "DE" }, ["1.2.3.4"]),
        probeResult({ city: "Tokyo", country: "JP" }, ["1.2.3.4"]),
      ]),
    );

    const f = await globalpingSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.summary).toContain("2 of 2 global probes agree on 1.2.3.4");
  });

  it("reports a split when regions see different IPs", async () => {
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson.mockResolvedValue(
      finished([
        probeResult({ city: "Frankfurt", country: "DE" }, ["1.2.3.4"]),
        probeResult({ city: "Sydney", country: "AU" }, ["9.9.9.9"]),
      ]),
    );

    const f = await globalpingSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.summary).toContain("Global probes split");
  });

  it("polls again while the measurement is still in-progress", async () => {
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { id: "m1", status: "in-progress", probesCount: 1, results: [] },
      } as Awaited<ReturnType<typeof getJson>>)
      .mockResolvedValueOnce(finished([probeResult({ country: "DE" }, ["1.2.3.4"])]));

    const f = await globalpingSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(mockGetJson).toHaveBeenCalledTimes(2);
  });

  it("reports rate_limited on a 429 from measurement creation", async () => {
    mockPostJson.mockResolvedValue({
      ok: false,
      status: 429,
      data: null,
    } as Awaited<ReturnType<typeof postJson>>);
    const f = await globalpingSource.check("example.com", SIGNAL);
    expect(f.status).toBe("rate_limited");
  });

  it("reports no finding when every probe's test itself fails", async () => {
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson.mockResolvedValue(
      finished([probeResult({ country: "DE" }, null), probeResult({ country: "JP" }, null)]),
    );
    const f = await globalpingSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.summary).toContain("No Globalping probe returned a usable answer");
  });
});

describe("globalpingSource.check — remaining paths", () => {
  afterEach(() => {
    vi.useRealTimers();
    mockPostJson.mockReset();
    mockGetJson.mockReset();
  });
  const inProgress = {
    ok: true,
    status: 200,
    data: { id: "m1", status: "in-progress", probesCount: 1, results: [] },
  } as Awaited<ReturnType<typeof getJson>>;

  it("needs no key", () => expect(globalpingSource.isEnabled()).toBe(true));

  it("labels probes by continent or not at all, and ignores non-A answers", async () => {
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson.mockResolvedValue(
      finished([
        { probe: { continent: "EU" }, result: { status: "finished" } },
        {
          probe: {},
          result: { status: "finished", answers: [{ type: "CNAME", value: "x" }, { type: "A" }] },
        },
      ]),
    );
    const f = await globalpingSource.check("example.com", SIGNAL);
    expect(f.summary).toBe("2 of 2 global probes agree on no A record (NXDOMAIN/empty)");
    expect(f.details?.probes).toEqual([
      { resolver: "EU", ips: [] },
      { resolver: "unknown probe", ips: [] },
    ]);
  });

  it("says no A record when a split has no consensus IPs", async () => {
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson.mockResolvedValue(
      finished([
        probeResult({ country: "DE" }, ["1.1.1.1"]),
        probeResult({ country: "JP" }, ["2.2.2.2"]),
        probeResult({ country: "US" }, ["3.3.3.3"]),
        probeResult({ country: "BR" }, []),
      ]),
    );
    const f = await globalpingSource.check("example.com", SIGNAL);
    expect(f.summary).toMatch(/^Global probes split/);
  });

  it("keeps polling past an empty poll body", async () => {
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson
      .mockResolvedValueOnce({ ok: true, status: 200, data: null } as Awaited<ReturnType<typeof getJson>>)
      .mockResolvedValueOnce(finished([probeResult({ country: "DE" }, ["1.2.3.4"])]));
    expect((await globalpingSource.check("example.com", SIGNAL)).status).toBe("ok");
  });

  it("times out when the measurement outlives its deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson.mockImplementation(async () => {
      vi.setSystemTime(start + 60_000);
      return inProgress;
    });
    expect((await globalpingSource.check("example.com", SIGNAL)).status).toBe("timeout");
  });

  it("stops waiting between polls when the caller aborts", async () => {
    const controller = new AbortController();
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson.mockImplementation(async () => {
      setTimeout(() => controller.abort(), 0);
      return inProgress;
    });
    expect((await globalpingSource.check("example.com", controller.signal)).status).toBe(
      "timeout",
    );
  });

  it("errors when creation or polling fails, or the request throws", async () => {
    mockPostJson.mockResolvedValue({ ok: false, status: 400, data: null } as Awaited<
      ReturnType<typeof postJson>
    >);
    expect((await globalpingSource.check("example.com", SIGNAL)).error).toBe(
      "Globalping create failed: HTTP 400",
    );
    mockPostJson.mockResolvedValue({ ok: true, status: 202, data: {} } as Awaited<
      ReturnType<typeof postJson>
    >);
    expect((await globalpingSource.check("example.com", SIGNAL)).status).toBe("error");
    mockPostJson.mockResolvedValue(created("m1"));
    mockGetJson.mockResolvedValue({ ok: false, status: 404, data: null } as Awaited<
      ReturnType<typeof getJson>
    >);
    expect((await globalpingSource.check("example.com", SIGNAL)).error).toBe(
      "Globalping poll failed: HTTP 404",
    );
  });
});
