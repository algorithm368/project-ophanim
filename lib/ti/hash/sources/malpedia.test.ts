import { afterEach, describe, expect, it, vi } from "vitest";
import { familyToMalpediaIds, fetchFamilyDescription } from "./malpedia";
import * as http from "../../http";

describe("familyToMalpediaIds", () => {
  it("slugifies and prefixes with platforms, win first", () => {
    expect(familyToMalpediaIds("Upatre")).toEqual([
      "win.upatre",
      "elf.upatre",
      "osx.upatre",
      "apk.upatre",
      "js.upatre",
    ]);
  });
  it("strips non-alphanumerics from the slug", () => {
    expect(familyToMalpediaIds("Cobalt Strike")[0]).toBe("win.cobaltstrike");
  });
});

describe("fetchFamilyDescription", () => {
  it("returns the description and capped refs on the first hit", async () => {
    const spy = vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        description: "Upatre is a downloader that retrieves a second-stage payload.",
        urls: [
          "https://a.example",
          "https://b.example",
          "https://c.example",
          "https://d.example",
          "https://e.example",
          "https://f.example",
        ],
      },
    } as never);

    const info = await fetchFamilyDescription("Upatre", new AbortController().signal);
    expect(info?.description).toContain("downloader");
    expect(info?.refs).toHaveLength(5);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("falls through platforms on 404 and gives up after the last miss", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: false,
      status: 404,
      data: undefined,
    } as never);
    const info = await fetchFamilyDescription("Nope", new AbortController().signal);
    expect(info).toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe("fetchFamilyDescription — partial entries", () => {
  const signal = new AbortController().signal;
  afterEach(() => vi.restoreAllMocks());

  it("accepts a hit with only references, or only a description", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: { description: "  ", urls: ["https://r.example"] },
      text: "",
    } as never);
    expect(await fetchFamilyDescription("X", signal)).toEqual({
      description: undefined,
      refs: ["https://r.example"],
    });
    vi.restoreAllMocks();
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: { description: "A loader" },
      text: "",
    } as never);
    expect(await fetchFamilyDescription("X", signal)).toEqual({
      description: "A loader",
      refs: undefined,
    });
  });

  it("skips an empty entry", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: { urls: [] },
      text: "",
    } as never);
    expect(await fetchFamilyDescription("X", signal)).toBeUndefined();
  });
});
