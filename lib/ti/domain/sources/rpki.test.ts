import { afterEach, describe, expect, it, vi } from "vitest";
import { rpkiSource } from "./rpki";
import { resolveA } from "../../dns/doh";
import { getJson } from "../../http";

// resolveA is imported by rpki.ts from a different module than it's defined
// in, so mocking it here (rather than dohQuery, which it calls internally in
// the same file and would not be intercepted this way) is what actually
// takes effect.
vi.mock("../../dns/doh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../dns/doh")>();
  return { ...actual, resolveA: vi.fn() };
});
vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, getJson: vi.fn() };
});

const SIGNAL = new AbortController().signal;
const mockGetJson = vi.mocked(getJson);
const mockResolveA = vi.mocked(resolveA);

const networkInfo = (prefix: string, asns: string[]) =>
  ({
    ok: true,
    status: 200,
    data: { data: { prefix, asns } },
  }) as Awaited<ReturnType<typeof getJson>>;

const rpkiValidation = (status: string) =>
  ({
    ok: true,
    status: 200,
    data: { data: { status } },
  }) as Awaited<ReturnType<typeof getJson>>;

describe("rpkiSource.check", () => {
  afterEach(() => {
    mockResolveA.mockReset();
    mockGetJson.mockReset();
  });

  it("reports no finding when the domain has no resolved IP", async () => {
    mockResolveA.mockResolvedValue([]);
    const f = await rpkiSource.check("no-such.example", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.score).toBeUndefined();
    expect(f.summary).toContain("No resolved IP");
  });

  it("reports not-announced when RIPEstat has no prefix/ASN for the IP", async () => {
    mockResolveA.mockResolvedValue(["10.0.0.1"]);
    mockGetJson.mockResolvedValueOnce(networkInfo("", []));
    const f = await rpkiSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.score).toBeUndefined();
    expect(f.summary).toContain("not announced in BGP");
    expect(mockGetJson).toHaveBeenCalledTimes(1);
  });

  it("does not score a valid RPKI origin", async () => {
    mockResolveA.mockResolvedValue(["93.184.216.34"]);
    mockGetJson
      .mockResolvedValueOnce(networkInfo("93.184.216.0/24", ["15133"]))
      .mockResolvedValueOnce(rpkiValidation("valid"));
    const f = await rpkiSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.score).toBeUndefined();
    expect(f.categories).toEqual([]);
    expect(f.summary).toContain("RPKI origin: valid");
  });

  it("scores an invalid_asn RPKI result", async () => {
    mockResolveA.mockResolvedValue(["8.8.8.8"]);
    mockGetJson
      .mockResolvedValueOnce(networkInfo("8.8.8.0/24", ["1"]))
      .mockResolvedValueOnce(rpkiValidation("invalid_asn"));
    const f = await rpkiSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.score).toBe(60);
    expect(f.categories).toEqual(["rpki-invalid"]);
    expect(f.summary).toContain("fails RPKI origin validation: invalid_asn");
  });

  it("does not score when RIPEstat has no ROA published (unknown)", async () => {
    mockResolveA.mockResolvedValue(["93.184.216.34"]);
    mockGetJson
      .mockResolvedValueOnce(networkInfo("93.184.216.0/24", ["15133"]))
      .mockResolvedValueOnce(rpkiValidation("unknown"));
    const f = await rpkiSource.check("example.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.score).toBeUndefined();
  });
});
