import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeDom,
  EMPTY_CAPABILITY,
  fetchCapability,
  refusalReason,
} from "@/lib/ti/url/active/capability";

const PAGE = "https://secure-login.ms-verify.top/auth/o365";

describe("analyzeDom", () => {
  it("finds a password field however the attribute is written", () => {
    for (const markup of [
      '<input type="password" name="p">',
      "<input type='password'>",
      "<input type=password>",
      '<input NAME="p" TYPE="PASSWORD" class="x">',
    ]) {
      expect(analyzeDom(markup, PAGE).passwordField).toBe(true);
    }
  });

  it("reports no password field rather than guessing when there is none", () => {
    const cap = analyzeDom('<input type="text" name="q">', PAGE);
    expect(cap.passwordField).toBe(false);
  });

  it("names a form that posts to a different site", () => {
    const cap = analyzeDom(
      '<form action="https://collect.ru/gate.php" method="post"></form>',
      PAGE,
    );
    expect(cap.forms).toEqual([
      { action: "https://collect.ru/gate.php", host: "collect.ru", crossDomain: true },
    ]);
  });

  it("does not call a subdomain of the same site cross-domain", () => {
    // api.example.com receiving a post from www.example.com is one site, and
    // calling it cross-domain would cry wolf on ordinary architecture.
    const cap = analyzeDom(
      '<form action="https://api.example.com/login"></form>',
      "https://www.example.com/signin",
    );
    expect(cap.forms[0].crossDomain).toBe(false);
  });

  it("resolves relative and protocol-relative actions against the page", () => {
    const cap = analyzeDom(
      '<form action="/submit"></form><form action="//evil.test/x"></form>',
      PAGE,
    );
    expect(cap.forms[0]).toEqual({
      action: "https://secure-login.ms-verify.top/submit",
      host: "secure-login.ms-verify.top",
      crossDomain: false,
    });
    expect(cap.forms[1].crossDomain).toBe(true);
  });

  it("treats a form with no action as posting to itself", () => {
    const cap = analyzeDom("<form method=post></form>", PAGE);
    expect(cap.forms[0].crossDomain).toBe(false);
    expect(cap.forms[0].action).toBe(PAGE);
  });

  it("keeps a non-http action visible without claiming it is cross-domain", () => {
    // A mailto: action is worth showing, but "cross-domain" is a claim about
    // hosts and there is no host here to compare.
    const cap = analyzeDom('<form action="mailto:drop@evil.test"></form>', PAGE);
    expect(cap.forms[0]).toEqual({
      action: "mailto:drop@evil.test",
      crossDomain: false,
    });
  });

  it("collects links to files that execute when opened", () => {
    const cap = analyzeDom(
      `<a href="https://cdn.evil.test/invoice.exe">invoice</a>
       <a href="/setup.msi">setup</a>
       <a href="https://evil.test/pay.apk?v=2">apk</a>
       <a href="https://good.test/report.pdf">pdf</a>
       <a href="/about">about</a>`,
      PAGE,
    );
    expect(cap.downloadLinks).toEqual([
      "https://cdn.evil.test/invoice.exe",
      "https://secure-login.ms-verify.top/setup.msi",
      "https://evil.test/pay.apk?v=2",
    ]);
  });

  it("makes no claims about an empty document", () => {
    // The page loaded and held nothing we look for. That is different from the
    // DOM being unreadable, which carries an error instead.
    expect(analyzeDom("", PAGE)).toEqual(EMPTY_CAPABILITY);
  });

  it("survives markup that does not parse as anything", () => {
    const cap = analyzeDom("<<>><form action=", PAGE);
    expect(cap.passwordField).toBe(false);
    expect(cap.error).toBeUndefined();
  });

  it("deduplicates repeated form targets and download links", () => {
    const cap = analyzeDom(
      `<form action="https://collect.ru/a"></form>
       <form action="https://collect.ru/a"></form>
       <a href="https://evil.test/x.exe"></a><a href="https://evil.test/x.exe"></a>`,
      PAGE,
    );
    expect(cap.forms).toHaveLength(1);
    expect(cap.downloadLinks).toHaveLength(1);
  });
});

describe("refusalReason", () => {
  const refusal = (status: number, body: unknown) =>
    refusalReason(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

  it("prefers the provider's own wording over the status code", async () => {
    // Verified against the live API 2026-08-15: Cloudflare answers this for an
    // account whose plan does not expose the DOM. It tells an analyst what to
    // do about it, which "HTTP 400" does not.
    await expect(
      refusal(400, {
        errors: [{ title: "DOM not available to account.", status: 400 }],
      }),
    ).resolves.toBe("DOM not available to account");
  });

  it("reads a plain message field too", async () => {
    await expect(refusal(403, { message: "Forbidden" })).resolves.toBe(
      "Forbidden",
    );
  });

  it("falls back to the status when the body says nothing", async () => {
    await expect(refusal(500, {})).resolves.toBe("DOM unavailable, HTTP 500");
    await expect(
      refusalReason(new Response("<html>oops</html>", { status: 502 })),
    ).resolves.toBe("DOM unavailable, HTTP 502");
  });
});

describe("analyzeDom — edge cases", () => {
  it("reads single-quoted and unquoted actions, and an empty one as none", () => {
    const forms = analyzeDom(
      "<form action='/a'><form action=/b><form action=\"\">",
      "https://site.test/page",
    ).forms;
    expect(forms.map((f) => f.action)).toEqual([
      "https://site.test/a",
      "https://site.test/b",
      "https://site.test/page",
    ]);
  });

  it("compares hosts without a registrable domain by their name", () => {
    const [form] = analyzeDom('<form action="http://10.0.0.1/x">', "http://10.0.0.1/").forms;
    expect(form.crossDomain).toBe(false);
  });

  it("keeps hrefs that will not resolve against an unparseable page URL", () => {
    const dom = analyzeDom('<form action="x"><a href="">e</a><a href="y.exe">d</a>', "not a url");
    expect(dom.forms).toEqual([{ action: "x", crossDomain: false }]);
    expect(dom.downloadLinks).toEqual([]);
  });

  it("caps the forms and links it lists", () => {
    const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("");
    const dom = analyzeDom(
      many(10, (i) => `<form action="/f${i}">`) + many(10, (i) => `<a href="/d${i}.exe">`),
      "https://site.test/",
    );
    expect(dom.forms).toHaveLength(8);
    expect(dom.downloadLinks).toHaveLength(8);
  });
});

describe("fetchCapability", () => {
  const signal = new AbortController().signal;
  afterEach(() => vi.unstubAllGlobals());

  it("reads the scanner's DOM copy", async () => {
    vi.stubGlobal("fetch", async () => new Response('<input type="password">'));
    expect((await fetchCapability("https://dom.test/", PAGE, {}, signal)).passwordField).toBe(true);
  });

  it("reports why the DOM was refused", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"message":"DOM not available."}', { status: 400 }));
    expect(await fetchCapability("https://dom.test/", PAGE, {}, signal)).toEqual({
      ...EMPTY_CAPABILITY,
      error: "DOM not available",
    });
  });

  it("reports a timeout or network failure as an error, not an empty reading", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("t", "TimeoutError");
    });
    expect((await fetchCapability("https://dom.test/", PAGE, {}, signal)).error).toBe(
      "DOM fetch timed out",
    );
    vi.stubGlobal("fetch", async () => {
      throw new Error("reset");
    });
    expect((await fetchCapability("https://dom.test/", PAGE, {}, signal)).error).toBe("reset");
  });
});
