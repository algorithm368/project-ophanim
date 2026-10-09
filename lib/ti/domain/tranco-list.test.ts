import { afterEach, describe, expect, it, vi } from "vitest";
import { trancoFinding } from "./sources/tranco";
import { bulkTrancoFinding, parentDomain, parseTrancoCsv } from "./tranco-list";

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn(), getText: vi.fn() };
});

afterEach(() => delete process.env.TI_SHARED_HOSTING_SUFFIXES);

const top = parseTrancoCsv("1,google.com\r\n103,b-cdn.net\r\n445,tencent-cloud.net\r\n225,pages.dev\r\nbad line\r\n");

describe("parseTrancoCsv", () => {
  it("reads rank,domain lines and skips junk", () => {
    expect(top.get("google.com")).toBe(1);
    expect(top.size).toBe(4);
  });
  it("skips a line whose rank is not a positive integer", () => {
    expect(parseTrancoCsv("0,a.com\nx,b.com\n1.5,c.com\n2,D.com\n").size).toBe(1);
    expect(parseTrancoCsv("2,D.com\n").get("d.com")).toBe(2);
  });
});

describe("parentDomain", () => {
  it("returns the registrable parent of a subdomain", () => {
    expect(parentDomain("accounts.google.com")).toBe("google.com");
    expect(parentDomain("corporate.tops.co.th")).toBe("tops.co.th");
  });
  it("returns null for a registrable domain itself", () => {
    expect(parentDomain("google.com")).toBeNull();
  });
  it("returns null when there is no registrable domain at all", () => {
    expect(parentDomain("co.uk")).toBeNull();
  });
  it("never treats PSL-private or hand-listed shared hosting as a parent", () => {
    expect(parentDomain("x.pages.dev")).toBeNull();
    expect(parentDomain("adsninjacdn.b-cdn.net")).toBeNull();
    expect(parentDomain("ins-9hkazpwd.ias.tencent-cloud.net")).toBeNull();
    process.env.TI_SHARED_HOSTING_SUFFIXES = " , Tops.co.th ";
    expect(parentDomain("corporate.tops.co.th")).toBeNull();
  });
});

describe("bulkTrancoFinding", () => {
  it("vouches an exact top-1,000 domain, as /check would", () => {
    expect(bulkTrancoFinding("google.com", top)).toMatchObject({ status: "ok", allowlisted: true });
    // The same answer the per-domain API gives /check, so a bulk row is never
    // vouched differently from the single lookup.
    expect(bulkTrancoFinding("google.com", top)).toEqual(
      trancoFinding({ ranks: [{ date: "d", rank: 1 }] }),
    );
  });
  it("gives a subdomain a parent vouch, never allowlisted", () => {
    const f = bulkTrancoFinding("accounts.google.com", top);
    expect(f.allowlisted).toBeFalsy();
    expect(f.details).toEqual({ parentVouch: { parent: "google.com", rank: 1 } });
    expect(f.summary).toBe("Under google.com, Tranco rank 1");
  });
  it("gives shared hosting and unknown domains nothing", () => {
    expect(bulkTrancoFinding("adsninjacdn.b-cdn.net", top)).toEqual({ status: "ok", summary: "Not in the Tranco top 1,000" });
    expect(bulkTrancoFinding("gvaq70s7he.ru", top)).toEqual({ status: "ok", summary: "Not in the Tranco top 1,000" });
    expect(bulkTrancoFinding("www.example.com", top)).toEqual({ status: "ok", summary: "Not in the Tranco top 1,000" });
  });
});

// The loader keeps the list in a module-level cache with no reset seam, so each
// case imports a fresh copy rather than inheriting the previous one's download.
describe("loadTopList", () => {
  const signal = () => new AbortController().signal;
  const latest = { ok: true, status: 200, data: { list_id: "26Y29" }, text: "" };
  const csv = { ok: true, status: 200, data: null, text: "1,google.com\n2,facebook.com\n" };

  async function fresh() {
    vi.resetModules();
    const http = await import("@/lib/ti/http");
    const { loadTopList } = await import("./tranco-list");
    return { loadTopList, getJson: vi.mocked(http.getJson), getText: vi.mocked(http.getText) };
  }

  afterEach(() => vi.useRealTimers());

  it("downloads the latest top 1,000 once, then answers from memory", async () => {
    const { loadTopList, getJson, getText } = await fresh();
    getJson.mockResolvedValue(latest);
    getText.mockResolvedValue(csv);
    expect((await loadTopList(signal())).get("facebook.com")).toBe(2);
    await loadTopList(signal());
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getText).toHaveBeenCalledWith("https://tranco-list.eu/download/26Y29/1000", expect.anything());
    expect(getText).toHaveBeenCalledTimes(1);
  });

  it("downloads again once the day is up", async () => {
    vi.useFakeTimers();
    const { loadTopList, getJson, getText } = await fresh();
    getJson.mockResolvedValue(latest);
    getText.mockResolvedValue(csv);
    await loadTopList(signal());
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    await loadTopList(signal());
    expect(getText).toHaveBeenCalledTimes(2);
  });

  it("fails when the list id is unavailable", async () => {
    const { loadTopList, getJson } = await fresh();
    getJson.mockResolvedValue({ ok: false, status: 429, data: null, text: "" });
    await expect(loadTopList(signal())).rejects.toThrow("HTTP 429");
    getJson.mockResolvedValue({ ok: true, status: 200, data: {}, text: "" });
    await expect(loadTopList(signal())).rejects.toThrow("list id unavailable");
  });

  it("fails when the list itself is unavailable or empty", async () => {
    const { loadTopList, getJson, getText } = await fresh();
    getJson.mockResolvedValue(latest);
    getText.mockResolvedValue({ ok: false, status: 503, data: null, text: "" });
    await expect(loadTopList(signal())).rejects.toThrow("HTTP 503");
    getText.mockResolvedValue({ ok: true, status: 200, data: null, text: "" });
    await expect(loadTopList(signal())).rejects.toThrow("list unavailable");
  });
});
