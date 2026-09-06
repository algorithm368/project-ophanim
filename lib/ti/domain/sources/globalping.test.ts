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
