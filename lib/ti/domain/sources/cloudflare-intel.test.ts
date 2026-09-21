import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson } from "@/lib/ti/http";
import {
  categoryNames,
  cloudflareIntelSource,
  intelFinding,
  specificCategory,
  type CfIntelResponse,
} from "@/lib/ti/domain/sources/cloudflare-intel";

/** The shape Cloudflare returns for an adult site: each specific category is
 *  paired with the umbrella it belongs to. */
const PORN: CfIntelResponse = {
  result: {
    domain: "example.test",
    type: "Apex domain",
    content_categories: [
      { id: 133, super_category_id: 2, name: "Pornography" },
      { id: 2, name: "Adult Themes" },
      { id: 182, super_category_id: 34, name: "CIPA Filter" },
      { id: 34, name: "CIPA" },
    ],
  },
};

describe("specificCategory", () => {
  it("prefers the specific half of a pair over its umbrella", () => {
    expect(specificCategory(PORN.result?.content_categories)).toBe("Pornography");
  });

  it("falls back to the first entry when every category is an umbrella", () => {
    expect(specificCategory([{ id: 26, name: "Technology" }])).toBe("Technology");
  });

  it("ignores entries with no name", () => {
    expect(specificCategory([{ id: 1 }, { id: 26, name: "Technology" }])).toBe("Technology");
  });

  it("answers nothing for an empty list", () => {
    expect(specificCategory([])).toBeUndefined();
    expect(specificCategory(undefined)).toBeUndefined();
  });
});

describe("categoryNames", () => {
  it("orders specific categories ahead of umbrellas", () => {
    expect(categoryNames(PORN.result?.content_categories)).toEqual([
      "Pornography",
      "CIPA Filter",
      "Adult Themes",
      "CIPA",
    ]);
  });

  it("dedupes a category repeated as its own umbrella", () => {
    // github.com comes back as Technology twice, once specific and once as the
    // umbrella of itself.
    expect(
      categoryNames([
        { id: 155, super_category_id: 26, name: "Technology" },
        { id: 26, name: "Technology" },
      ]),
    ).toEqual(["Technology"]);
  });
});

describe("intelFinding", () => {
  it("reports categories as context, never as a score", () => {
    const f = intelFinding(PORN);
    expect(f.status).toBe("ok");
    expect(f.score).toBeUndefined();
    expect(f.malicious).toBeUndefined();
    expect(f.domainContext?.categories).toEqual(categoryNames(PORN.result?.content_categories));
    expect(f.details?.primaryCategory).toBe("Pornography");
  });

  it("treats an uncategorised name as an answer, not a failure", () => {
    // Cloudflare returns 200 with an all but empty body for the long tail. An
    // error status here would read to an analyst as a broken source.
    const f = intelFinding({ result: { domain: "nothing.test", type: "Apex domain" } });
    expect(f.status).toBe("ok");
    expect(f.summary).toContain("Not categorised");
    expect(f.domainContext).toBeUndefined();
  });

  it("still answers when only an application matched", () => {
    const f = intelFinding({ result: { application: { id: 1, name: "GoogleDNS" } } });
    expect(f.summary).toBe("Recognised as GoogleDNS");
  });

  it("carries the popularity rank and domain type through to details", () => {
    const f = intelFinding({
      result: {
        type: "Apex domain",
        popularity_rank: 42,
        content_categories: [{ id: 155, super_category_id: 26, name: "Technology" }],
      },
    });
    expect(f.details?.popularityRank).toBe(42);
    expect(f.details?.domainType).toBe("Apex domain");
  });
});

describe("the adapter", () => {
  it("needs both halves of the credential, not just the token", () => {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    try {
      process.env.CLOUDFLARE_API_TOKEN = "t";
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      expect(cloudflareIntelSource.isEnabled()).toBe(false);
      process.env.CLOUDFLARE_ACCOUNT_ID = "a";
      expect(cloudflareIntelSource.isEnabled()).toBe(true);
    } finally {
      if (token === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = token;
      if (account === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
      else process.env.CLOUDFLARE_ACCOUNT_ID = account;
    }
  });

  it("scores nothing, so a category can never move the verdict", () => {
    expect(cloudflareIntelSource.meta.weight).toBe(0);
    expect(cloudflareIntelSource.meta.requiresKey).toBe(true);
  });
});

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn() };
});

describe("cloudflareIntelSource.check", () => {
  const signal = () => new AbortController().signal;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;

  afterEach(() => {
    vi.mocked(getJson).mockReset();
    if (token === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = token;
    if (account === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = account;
  });

  function credentialled() {
    process.env.CLOUDFLARE_API_TOKEN = "t";
    process.env.CLOUDFLARE_ACCOUNT_ID = "a";
  }

  it("skips rather than erroring when the credential is missing", async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    expect((await cloudflareIntelSource.check("x.test", signal())).status).toBe("skipped");
  });

  it("sends the account id in the path and the token as a bearer", async () => {
    credentialled();
    vi.mocked(getJson).mockResolvedValue({ ok: true, status: 200, data: PORN, text: "" });
    const f = await cloudflareIntelSource.check("example.test", signal());
    const [url, , headers] = vi.mocked(getJson).mock.calls[0];
    expect(url).toContain("/accounts/a/intel/domain?domain=example.test");
    expect(headers).toEqual({ authorization: "Bearer t" });
    expect(f.details?.primaryCategory).toBe("Pornography");
  });

  it("escapes the domain into the query string", async () => {
    credentialled();
    vi.mocked(getJson).mockResolvedValue({ ok: true, status: 200, data: {}, text: "" });
    await cloudflareIntelSource.check("a b&c.test", signal());
    expect(vi.mocked(getJson).mock.calls[0][0]).toContain("domain=a%20b%26c.test");
  });

  it("never throws out of check()", async () => {
    credentialled();
    vi.mocked(getJson).mockResolvedValue({ ok: false, status: 403, data: null, text: "" });
    expect((await cloudflareIntelSource.check("x.test", signal())).status).toBe("error");
    vi.mocked(getJson).mockRejectedValue(new Error("dns fail"));
    expect((await cloudflareIntelSource.check("x.test", signal())).status).toBe("error");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await cloudflareIntelSource.check("x.test", signal())).status).toBe("timeout");
  });
});
