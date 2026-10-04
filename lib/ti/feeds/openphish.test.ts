import { afterEach, describe, expect, it, vi } from "vitest";
import { hostOf, loadOpenphishFeed, resetOpenphishCache } from "./openphish";
import { getText } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getText: vi.fn() };
});

const signal = () => new AbortController().signal;
const reply = (text: string, ok = true) =>
  vi.mocked(getText).mockResolvedValue({ ok, status: ok ? 200 : 503, data: null, text });

describe("hostOf", () => {
  it("lowercases the host and drops a trailing dot", () => {
    expect(hostOf(" https://Evil.Example./login ")).toBe("evil.example");
  });

  it("is null for something that is not a URL", () => {
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("loadOpenphishFeed", () => {
  afterEach(() => {
    resetOpenphishCache();
    vi.mocked(getText).mockReset();
  });

  it("indexes hosts and canonical URLs, skipping blanks and junk", async () => {
    reply("https://evil.example/login\n\n   \nnot a url\n");
    const feed = await loadOpenphishFeed(signal());
    expect([...feed.hosts]).toEqual(["evil.example"]);
    expect(feed.urls.size).toBe(1);
  });

  it("serves a fresh copy from cache", async () => {
    reply("https://evil.example/\n");
    const first = await loadOpenphishFeed(signal());
    expect(await loadOpenphishFeed(signal())).toBe(first);
    expect(getText).toHaveBeenCalledTimes(1);
  });

  it("throws when the feed is down or empty", async () => {
    reply("", false);
    await expect(loadOpenphishFeed(signal())).rejects.toThrow("feed unavailable (HTTP 503)");
    reply("");
    await expect(loadOpenphishFeed(signal())).rejects.toThrow("feed unavailable (HTTP 200)");
  });
});
