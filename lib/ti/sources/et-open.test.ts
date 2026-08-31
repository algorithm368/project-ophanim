import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCompromisedFeed } from "./et-open";
import { getText } from "@/lib/ti/http";

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getText: vi.fn() };
});

const signal = () => new AbortController().signal;

describe("parseCompromisedFeed", () => {
  it("collects IPs, skipping comments and blank lines and trimming", () => {
    const set = parseCompromisedFeed(
      ["# header", "1.2.3.4", "", "  5.6.7.8  ", "#trailing"].join("\n"),
    );
    expect([...set]).toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  it("dedupes repeated IPs", () => {
    expect(parseCompromisedFeed("1.1.1.1\n1.1.1.1").size).toBe(1);
  });
});

// The loader path, which the parsing tests above never reach. The module keeps
// its feed in a module-level cache with no reset seam, so each case imports a
// fresh copy rather than inheriting the previous one's download.
describe("etOpenSource.check", () => {
  const feed = "# header\n1.2.3.4\n5.6.7.8\n";

  async function freshSource() {
    vi.resetModules();
    const { getText } = await import("@/lib/ti/http");
    const { etOpenSource } = await import("./et-open");
    return { etOpenSource, getText: vi.mocked(getText) };
  }

  beforeEach(() => {
    vi.mocked(getText).mockReset();
  });

  it("reports a listed IP as a known compromised host", async () => {
    vi.mocked(getText).mockResolvedValue({ ok: true, status: 200, data: null, text: feed });
    const { etOpenSource } = await freshSource();

    const finding = await etOpenSource.check("1.2.3.4", signal());
    expect(finding.status).toBe("ok");
    expect(finding.malicious).toBe(true);
    expect(finding.score).toBe(85);
    expect(finding.details).toEqual({ list: "compromised-ips", listSize: 2 });
  });

  it("reports an unlisted IP as unlisted, not as an error", async () => {
    vi.mocked(getText).mockResolvedValue({ ok: true, status: 200, data: null, text: feed });
    const { etOpenSource } = await freshSource();

    const finding = await etOpenSource.check("9.9.9.9", signal());
    expect(finding.status).toBe("ok");
    expect(finding.score).toBe(0);
  });

  it("downloads once and serves the second lookup from the cached feed", async () => {
    vi.mocked(getText).mockResolvedValue({ ok: true, status: 200, data: null, text: feed });
    const { etOpenSource, getText: mocked } = await freshSource();

    await etOpenSource.check("1.2.3.4", signal());
    await etOpenSource.check("5.6.7.8", signal());
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("returns an error finding rather than throwing when the feed is down", async () => {
    vi.mocked(getText).mockResolvedValue({ ok: false, status: 503, data: null, text: "" });
    const { etOpenSource } = await freshSource();

    const finding = await etOpenSource.check("1.2.3.4", signal());
    expect(finding.status).toBe("error");
    expect(finding.error).toContain("503");
  });
});
