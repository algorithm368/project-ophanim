import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudRangeSource } from "@/lib/ti/sources/cloud-range";
import { cloudPrefixes, resetCloudPrefixCache } from "@/lib/ti/cloud-ranges";
import { getJson, getText } from "@/lib/ti/http";

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, getJson: vi.fn(), getText: vi.fn() };
});

const signal = () => new AbortController().signal;

const AWS = {
  ok: true,
  status: 200,
  data: {
    prefixes: [
      { ip_prefix: "3.5.140.0/22", region: "ap-northeast-2", service: "S3" },
      { ip_prefix: "3.0.0.0/8", region: "GLOBAL", service: "AMAZON" },
    ],
  },
  text: "",
};
const GCP = {
  ok: true,
  status: 200,
  data: { prefixes: [{ ipv4Prefix: "34.1.208.0/20", service: "Google Cloud", scope: "africa-south1" }] },
  text: "",
};
const CF = { ok: true, status: 200, data: null, text: "104.16.0.0/13\n" };
const AZURE_INDEX = {
  ok: true,
  status: 200,
  data: null,
  text: '<a href="https://download.microsoft.com/download/x/ServiceTags_Public_20260901.json">Download</a>',
};
const AZURE_JSON = {
  ok: true,
  status: 200,
  data: {
    values: [
      {
        properties: {
          region: "eastus",
          systemService: "AzureStorage",
          addressPrefixes: ["20.60.0.0/16"],
        },
      },
    ],
  },
  text: "",
};

describe("cloudPrefixes", () => {
  afterEach(() => {
    resetCloudPrefixCache();
    vi.mocked(getJson).mockReset();
    vi.mocked(getText).mockReset();
  });

  it("merges every provider that responded", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.includes("amazonaws") ? AWS : GCP,
    );
    vi.mocked(getText).mockResolvedValue(CF);
    const prefixes = await cloudPrefixes(signal());
    expect(prefixes.map((p) => p.provider).sort()).toEqual([
      "Amazon Web Services",
      "Amazon Web Services",
      "Cloudflare",
      "Google Cloud",
    ]);
  });

  it("also merges Azure once the index page names this week's file", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) => {
      if (url.includes("amazonaws")) return AWS;
      if (url.includes("download.microsoft.com")) return AZURE_JSON;
      return GCP;
    });
    vi.mocked(getText).mockImplementation(async (url: string) =>
      url.includes("cloudflare.com") ? CF : AZURE_INDEX,
    );
    const prefixes = await cloudPrefixes(signal());
    expect(prefixes).toContainEqual({
      cidr: "20.60.0.0/16",
      provider: "Microsoft Azure",
      region: "eastus",
      service: "AzureStorage",
    });
  });

  it("drops only the provider that failed", async () => {
    // A partial answer is a correct answer about the providers that did reply.
    vi.mocked(getJson).mockRejectedValue(new Error("down"));
    vi.mocked(getText).mockResolvedValue(CF);
    const prefixes = await cloudPrefixes(signal());
    expect(prefixes).toEqual([{ cidr: "104.16.0.0/13", provider: "Cloudflare" }]);
  });

  it("serves the second lookup from cache without refetching", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.includes("amazonaws") ? AWS : GCP,
    );
    vi.mocked(getText).mockResolvedValue(CF);
    await cloudPrefixes(signal());
    const callsAfterFirst = vi.mocked(getJson).mock.calls.length;
    await cloudPrefixes(signal());
    expect(vi.mocked(getJson).mock.calls.length).toBe(callsAfterFirst);
  });

  it("does not cache a total outage, so the next lookup retries", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("down"));
    vi.mocked(getText).mockRejectedValue(new Error("down"));
    expect(await cloudPrefixes(signal())).toEqual([]);
    const before = vi.mocked(getText).mock.calls.length;
    await cloudPrefixes(signal());
    expect(vi.mocked(getText).mock.calls.length).toBeGreaterThan(before);
  });
});

describe("cloudRangeSource.check", () => {
  afterEach(() => {
    resetCloudPrefixCache();
    vi.mocked(getJson).mockReset();
    vi.mocked(getText).mockReset();
  });

  it("names the provider, region and announcing block", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.includes("amazonaws") ? AWS : GCP,
    );
    vi.mocked(getText).mockResolvedValue(CF);
    const f = await cloudRangeSource.check("3.5.140.1", signal());
    expect(f.status).toBe("ok");
    expect(f.summary).toBe(
      "Amazon Web Services (ap-northeast-2, S3), announced in 3.5.140.0/22",
    );
    expect(f.details).toMatchObject({ region: "ap-northeast-2", service: "S3" });
    expect(f.geo?.isHosting).toBe(true);
  });

  it("never scores, since being on a cloud is neither incriminating nor exonerating", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.includes("amazonaws") ? AWS : GCP,
    );
    vi.mocked(getText).mockResolvedValue(CF);
    const f = await cloudRangeSource.check("104.16.132.229", signal());
    expect(f.score).toBeUndefined();
    expect(f.allowlisted).toBeUndefined();
    expect(f.summary).toContain("Cloudflare");
  });

  it("says so plainly when the address is in no published range", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.includes("amazonaws") ? AWS : GCP,
    );
    vi.mocked(getText).mockResolvedValue(CF);
    const f = await cloudRangeSource.check("8.8.8.8", signal());
    expect(f.summary).toBe("Not in a published cloud range");
  });

  it("errors rather than claiming an address is uncloudy when no list loaded", async () => {
    // With nothing fetched, "not in a published range" would be a false
    // negative dressed as a finding.
    vi.mocked(getJson).mockRejectedValue(new Error("down"));
    vi.mocked(getText).mockRejectedValue(new Error("down"));
    const f = await cloudRangeSource.check("3.5.140.1", signal());
    expect(f.status).toBe("error");
    expect(f.error).toContain("No provider list");
  });
});

describe("cloudRangeSource meta paths", () => {
  afterEach(() => {
    resetCloudPrefixCache();
    vi.mocked(getJson).mockReset();
    vi.mocked(getText).mockReset();
  });

  it("needs no key", () => expect(cloudRangeSource.isEnabled()).toBe(true));

  it("reports a timeout when the caller's deadline has passed", async () => {
    vi.mocked(getJson).mockResolvedValue(AWS);
    vi.mocked(getText).mockResolvedValue(CF);
    const expired = AbortSignal.abort(new DOMException("t", "TimeoutError"));
    expect((await cloudRangeSource.check("3.5.140.1", expired)).status).toBe("timeout");
  });

  it("reports an error when a provider list is malformed enough to throw", async () => {
    vi.mocked(getJson).mockResolvedValue({ ok: true, status: 200, data: { prefixes: "x" }, text: "" });
    vi.mocked(getText).mockResolvedValue(CF);
    const f = await cloudRangeSource.check("3.5.140.1", signal());
    expect(f.status).toBe("error");
  });
});

describe("cloudPrefixes — Azure's two hops failing", () => {
  afterEach(() => {
    resetCloudPrefixCache();
    vi.mocked(getJson).mockReset();
    vi.mocked(getText).mockReset();
  });

  it("drops only Azure when the index page or the JSON it names fails", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.includes("download.microsoft.com")
        ? { ok: false, status: 404, data: null, text: "" }
        : { ok: true, status: 200, data: {}, text: "" },
    );
    vi.mocked(getText).mockImplementation(async (url: string) =>
      url.includes("cloudflare.com") ? CF : { ...AZURE_INDEX, ok: false, status: 503 },
    );
    expect((await cloudPrefixes(signal())).map((p) => p.provider)).toEqual(["Cloudflare"]);
    resetCloudPrefixCache();
    vi.mocked(getText).mockImplementation(async (url: string) =>
      url.includes("cloudflare.com") ? CF : AZURE_INDEX,
    );
    expect((await cloudPrefixes(signal())).map((p) => p.provider)).toEqual(["Cloudflare"]);
  });
});
