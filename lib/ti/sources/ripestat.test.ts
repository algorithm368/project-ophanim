import { afterEach, describe, expect, it, vi } from "vitest";
import { ripeStatSource, ripestatFinding, rpkiCategories } from "./ripestat";
import { getJson } from "../http";

describe("rpkiCategories", () => {
  it("tags the real routinator invalid_* statuses", () => {
    expect(rpkiCategories("invalid_asn")).toEqual(["rpki-invalid"]);
    expect(rpkiCategories("invalid_length")).toEqual(["rpki-invalid"]);
  });

  it("does not tag valid or unknown (no ROA published)", () => {
    expect(rpkiCategories("valid")).toEqual([]);
    expect(rpkiCategories("unknown")).toEqual([]);
    expect(rpkiCategories(undefined)).toEqual([]);
  });
});

describe("ripestatFinding", () => {
  it("summarizes the announced prefix and ASN, and seeds geo.asn", () => {
    const f = ripestatFinding({ prefix: "27.254.104.0/23", asns: ["4750"] });
    expect(f.status).toBe("ok");
    expect(f.summary).toBe("Announced as 27.254.104.0/23 by AS4750");
    expect(f.geo).toEqual({ asn: "AS4750" });
    expect(f.details).toEqual({ prefix: "27.254.104.0/23", asns: ["4750"] });
  });

  it("joins multiple origin ASNs", () => {
    const f = ripestatFinding({ prefix: "1.0.0.0/24", asns: ["13335", "15169"] });
    expect(f.summary).toBe("Announced as 1.0.0.0/24 by AS13335, AS15169");
  });

  it("reports unannounced space when there is no prefix or ASN", () => {
    const f = ripestatFinding({ prefix: undefined, asns: [] });
    expect(f.summary).toBe("Not announced in BGP");
    expect(f.geo).toBeUndefined();
  });
});

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

// The ASN picked for the follow-up RPKI call comes off the announced-prefix
// response. It used to be filter(Boolean)[0] and is find(Boolean) now, so the
// case that matters is a list whose first entry is falsy.
describe("ripeStatSource.check ASN selection", () => {
  const mockGetJson = vi.mocked(getJson);
  afterEach(() => mockGetJson.mockReset());

  const prefixResponse = (asns: unknown[]) =>
    ({
      ok: true,
      status: 200,
      data: { data: { prefix: "27.254.104.0/23", asns } },
    }) as Awaited<ReturnType<typeof getJson>>;

  it("skips falsy entries and validates RPKI for the first real ASN", async () => {
    mockGetJson
      .mockResolvedValueOnce(prefixResponse(["", "4750"]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { status: "valid" } },
      } as Awaited<ReturnType<typeof getJson>>);

    const finding = await ripeStatSource.check("27.254.104.1", new AbortController().signal);
    expect(finding.status).toBe("ok");
    // Second call is the RPKI validation, and it must carry the real ASN.
    expect(mockGetJson.mock.calls[1][0]).toContain("4750");
  });

  it("skips the RPKI call when no ASN is announced", async () => {
    mockGetJson.mockResolvedValueOnce(prefixResponse([]));
    const finding = await ripeStatSource.check("27.254.104.1", new AbortController().signal);
    expect(finding.status).toBe("ok");
    expect(mockGetJson).toHaveBeenCalledTimes(1);
  });
});
