import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, getJson, getText, isTimeout, postForm, postJson } from "./http";

const signal = new AbortController().signal;

function stubFetch(body: string, status = 200) {
  const fn = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("getJson", () => {
  it("parses a JSON body and reports status", async () => {
    stubFetch('{"a":1}');
    expect(await getJson("https://x.test", signal)).toEqual({
      ok: true,
      status: 200,
      data: { a: 1 },
      text: '{"a":1}',
    });
  });

  it("never throws on malformed JSON or an empty body", async () => {
    stubFetch("not json", 502);
    const bad = await getJson("https://x.test", signal);
    expect(bad).toMatchObject({ ok: false, status: 502, data: null, text: "not json" });
    stubFetch("");
    expect((await getJson("https://x.test", signal)).data).toBeNull();
  });

  it("sets mode only when one is asked for, and merges headers", async () => {
    const fn = stubFetch("{}");
    await getJson("https://x.test", signal, { "X-Key": "k" }, "no-cors");
    await getJson("https://x.test", signal);
    const [, withMode] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const [, without] = fn.mock.calls[1] as unknown as [string, RequestInit];
    expect(withMode.mode).toBe("no-cors");
    expect(withMode.headers).toMatchObject({ "X-Key": "k", Accept: "application/json" });
    expect("mode" in without).toBe(false);
  });
});

describe("postJson / postForm / getText", () => {
  it("posts a JSON body", async () => {
    const fn = stubFetch('{"ok":true}');
    const res = await postJson("https://x.test", signal, { q: 1 }, { A: "b" });
    expect(res.data).toEqual({ ok: true });
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"q":1}');
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", A: "b" });
  });

  it("posts a form body", async () => {
    const fn = stubFetch('{"ok":true}');
    await postForm("https://x.test", signal, { query: "get_info", hash: "h" });
    await postForm("https://x.test", signal, {}, { "Auth-Key": "k" });
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe("query=get_info&hash=h");
    expect(init.headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
  });

  it("returns raw text with no data", async () => {
    stubFetch("line1\nline2", 404);
    expect(await getText("https://x.test", signal, { A: "b" })).toEqual({
      ok: false,
      status: 404,
      data: null,
      text: "line1\nline2",
    });
    stubFetch("x");
    expect((await getText("https://x.test", signal)).ok).toBe(true);
  });
});

describe("isTimeout / errorMessage", () => {
  it("recognizes timeout and abort DOMExceptions only", () => {
    expect(isTimeout(new DOMException("t", "TimeoutError"))).toBe(true);
    expect(isTimeout(new DOMException("a", "AbortError"))).toBe(true);
    expect(isTimeout(new DOMException("n", "NetworkError"))).toBe(false);
    expect(isTimeout(new Error("x"))).toBe(false);
  });

  it("reads an Error's message or stringifies anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});
