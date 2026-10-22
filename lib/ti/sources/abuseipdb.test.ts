import { afterEach, describe, expect, it, vi } from "vitest";
import { abuseIpdbSource, categoryBreakdown, reportLog, summarizeAbuse } from "./abuseipdb";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("categoryBreakdown", () => {
  it("tallies category ids into named buckets, most-reported first", () => {
    expect(
      categoryBreakdown([
        { categories: [22, 18] }, // SSH, Brute-Force
        { categories: [22] }, // SSH
        { categories: [21] }, // Web App Attack
      ]),
    ).toEqual([
      { name: "SSH", count: 2 },
      { name: "Brute-Force", count: 1 },
      { name: "Web App Attack", count: 1 },
    ]);
  });

  it("labels unknown ids and tolerates empty input", () => {
    expect(categoryBreakdown([{ categories: [99] }])).toEqual([
      { name: "Category 99", count: 1 },
    ]);
    expect(categoryBreakdown(null)).toEqual([]);
  });
});

describe("summarizeAbuse", () => {
  it("flags malicious at high confidence and lists tor + usage categories", () => {
    expect(
      summarizeAbuse({
        abuseConfidenceScore: 87,
        totalReports: 12,
        isTor: true,
        usageType: "Data Center/Web Hosting/Transit",
      }),
    ).toEqual({
      score: 87,
      malicious: true,
      categories: ["tor", "Data Center/Web Hosting/Transit"],
      summary: "87% abuse confidence from 12 report(s)",
    });
  });

  it("treats an empty record as clean with no categories", () => {
    expect(summarizeAbuse({})).toEqual({
      score: 0,
      malicious: false,
      categories: [],
      summary: "0% abuse confidence from 0 report(s)",
    });
  });

  it("uses 75% as the malicious threshold for a definitive listing", () => {
    expect(summarizeAbuse({ abuseConfidenceScore: 74 }).malicious).toBe(false);
    expect(summarizeAbuse({ abuseConfidenceScore: 75 }).malicious).toBe(true);
  });

  it("headlines the top report reasons and adds them to categories", () => {
    const r = summarizeAbuse({
      abuseConfidenceScore: 92,
      totalReports: 3,
      reports: [{ categories: [22] }, { categories: [22] }, { categories: [18] }],
    });
    expect(r.summary).toBe(
      "92% abuse confidence from 3 report(s) for SSH, Brute-Force",
    );
    expect(r.categories).toEqual(["ssh", "brute-force"]);
  });
});

describe("reportLog", () => {
  it("tallies reports per day and dates the first when the list is complete", () => {
    expect(
      reportLog({
        totalReports: 3,
        reports: [
          { reportedAt: "2026-09-17T22:17:21+00:00" },
          { reportedAt: "2026-09-17T01:00:00+00:00" },
          { reportedAt: "2026-08-31T18:08:32+00:00" },
        ],
      }),
    ).toEqual({
      days: [
        { day: "2026-08-31", count: 1 },
        { day: "2026-09-17", count: 2 },
      ],
      itemized: 3,
      firstReported: "2026-08-31T18:08:32+00:00",
    });
  });

  it("withholds the first report when verbose cut the list short", () => {
    const log = reportLog({
      totalReports: 364,
      reports: [{ reportedAt: "2026-10-04T10:02:58+00:00" }, { reportedAt: "2026-09-18T23:09:31+00:00" }],
    });
    expect(log?.itemized).toBe(2);
    expect(log?.firstReported).toBeUndefined();
  });

  it("returns nothing when no report is dated", () => {
    expect(reportLog({ totalReports: 1, reports: [{ categories: [22] }] })).toBeUndefined();
    expect(reportLog({})).toBeUndefined();
  });
});

describe("abuseIpdbSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("ABUSEIPDB_API_KEY", "");
    expect(abuseIpdbSource.isEnabled()).toBe(false);
    expect(await abuseIpdbSource.check("1.2.3.4", signal)).toEqual({ status: "skipped" });
  });

  it("maps a reported IP with hostnames, geo and a dated report log", async () => {
    vi.stubEnv("ABUSEIPDB_API_KEY", "k");
    expect(abuseIpdbSource.isEnabled()).toBe(true);
    reply({
      data: {
        abuseConfidenceScore: 100,
        totalReports: 2,
        numDistinctUsers: 2,
        isp: "Example ISP",
        countryCode: "CN",
        isWhitelisted: false,
        lastReportedAt: "2026-01-02T00:00:00Z",
        hostnames: ["a.example", "a.example", ""],
        reports: [
          { categories: [22], reportedAt: "2026-01-02T00:00:00Z" },
          { categories: [18, 22], reportedAt: "2026-01-01T00:00:00Z" },
        ],
      },
    });
    const f = await abuseIpdbSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({
      malicious: true,
      allowlisted: false,
      score: 100,
      geo: { isp: "Example ISP", countryCode: "CN" },
      relations: [{ value: "a.example", type: "domain", relation: "rDNS" }],
      details: {
        reportWindowDays: 90,
        firstReported: "2026-01-01T00:00:00Z",
        hostnames: ["a.example", "a.example", ""],
      },
    });
  });

  it("leaves optional context out of a bare answer", async () => {
    vi.stubEnv("ABUSEIPDB_API_KEY", "k");
    reply({ data: { abuseConfidenceScore: 0, hostnames: [] } });
    const f = await abuseIpdbSource.check("1.2.3.4", signal);
    expect(f.geo).toBeUndefined();
    expect(f.relations).toBeUndefined();
    expect(f.details).toMatchObject({
      reportCategories: undefined,
      reportWindowDays: undefined,
      hostnames: undefined,
    });
    reply({ data: { countryCode: "US" } });
    expect((await abuseIpdbSource.check("1.2.3.4", signal)).geo).toEqual({ countryCode: "US" });
  });

  it("surfaces the API's error detail, the status, timeouts and errors", async () => {
    vi.stubEnv("ABUSEIPDB_API_KEY", "k");
    reply({ errors: [{ detail: "Daily limit" }] }, 429);
    expect((await abuseIpdbSource.check("1.2.3.4", signal)).error).toBe("Daily limit");
    reply(null, 500);
    expect((await abuseIpdbSource.check("1.2.3.4", signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await abuseIpdbSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await abuseIpdbSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});

describe("abuseipdb sparse reports", () => {
  it("skips reports without categories", () => {
    expect(categoryBreakdown([{}])).toEqual([]);
  });

  it("treats a missing total as a complete list", () => {
    expect(reportLog({ reports: [{ reportedAt: "2026-01-01T00:00:00Z" }] })?.firstReported).toBe(
      "2026-01-01T00:00:00Z",
    );
  });
});
