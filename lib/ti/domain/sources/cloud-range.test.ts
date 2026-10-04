import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudRangeSource } from "@/lib/ti/domain/sources/cloud-range";
import { resetCloudPrefixCache } from "@/lib/ti/cloud-ranges";
import { getJson, getText } from "@/lib/ti/http";
import { dohQuery } from "@/lib/ti/dns/doh";

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn(), getText: vi.fn() };
});

vi.mock("@/lib/ti/dns/doh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/dns/doh")>();
  return { ...actual, dohQuery: vi.fn() };
});

const signal = () => new AbortController().signal;

const AWS = {
  ok: true,
  status: 200,
  data: {
    prefixes: [{ ip_prefix: "3.5.140.0/22", region: "ap-northeast-2", service: "S3" }],
  },
  text: "",
};
const EMPTY_JSON = { ok: true, status: 200, data: {}, text: "" };
const CF_LIST = { ok: true, status: 200, data: null, text: "104.16.0.0/13\n" };

function aRecord(...ips: string[]) {
  return { Status: 0, Answer: ips.map((ip) => ({ type: 1, name: "x", TTL: 60, data: ip })) };
}

function cnameRecord(...names: string[]) {
  return { Status: 0, Answer: names.map((n) => ({ type: 5, name: "x", TTL: 60, data: n })) };
}

/** Routes the two DoH queries this source makes by record type. */
function dohByType(a: ReturnType<typeof aRecord>, cname: ReturnType<typeof cnameRecord>) {
  return async (_resolver: string, _name: string, type: string) => (type === "A" ? a : cname);
}

describe("domain cloudRangeSource.check", () => {
  afterEach(() => {
    resetCloudPrefixCache();
    vi.mocked(getJson).mockReset();
    vi.mocked(getText).mockReset();
    vi.mocked(dohQuery).mockReset();
  });

  it("names the provider the resolved address announces into", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.includes("amazonaws") ? AWS : EMPTY_JSON,
    );
    vi.mocked(getText).mockResolvedValue(CF_LIST);
    vi.mocked(dohQuery).mockResolvedValue(aRecord("3.5.140.1"));

    const f = await cloudRangeSource.check("example.com", signal());
    expect(f.status).toBe("ok");
    expect(f.summary).toBe(
      "Resolves behind Amazon Web Services (ap-northeast-2, S3), announced in 3.5.140.0/22",
    );
    expect(f.details).toMatchObject({
      provider: "Amazon Web Services",
      region: "ap-northeast-2",
      service: "S3",
    });
  });

  it("says so plainly when the domain resolves outside every published range", async () => {
    vi.mocked(getJson).mockResolvedValue(EMPTY_JSON);
    vi.mocked(getText).mockResolvedValue(CF_LIST);
    vi.mocked(dohQuery).mockImplementation(dohByType(aRecord("8.8.8.8"), cnameRecord()));

    const f = await cloudRangeSource.check("example.com", signal());
    expect(f.status).toBe("ok");
    expect(f.summary).toBe("Does not resolve into a published cloud range");
    expect(f.details).toBeUndefined();
  });

  it("falls back to a CNAME suffix when the address itself matches no range", async () => {
    // The prefix list is the main path; two real domains tested against #59
    // both had an empty CNAME, so this only fires when the A record misses.
    vi.mocked(getJson).mockResolvedValue(EMPTY_JSON);
    vi.mocked(getText).mockResolvedValue(CF_LIST);
    vi.mocked(dohQuery).mockImplementation(
      dohByType(aRecord("8.8.8.8"), cnameRecord("d123.azureedge.net")),
    );

    const f = await cloudRangeSource.check("cdn.example.com", signal());
    expect(f.status).toBe("ok");
    expect(f.summary).toBe("Resolves behind Microsoft Azure, via its CNAME");
    expect(f.details).toEqual({ provider: "Microsoft Azure" });
  });

  it("does not shadow a real prefix match with an unrelated CNAME", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.includes("amazonaws") ? AWS : EMPTY_JSON,
    );
    vi.mocked(getText).mockResolvedValue(CF_LIST);
    vi.mocked(dohQuery).mockImplementation(
      dohByType(aRecord("3.5.140.1"), cnameRecord("d123.azureedge.net")),
    );

    const f = await cloudRangeSource.check("example.com", signal());
    expect(f.details).toMatchObject({ provider: "Amazon Web Services" });
  });

  it("does the same when the domain does not resolve at all", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.includes("amazonaws") ? AWS : EMPTY_JSON,
    );
    vi.mocked(getText).mockResolvedValue(CF_LIST);
    vi.mocked(dohQuery).mockResolvedValue({ Status: 3 });

    const f = await cloudRangeSource.check("nxdomain.example", signal());
    expect(f.status).toBe("ok");
    expect(f.summary).toBe("Does not resolve into a published cloud range");
  });

  it("errors rather than claiming a domain is uncloudy when no list loaded", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("down"));
    vi.mocked(getText).mockRejectedValue(new Error("down"));
    vi.mocked(dohQuery).mockResolvedValue(aRecord("3.5.140.1"));

    const f = await cloudRangeSource.check("example.com", signal());
    expect(f.status).toBe("error");
    expect(f.error).toContain("No provider list");
  });

  it("reports a timeout distinctly from a resolver error", async () => {
    vi.mocked(getJson).mockResolvedValue(EMPTY_JSON);
    vi.mocked(getText).mockResolvedValue(CF_LIST);
    vi.mocked(dohQuery).mockImplementation(() => {
      throw new DOMException("timed out", "TimeoutError");
    });

    const f = await cloudRangeSource.check("example.com", signal());
    expect(f.status).toBe("timeout");
  });
});

describe("domain cloudRangeSource.check — remaining paths", () => {
  afterEach(() => {
    resetCloudPrefixCache();
    vi.mocked(getJson).mockReset();
    vi.mocked(getText).mockReset();
    vi.mocked(dohQuery).mockReset();
  });

  it("needs no key", () => expect(cloudRangeSource.isEnabled()).toBe(true));

  it("leaves the region detail out when the block has none", async () => {
    vi.mocked(getJson).mockResolvedValue(EMPTY_JSON);
    vi.mocked(getText).mockResolvedValue(CF_LIST);
    vi.mocked(dohQuery).mockImplementation(dohByType(aRecord("104.16.0.1"), cnameRecord()));
    expect((await cloudRangeSource.check("example.com", signal())).summary).toBe(
      "Resolves behind Cloudflare, announced in 104.16.0.0/13",
    );
  });

  it("reports a resolver failure as an error", async () => {
    vi.mocked(getJson).mockResolvedValue(EMPTY_JSON);
    vi.mocked(getText).mockResolvedValue(CF_LIST);
    vi.mocked(dohQuery).mockRejectedValue(new Error("resolver down"));
    expect(await cloudRangeSource.check("example.com", signal())).toEqual({
      status: "error",
      error: "resolver down",
    });
  });
});
