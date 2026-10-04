import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipsumMalicious, ipsumScore, parseIpsum } from "./ipsum";
import { getText } from "@/lib/ti/http";

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getText: vi.fn() };
});

const signal = () => new AbortController().signal;

describe("parseIpsum", () => {
  it("maps ip -> blocklist count and skips comments/blanks", () => {
    const feed = [
      "# IPsum Threat Intelligence Feed",
      "# Last update: ...",
      "",
      "213.209.159.56\t10",
      "1.2.3.4\t3",
    ].join("\n");
    const m = parseIpsum(feed);
    expect(m.size).toBe(2);
    expect(m.get("213.209.159.56")).toBe(10);
    expect(m.get("1.2.3.4")).toBe(3);
  });

  it("ignores malformed lines without a numeric count", () => {
    const m = parseIpsum("not-an-ip\nfoo\tbar\n9.9.9.9\t2");
    expect(m.size).toBe(1);
    expect(m.get("9.9.9.9")).toBe(2);
  });
});

describe("ipsumScore", () => {
  it("scales with list count and caps at 100", () => {
    expect(ipsumScore(1)).toBe(10);
    expect(ipsumScore(5)).toBe(50);
    expect(ipsumScore(20)).toBe(100);
  });
});

describe("ipsumMalicious", () => {
  it("flags only at three or more independent lists", () => {
    expect(ipsumMalicious(1)).toBe(false);
    expect(ipsumMalicious(2)).toBe(false);
    expect(ipsumMalicious(3)).toBe(true);
  });
});

// The loader path, which the parsing tests above never reach. The module keeps
// its feed in a module-level cache with no reset seam, so each case imports a
// fresh copy rather than inheriting the previous one's download.
describe("ipsumSource.check", () => {
  const feed = "# header\n213.209.159.56\t10\n9.9.9.9\t1\n";

  async function freshSource() {
    vi.resetModules();
    const { getText } = await import("@/lib/ti/http");
    const { ipsumSource } = await import("./ipsum");
    return { ipsumSource, getText: vi.mocked(getText) };
  }

  beforeEach(() => {
    vi.mocked(getText).mockReset();
  });

  it("reports an IP the feed lists, weighted by how many lists agree", async () => {
    vi.mocked(getText).mockResolvedValue({ ok: true, status: 200, data: null, text: feed });
    const { ipsumSource } = await freshSource();

    const finding = await ipsumSource.check("213.209.159.56", signal());
    expect(finding.status).toBe("ok");
    expect(finding.malicious).toBe(true);
    expect(finding.score).toBe(100);
    expect(finding.details).toEqual({ blocklistCount: 10 });
  });

  it("reports an IP the feed omits as unlisted, not as an error", async () => {
    vi.mocked(getText).mockResolvedValue({ ok: true, status: 200, data: null, text: feed });
    const { ipsumSource } = await freshSource();

    const finding = await ipsumSource.check("1.1.1.1", signal());
    expect(finding.status).toBe("ok");
    expect(finding.score).toBe(0);
    expect(finding.malicious).toBeUndefined();
  });

  it("downloads once and serves the second lookup from the cached feed", async () => {
    vi.mocked(getText).mockResolvedValue({ ok: true, status: 200, data: null, text: feed });
    const { ipsumSource, getText: mocked } = await freshSource();

    await ipsumSource.check("9.9.9.9", signal());
    await ipsumSource.check("213.209.159.56", signal());
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("returns an error finding rather than throwing when the feed is down", async () => {
    vi.mocked(getText).mockResolvedValue({ ok: false, status: 503, data: null, text: "" });
    const { ipsumSource } = await freshSource();

    const finding = await ipsumSource.check("9.9.9.9", signal());
    expect(finding.status).toBe("error");
    expect(finding.error).toContain("503");
  });
});

describe("ipsumSource edge paths", () => {
  async function freshSource(fail: unknown) {
    vi.resetModules();
    const http = await import("@/lib/ti/http");
    vi.mocked(http.getText).mockRejectedValue(fail);
    return (await import("./ipsum")).ipsumSource;
  }

  it("needs no key", async () => {
    expect((await freshSource(new Error("unused"))).isEnabled()).toBe(true);
  });

  it("maps a timeout and a thrown error", async () => {
    const timedOut = await freshSource(new DOMException("t", "TimeoutError"));
    expect((await timedOut.check("9.9.9.9", signal())).status).toBe("timeout");
    const broken = await freshSource(new Error("boom"));
    expect((await broken.check("9.9.9.9", signal())).error).toBe("boom");
  });
});
