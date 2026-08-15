# URL indicator, phase 1 (passive) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a URL a checkable indicator that returns three layered verdicts
(the URL, its host, the host's IP) with one headline naming the layer it came from.

**Architecture:** A new `lib/url.ts` parses and canonicalizes. `detectIOC` gains
`"url"` and must test it before `domain`, since `parseDomain` already swallows
URL-shaped input. A new URL registry runs URL-native sources; the host and IP
layers reuse the **existing** domain and IP pipelines and their existing caches.
`lib/ti/url/check.ts` composes the three into a `UrlCheckResult`, which satisfies
`IndicatorResult` so `makeIndicatorRoute` needs no change.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Bun.

Spec: `docs/superpowers/specs/2026-08-15-url-indicator-design.md`

## Global Constraints

- Free sources only. No paid tier, no Censys, no paid Shodan.
- Run `bun run test` and `bun run lint` before declaring any task done. Use
  `bun run test`, never `bun test`.
- Tests are Vitest, colocated as `lib/**/*.test.ts`, pure, no network, `@/` alias.
- Sources never throw: catch and return
  `{ status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) }`.
- HTTP goes through `lib/ti/http.ts` helpers, never bare `fetch`.
- **A heuristic must never set `malicious: true`.** `computeFloor`
  (`lib/ti/aggregate.ts:41`) pins the score to 75 on any weighted malicious
  source; a guess reaching that gate would undo the false-positive work.
- `lib/ti/aggregate.ts` is not modified by this plan.
- User-facing copy uses commas, not dashes, as separators.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/url.ts` (create) | Parse + canonicalize a URL. No network. |
| `lib/ioc.ts` (modify) | Add `"url"` to `IOCType`, detect before domain. |
| `lib/ti/feeds/openphish.ts` (create) | Shared OpenPhish feed loader returning hosts **and** full URLs. |
| `lib/ti/domain/sources/openphish.ts` (modify) | Consume the shared loader; behaviour unchanged. |
| `lib/ti/url/heuristics.ts` (create) | Offline rules over a `ParsedUrl`. |
| `lib/ti/url/sources/urlhaus-url.ts` (create) | URLhaus `/v1/url/`. |
| `lib/ti/url/sources/safebrowsing-url.ts` (create) | Safe Browsing on the full URL. |
| `lib/ti/url/sources/openphish-url.ts` (create) | Exact-URL match against the feed. |
| `lib/ti/url/registry.ts` (create) | The URL source list. |
| `lib/ti/url/types.ts` (create) | `UrlLayer`, `UrlCheckResult`, `LayerKind`. |
| `lib/ti/url/layers.ts` (create) | Headline selection + layer assembly helpers. |
| `lib/ti/url/check.ts` (create) | Compose the three layers. |
| `lib/ti/url/shared-host.ts` (create) | Relabel co-tenancy on a known cloud ASN. |
| `lib/ti/url/validate.ts` (create) | Pure boundary validation for the route. |
| `lib/ti/cache.ts` (modify) | `getCachedUrlResult` / `setCachedUrlResult`. |
| `app/api/check-url/route.ts` (create) | Route via `makeIndicatorRoute`. |
| `components/CheckResults/layers.tsx` (create) | Layered verdict UI. |
| `components/CheckResults/index.tsx` (modify) | Dispatch to `UrlResults`. |

---

### Task 1: URL parsing and canonicalization

**Files:**
- Create: `lib/url.ts`
- Test: `lib/url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface ParsedUrl {
    /** scheme://host[:port]/path[?query] — no fragment, no userinfo. Cache key. */
    canonical: string;
    scheme: "http" | "https";
    /** punycode, lowercase, no trailing dot */
    host: string;
    /** only set when the port is not the scheme default */
    port?: number;
    /** always starts with "/", original case preserved */
    path: string;
    /** without the leading "?", original case preserved */
    query?: string;
    /** "user:pass" if present. Stripped from `canonical`, kept for heuristics. */
    userinfo?: string;
    /** true when the host is an IP literal rather than a name */
    isIpHost: boolean;
  }
  export function parseUrl(input: string): ParsedUrl | null;
  export function looksLikeUrl(input: string): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/url.test.ts
import { describe, expect, it } from "vitest";
import { parseUrl, looksLikeUrl } from "@/lib/url";

describe("parseUrl — canonicalization", () => {
  it("defaults a missing scheme to https", () => {
    expect(parseUrl("evil.com/login")!.canonical).toBe("https://evil.com/login");
  });

  it("drops the fragment, which is never sent to the server", () => {
    expect(parseUrl("https://evil.com/a#section")!.canonical).toBe(
      "https://evil.com/a",
    );
  });

  it("lowercases the host but preserves path and query case", () => {
    const p = parseUrl("https://EVIL.com/LogIn?Token=AbC")!;
    expect(p.host).toBe("evil.com");
    expect(p.path).toBe("/LogIn");
    expect(p.query).toBe("Token=AbC");
  });

  it("removes a default port and keeps a non-default one", () => {
    expect(parseUrl("https://evil.com:443/a")!.port).toBeUndefined();
    expect(parseUrl("https://evil.com:8443/a")!.port).toBe(8443);
    expect(parseUrl("https://evil.com:8443/a")!.canonical).toBe(
      "https://evil.com:8443/a",
    );
  });

  it("punycodes a unicode host", () => {
    expect(parseUrl("https://pаypal.com/")!.host).toMatch(/^xn--/);
  });

  it("strips userinfo from canonical but keeps it on the parse", () => {
    const p = parseUrl("https://user:pass@evil.com/a")!;
    expect(p.canonical).toBe("https://evil.com/a");
    expect(p.userinfo).toBe("user:pass");
  });

  it("gives an empty path the root slash", () => {
    expect(parseUrl("https://evil.com")!.path).toBe("/");
  });

  it("marks an IP-literal host", () => {
    expect(parseUrl("http://185.220.101.1/x")!.isIpHost).toBe(true);
    expect(parseUrl("http://evil.com/x")!.isIpHost).toBe(false);
  });
});

describe("parseUrl — rejection", () => {
  it.each([
    ["ftp://evil.com/a", "non-http scheme"],
    ["javascript:alert(1)", "non-http scheme"],
    ["https://", "no host"],
    ["not a url at all", "no host"],
  ])("rejects %s (%s)", (input) => {
    expect(parseUrl(input)).toBeNull();
  });

  it("rejects a URL longer than 2048 characters", () => {
    expect(parseUrl(`https://evil.com/${"a".repeat(2100)}`)).toBeNull();
  });
});

describe("looksLikeUrl", () => {
  it.each([
    ["evil.com", false],
    ["evil.com/login", true],
    ["evil.com?a=1", true],
    ["https://evil.com", true],
    ["8.8.8.8", false],
  ])("%s -> %s", (input, expected) => {
    expect(looksLikeUrl(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/url.test.ts`
Expected: FAIL, cannot resolve `@/lib/url`.

- [ ] **Step 3: Implement `lib/url.ts`**

```ts
import { parseIP } from "@/lib/ip";

export const MAX_URL_LENGTH = 2048;

export interface ParsedUrl {
  canonical: string;
  scheme: "http" | "https";
  host: string;
  port?: number;
  path: string;
  query?: string;
  userinfo?: string;
  isIpHost: boolean;
}

const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443" };

/**
 * True when the input is URL-shaped rather than a bare hostname: it carries a
 * scheme, a path, or a query. `detectIOC` uses this to decide between url and
 * domain, so a bare "evil.com" keeps its existing domain behaviour.
 */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
  // Strip a leading scheme-less authority, then look for a path or query.
  const rest = value.replace(/^[^/?#]*/, "");
  return rest.startsWith("/") || rest.startsWith("?");
}

/** Parse and canonicalize. Returns null for anything not a checkable http(s) URL. */
export function parseUrl(input: string): ParsedUrl | null {
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return null;

  // A scheme-less input is assumed https; an explicit non-http scheme is rejected
  // rather than coerced, so "javascript:" never becomes a checkable indicator.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;

  const userinfo = u.username
    ? u.password
      ? `${u.username}:${u.password}`
      : u.username
    : undefined;

  // URL already lowercases and punycodes hostname; drop a trailing root dot.
  const host = u.hostname.replace(/\.$/, "");
  if (!host) return null;

  const port =
    u.port && u.port !== DEFAULT_PORT[u.protocol] ? Number(u.port) : undefined;
  const path = u.pathname || "/";
  const query = u.search ? u.search.slice(1) : undefined;

  const authority = port ? `${host}:${port}` : host;
  const canonical = `${u.protocol}//${authority}${path}${query ? `?${query}` : ""}`;

  return {
    canonical,
    scheme: u.protocol === "http:" ? "http" : "https",
    host,
    port,
    path,
    query,
    userinfo,
    isIpHost: parseIP(host) !== null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/url.test.ts`
Expected: PASS.

If the punycode assertion fails, check the test input actually contains the
Cyrillic `а` (U+0430) rather than an ASCII `a`; `new URL` only punycodes
non-ASCII.

- [ ] **Step 5: Commit**

```bash
git add lib/url.ts lib/url.test.ts
git commit -m "feat(url): parse and canonicalize a URL indicator"
```

---

### Task 2: Detect URLs before domains

**Files:**
- Modify: `lib/ioc.ts:5` (the `IOCType` union) and `lib/ioc.ts:40` (`detectIOC`)
- Test: `lib/ioc.test.ts`

**Interfaces:**
- Consumes: `looksLikeUrl`, `parseUrl` from Task 1.
- Produces: `export type IOCType = "ip" | "domain" | "hash" | "url";`

**Why the order matters:** `parseDomain` (`lib/domain.ts:56`) accepts URL-shaped
input and strips scheme, path, and query. If `url` is tested after `domain`, it
never matches.

- [ ] **Step 1: Write the failing tests**

```ts
// append to lib/ioc.test.ts
describe("detectIOC — urls", () => {
  it.each([
    ["evil.com", "domain"],
    ["evil.com/login", "url"],
    ["evil.com?a=1", "url"],
    ["https://evil.com", "url"],
    ["https://evil.com/login.php?id=abc", "url"],
    ["hxxps://evil[.]com/a", "url"],
    ["8.8.8.8", "ip"],
    ["d41d8cd98f00b204e9800998ecf8427e", "hash"],
  ])("%s -> %s", (input, expected) => {
    expect(detectIOC(input)).toBe(expected);
  });

  it("does not call a scheme-less IP with a path a domain", () => {
    expect(detectIOC("185.220.101.1/admin")).toBe("url");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ioc.test.ts`
Expected: FAIL, `evil.com/login` returns `"domain"`.

- [ ] **Step 3: Add the url branch**

In `lib/ioc.ts`, extend the union and insert the url test between hash and ip:

```ts
export type IOCType = "ip" | "domain" | "hash" | "url";

export function detectIOC(input: string): IOCType | null {
  const value = refangIOC(input);
  if (!value) return null;
  if (parseHash(value)) return "hash";
  // Before ip and domain: parseDomain accepts URL-shaped input and silently
  // strips the path, which is where a phishing verdict lives.
  if (looksLikeUrl(value) && parseUrl(value)) return "url";
  if (parseIP(value)) return "ip";
  if (parseDomain(value)) return "domain";
  return null;
}
```

Add the import: `import { looksLikeUrl, parseUrl } from "@/lib/url";`

- [ ] **Step 4: Run the full suite**

Run: `bun run test && bun run typecheck`
Expected: PASS. `IOCType` is exhaustively switched in places such as
`lib/ti/research/types.ts`; typecheck will name any switch that now needs a
`url` arm. Add `url` arms that behave like `domain` for research providers, or
exclude `url` from that provider's `supports` list, whichever the provider's
comment says it can answer for.

- [ ] **Step 5: Commit**

```bash
git add lib/ioc.ts lib/ioc.test.ts
git commit -m "feat(ioc): detect a URL before falling through to domain"
```

---

### Task 3: Offline URL heuristics

**Files:**
- Create: `lib/ti/url/heuristics.ts`
- Test: `lib/ti/url/heuristics.test.ts`

**Interfaces:**
- Consumes: `ParsedUrl` from Task 1; `SourceFinding`, `TiSource` from `lib/ti/types`.
- Produces:
  ```ts
  export interface HeuristicHit { id: string; label: string; score: number; category: string; }
  export function urlHeuristics(parsed: ParsedUrl): HeuristicHit[];
  export function heuristicsFinding(parsed: ParsedUrl): SourceFinding;
  export const urlHeuristicsSource: TiSource;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/ti/url/heuristics.test.ts
import { describe, expect, it } from "vitest";
import { parseUrl } from "@/lib/url";
import { heuristicsFinding, urlHeuristics } from "@/lib/ti/url/heuristics";

const hits = (input: string) => urlHeuristics(parseUrl(input)!).map((h) => h.id);

describe("urlHeuristics", () => {
  it("flags a punycode host", () => {
    expect(hits("https://xn--pypal-4ve.com/login")).toContain("punycode");
  });
  it("flags a brand lookalike", () => {
    expect(hits("https://paypa1-secure.com/login")).toContain("brand-lookalike");
  });
  it("flags a raw IP host", () => {
    expect(hits("http://185.220.101.1/admin")).toContain("ip-host");
  });
  it("flags embedded credentials", () => {
    expect(hits("https://user:pass@evil.com/a")).toContain("credentials");
  });
  it("flags an open-redirect parameter", () => {
    expect(hits("https://ok.com/go?next=https://evil.com")).toContain("open-redirect");
  });
  it("flags a base64 blob in the path", () => {
    expect(hits(`https://ok.com/${"QUJDREVGR0hJSktMTU5PUFFSU1Q".repeat(2)}`)).toContain("encoded-blob");
  });
  it("flags an executable path", () => {
    expect(hits("https://ok.com/invoice.pdf.exe")).toContain("executable");
  });
  it("flags a known shortener", () => {
    expect(hits("https://bit.ly/3abcdef")).toContain("shortener");
  });
  it("flags a non-standard port", () => {
    expect(hits("https://ok.com:8443/a")).toContain("odd-port");
  });
  it("finds nothing on an ordinary URL", () => {
    expect(hits("https://www.google.com/search?q=hello")).toEqual([]);
  });
});

describe("heuristicsFinding", () => {
  it("never declares a definitive malicious listing", () => {
    // The floor gate in aggregate.ts pins 75 on any weighted malicious source.
    // A guess must not be able to reach it, for ANY input.
    const inputs = [
      "https://user:pass@xn--pypal-4ve.com:8443/invoice.pdf.exe?next=https://evil.com",
      "http://185.220.101.1/admin",
      "https://bit.ly/3abcdef",
      "https://www.google.com/",
    ];
    for (const input of inputs) {
      const finding = heuristicsFinding(parseUrl(input)!);
      expect(finding.malicious).toBeUndefined();
    }
  });

  it("caps the score below the malicious cutoff", () => {
    const worst = heuristicsFinding(
      parseUrl("https://user:pass@xn--pypal-4ve.com:8443/invoice.pdf.exe?next=https://evil.com")!,
    );
    expect(worst.score).toBeLessThan(70);
    expect(worst.status).toBe("ok");
  });

  it("scores an ordinary URL at zero with a plain summary", () => {
    const finding = heuristicsFinding(parseUrl("https://www.google.com/")!);
    expect(finding.score).toBe(0);
    expect(finding.summary).toBe("No structural red flags");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/url/heuristics.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the rules**

```ts
// lib/ti/url/heuristics.ts
import type { ParsedUrl } from "@/lib/url";
import type { SourceFinding, TiSource } from "../types";
import { parseUrl } from "@/lib/url";

export interface HeuristicHit {
  id: string;
  label: string;
  score: number;
  category: string;
}

/** Ceiling for the combined heuristic score. Deliberately below MALICIOUS_AT
 *  (70) so structure alone can raise suspicion but never reach a malicious
 *  verdict on its own. */
const SCORE_CAP = 65;

const BRANDS = [
  "paypal", "microsoft", "apple", "google", "amazon", "facebook", "netflix",
  "instagram", "whatsapp", "linkedin", "dhl", "fedex", "chase", "wellsfargo",
];

const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy", "t.ly",
]);

const REDIRECT_PARAMS = new Set([
  "url", "next", "redirect", "redirect_uri", "return", "returnurl", "r", "u",
  "dest", "destination", "continue", "goto",
]);

const EXECUTABLE = /\.(exe|scr|hta|js|jar|bat|cmd|ps1|vbs|msi)$/i;
const DOUBLE_EXT = /\.(pdf|doc|docx|xls|xlsx|jpg|png|txt)\.[a-z0-9]{2,4}$/i;
const BLOB = /[A-Za-z0-9+/=]{40,}/;

/** Levenshtein distance, small inputs only. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

/** Labels of the host, minus the public suffix guess, for brand comparison. */
function brandCandidates(host: string): string[] {
  return host.split(".").slice(0, -1).flatMap((l) => l.split(/[-_]/)).filter(Boolean);
}

export function urlHeuristics(parsed: ParsedUrl): HeuristicHit[] {
  const hits: HeuristicHit[] = [];
  const push = (id: string, label: string, score: number, category: string) =>
    hits.push({ id, label, score, category });

  if (parsed.host.split(".").some((l) => l.startsWith("xn--"))) {
    push("punycode", "Host uses punycode, which can imitate another name", 30, "homograph");
  }
  if (parsed.isIpHost) {
    push("ip-host", "Host is a raw IP address, with no domain behind it", 20, "infrastructure");
  }
  if (parsed.userinfo) {
    push("credentials", "Credentials embedded in the URL", 25, "phishing");
  }
  if (parsed.port) {
    push("odd-port", `Non-standard port ${parsed.port}`, 10, "infrastructure");
  }
  if (SHORTENERS.has(parsed.host)) {
    push("shortener", "URL shortener, the destination is not visible", 15, "obfuscation");
  }
  for (const candidate of brandCandidates(parsed.host)) {
    const near = BRANDS.find(
      (b) => candidate !== b && candidate.length >= 4 && distance(candidate, b) <= 2,
    );
    if (near) {
      push("brand-lookalike", `Host resembles the brand "${near}"`, 30, "typosquat");
      break;
    }
  }
  const params = new URLSearchParams(parsed.query ?? "");
  for (const key of params.keys()) {
    if (REDIRECT_PARAMS.has(key.toLowerCase()) && /https?:\/\//i.test(params.get(key) ?? "")) {
      push("open-redirect", `Parameter "${key}" carries another URL`, 20, "redirect");
      break;
    }
  }
  if (BLOB.test(parsed.path) || BLOB.test(parsed.query ?? "")) {
    push("encoded-blob", "Long encoded blob in the path or query", 10, "obfuscation");
  }
  if (EXECUTABLE.test(parsed.path) || DOUBLE_EXT.test(parsed.path)) {
    push("executable", "Path points at an executable or double extension", 25, "malware-delivery");
  }
  return hits;
}

/**
 * Structural signal only. This never sets `malicious`, and its total is capped
 * below the malicious cutoff: `computeFloor` in aggregate.ts pins the score to
 * 75 for any weighted source that declares `malicious`, and a guess about URL
 * shape has no business reaching that gate.
 */
export function heuristicsFinding(parsed: ParsedUrl): SourceFinding {
  const hits = urlHeuristics(parsed);
  if (hits.length === 0) {
    return { status: "ok", score: 0, summary: "No structural red flags" };
  }
  const score = Math.min(SCORE_CAP, hits.reduce((sum, h) => sum + h.score, 0));
  return {
    status: "ok",
    score,
    categories: [...new Set(hits.map((h) => h.category))],
    summary:
      hits.length === 1
        ? hits[0].label
        : `${hits.length} structural red flags, strongest: ${
            [...hits].sort((a, b) => b.score - a.score)[0].label
          }`,
    details: { hits },
  };
}

/** Offline URL structure check. Low weight: it is evidence of shape, not of
 *  reputation, and it must not be able to carry a verdict alone. */
export const urlHeuristicsSource: TiSource = {
  meta: {
    id: "url-heuristics",
    name: "URL structure",
    url: "https://github.com/algorithm368/project-ophanim",
    category: "context",
    requiresKey: false,
    weight: 0.3,
  },
  isEnabled: () => true,
  async check(url): Promise<SourceFinding> {
    const parsed = parseUrl(url);
    if (!parsed) return { status: "error", error: "Unparseable URL" };
    return heuristicsFinding(parsed);
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/ti/url/heuristics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/url/heuristics.ts lib/ti/url/heuristics.test.ts
git commit -m "feat(url): offline structural heuristics that can never floor the score"
```

---

### Task 4: Share the OpenPhish feed, keep full URLs

**Files:**
- Create: `lib/ti/feeds/openphish.ts`
- Modify: `lib/ti/domain/sources/openphish.ts` (use the shared loader)
- Create: `lib/ti/url/sources/openphish-url.ts`
- Test: `lib/ti/url/sources/openphish-url.test.ts`

**Why:** `loadFeed` currently calls `hostOf(line)` and throws the rest away
(`lib/ti/domain/sources/openphish.ts:37`). The feed lines are full URLs, so an
exact-URL match is available and is strictly stronger than the host match.

**Interfaces:**
- Produces:
  ```ts
  // lib/ti/feeds/openphish.ts
  export interface OpenphishFeed { hosts: Set<string>; urls: Set<string>; fetchedAt: number }
  export function loadOpenphishFeed(signal: AbortSignal): Promise<OpenphishFeed>;
  export function resetOpenphishCache(): void; // tests only
  export function hostOf(url: string): string | null;
  // lib/ti/url/sources/openphish-url.ts
  export const openphishUrlSource: TiSource;
  ```
  The URL set stores canonical forms produced by `parseUrl(line)!.canonical`, so
  a feed entry and a pasted URL compare equal after canonicalization.

- [ ] **Step 1: Write the failing test**

```ts
// lib/ti/url/sources/openphish-url.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { openphishUrlSource } from "@/lib/ti/url/sources/openphish-url";
import { resetOpenphishCache } from "@/lib/ti/feeds/openphish";

const FEED = [
  "https://evil.com/login.php?id=abc",
  "http://other.test/a",
].join("\n");

afterEach(() => {
  resetOpenphishCache();
  vi.unstubAllGlobals();
});

function stubFeed(body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200 })),
  );
}

describe("openphishUrlSource", () => {
  it("matches an exact URL from the feed", async () => {
    stubFeed(FEED);
    const finding = await openphishUrlSource.check(
      "https://evil.com/login.php?id=abc",
      AbortSignal.timeout(5000),
    );
    expect(finding.status).toBe("ok");
    expect(finding.malicious).toBe(true);
    expect(finding.score).toBe(90);
  });

  it("does not match a different path on a listed host", async () => {
    stubFeed(FEED);
    const finding = await openphishUrlSource.check(
      "https://evil.com/other",
      AbortSignal.timeout(5000),
    );
    expect(finding.malicious).toBeUndefined();
    expect(finding.score).toBe(0);
    expect(finding.summary).toContain("host appears");
  });

  it("reports an unreachable feed as an error, not a clean result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const finding = await openphishUrlSource.check(
      "https://evil.com/login.php?id=abc",
      AbortSignal.timeout(5000),
    );
    expect(finding.status).toBe("error");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/url/sources/openphish-url.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Extract the shared loader**

Move the cache, `hostOf`, and `loadFeed` out of
`lib/ti/domain/sources/openphish.ts` into `lib/ti/feeds/openphish.ts`, keeping
both sets:

```ts
// lib/ti/feeds/openphish.ts
import { errorMessage, getText } from "../http";
import { parseUrl } from "@/lib/url";

const FEED_URL =
  "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt";
const TTL_MS = 30 * 60 * 1000;

export interface OpenphishFeed {
  hosts: Set<string>;
  /** Canonical URLs, so a feed line and a pasted URL compare equal. */
  urls: Set<string>;
  fetchedAt: number;
}

let cache: OpenphishFeed | null = null;
let inflight: Promise<OpenphishFeed> | null = null;

/** Tests only: drop the module-level feed cache between cases. */
export function resetOpenphishCache(): void {
  cache = null;
  inflight = null;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

export async function loadOpenphishFeed(signal: AbortSignal): Promise<OpenphishFeed> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const { ok, status, text } = await getText(FEED_URL, signal);
    if (!ok || !text) throw new Error(`feed unavailable (HTTP ${status})`);
    const hosts = new Set<string>();
    const urls = new Set<string>();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const host = hostOf(trimmed);
      if (host) hosts.add(host);
      const parsed = parseUrl(trimmed);
      if (parsed) urls.add(parsed.canonical);
    }
    cache = { hosts, urls, fetchedAt: Date.now() };
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
```

Then in `lib/ti/domain/sources/openphish.ts`, delete the moved code and import
`loadOpenphishFeed` and `hostOf` from `../../feeds/openphish`, changing
`const { hosts } = await loadFeed(signal)` to
`const { hosts } = await loadOpenphishFeed(signal)`. Its existing tests must
still pass unchanged; if `openphish.test.ts` imports `hostOf` from the old path,
re-export it from the source file so the test keeps compiling.

- [ ] **Step 4: Implement the URL source**

```ts
// lib/ti/url/sources/openphish-url.ts
import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { loadOpenphishFeed } from "../../feeds/openphish";
import { parseUrl } from "@/lib/url";

/** OpenPhish community phishing feed, matched on the exact URL (no key). */
export const openphishUrlSource: TiSource = {
  meta: {
    id: "openphish-url",
    name: "OpenPhish (URL)",
    url: "https://openphish.com",
    category: "blocklist",
    requiresKey: false,
    weight: 0.9,
  },
  isEnabled: () => true,
  async check(url, signal): Promise<SourceFinding> {
    try {
      const parsed = parseUrl(url);
      if (!parsed) return { status: "error", error: "Unparseable URL" };
      const { urls, hosts } = await loadOpenphishFeed(signal);
      if (urls.has(parsed.canonical)) {
        return {
          status: "ok",
          malicious: true,
          score: 90,
          categories: ["phishing"],
          summary: "Exact URL is on the OpenPhish feed",
        };
      }
      if (hosts.has(parsed.host)) {
        return {
          status: "ok",
          score: 0,
          summary: `Not listed, though the host appears on the feed for other URLs`,
        };
      }
      return { status: "ok", score: 0, summary: "Not on the OpenPhish feed" };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
```

- [ ] **Step 5: Run the tests**

Run: `bun run test lib/ti/url/sources/openphish-url.test.ts lib/ti/domain/sources/openphish.test.ts`
Expected: PASS both, the domain source's behaviour unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/feeds/openphish.ts lib/ti/domain/sources/openphish.ts \
        lib/ti/url/sources/openphish-url.ts lib/ti/url/sources/openphish-url.test.ts
git commit -m "feat(url): exact-URL matching against the OpenPhish feed"
```

---

### Task 5: URLhaus and Safe Browsing on the full URL

**Files:**
- Create: `lib/ti/url/sources/urlhaus-url.ts`
- Create: `lib/ti/url/sources/safebrowsing-url.ts`
- Test: `lib/ti/url/sources/urlhaus-url.test.ts`, `lib/ti/url/sources/safebrowsing-url.test.ts`

**Verified contract:** `POST https://urlhaus-api.abuse.ch/v1/url/` with
`url=<url>` and header `Auth-Key: <THREATFOX_API_KEY>`. Probed 2026-08-15:
without a key it answers **401**, exactly like the `/v1/host/` endpoint already
in use at `lib/ti/domain/sources/urlhaus.ts:70`.

**Interfaces:**
- Produces: `export const urlhausUrlSource: TiSource;`,
  `export const safeBrowsingUrlSource: TiSource;`,
  `export function urlhausUrlFinding(data: UrlhausUrlResponse): SourceFinding;`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/ti/url/sources/urlhaus-url.test.ts
import { describe, expect, it } from "vitest";
import { urlhausUrlFinding } from "@/lib/ti/url/sources/urlhaus-url";

describe("urlhausUrlFinding", () => {
  it("treats an online malware URL as malicious", () => {
    const finding = urlhausUrlFinding({
      query_status: "ok",
      url_status: "online",
      threat: "malware_download",
      date_added: "2026-08-01 10:00:00 UTC",
      tags: ["emotet"],
    });
    expect(finding.malicious).toBe(true);
    expect(finding.score).toBe(95);
    expect(finding.categories).toContain("emotet");
  });

  it("keeps an offline listing malicious but scores it lower", () => {
    const finding = urlhausUrlFinding({
      query_status: "ok",
      url_status: "offline",
      threat: "malware_download",
      date_added: "2024-01-01 10:00:00 UTC",
    });
    expect(finding.malicious).toBe(true);
    expect(finding.score).toBe(75);
    expect(finding.summary).toContain("offline");
  });

  it("returns a clean zero for no_results", () => {
    const finding = urlhausUrlFinding({ query_status: "no_results" });
    expect(finding.malicious).toBeUndefined();
    expect(finding.score).toBe(0);
  });
});
```

```ts
// lib/ti/url/sources/safebrowsing-url.test.ts
import { describe, expect, it } from "vitest";
import { safeBrowsingFinding } from "@/lib/ti/url/sources/safebrowsing-url";

describe("safeBrowsingFinding", () => {
  it("maps a SOCIAL_ENGINEERING match to a malicious phishing finding", () => {
    const finding = safeBrowsingFinding([
      { threatType: "SOCIAL_ENGINEERING", platformType: "ANY_PLATFORM" },
    ]);
    expect(finding.malicious).toBe(true);
    expect(finding.categories).toContain("phishing");
  });

  it("returns a clean zero for no matches", () => {
    expect(safeBrowsingFinding([]).score).toBe(0);
    expect(safeBrowsingFinding([]).malicious).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/url/sources/`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the URLhaus source**

```ts
// lib/ti/url/sources/urlhaus-url.ts
import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postForm } from "../../http";

export interface UrlhausUrlResponse {
  query_status: string;
  url_status?: string;
  threat?: string;
  date_added?: string;
  last_online?: string;
  tags?: string[];
  reporter?: string;
}

/** Map a URLhaus URL record to a finding. An offline listing stays malicious,
 *  the URL was weaponized, but scores below a live one. */
export function urlhausUrlFinding(data: UrlhausUrlResponse): SourceFinding {
  if (data.query_status !== "ok") {
    return { status: "ok", score: 0, summary: "Not on URLhaus" };
  }
  const online = data.url_status === "online";
  return {
    status: "ok",
    malicious: true,
    score: online ? 95 : 75,
    categories: [data.threat ?? "malware", ...(data.tags ?? [])].filter(Boolean),
    lastSeen: data.last_online ?? data.date_added,
    summary: online
      ? `Live ${data.threat ?? "malware"} URL on URLhaus`
      : `Known ${data.threat ?? "malware"} URL on URLhaus, currently offline`,
    details: {
      urlStatus: data.url_status,
      threat: data.threat,
      dateAdded: data.date_added,
      tags: data.tags,
      reporter: data.reporter,
    },
    raw: data,
  };
}

/** URLhaus (abuse.ch) URL-level lookup. One abuse.ch key covers ThreatFox and
 *  URLhaus, so it reuses THREATFOX_API_KEY like the host-level source does. */
export const urlhausUrlSource: TiSource = {
  meta: {
    id: "urlhaus-url",
    name: "URLhaus (URL)",
    url: "https://urlhaus.abuse.ch",
    category: "blocklist",
    requiresKey: true,
    keyEnv: "THREATFOX_API_KEY",
    weight: 1,
  },
  isEnabled: () => Boolean(process.env.THREATFOX_API_KEY),
  async check(url, signal): Promise<SourceFinding> {
    try {
      const key = process.env.THREATFOX_API_KEY;
      if (!key) return { status: "skipped" };
      const { ok, status, data } = await postForm<UrlhausUrlResponse>(
        "https://urlhaus-api.abuse.ch/v1/url/",
        signal,
        { url },
        { "Auth-Key": key },
      );
      if (!ok || !data) {
        return { status: "error", error: `HTTP ${status}` };
      }
      return urlhausUrlFinding(data);
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
```

- [ ] **Step 4: Implement the Safe Browsing source**

Copy the request shape from `lib/ti/domain/sources/safebrowsing.ts:49`, changing
only the `threatEntries` value from the bare domain to the full URL:

```ts
// lib/ti/url/sources/safebrowsing-url.ts
import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postJson } from "../../http";

interface ThreatMatch {
  threatType?: string;
  platformType?: string;
  cacheDuration?: string;
}

const CATEGORY: Record<string, string> = {
  SOCIAL_ENGINEERING: "phishing",
  MALWARE: "malware",
  UNWANTED_SOFTWARE: "pua",
  POTENTIALLY_HARMFUL_APPLICATION: "pua",
};

export function safeBrowsingFinding(matches: ThreatMatch[]): SourceFinding {
  if (matches.length === 0) {
    return { status: "ok", score: 0, summary: "No Safe Browsing match" };
  }
  const categories = matches.map((m) => CATEGORY[m.threatType ?? ""] ?? "malware");
  return {
    status: "ok",
    malicious: true,
    score: 95,
    categories: [...new Set(categories)],
    summary: `Google Safe Browsing flags this URL as ${[...new Set(categories)].join(", ")}`,
    details: { matches },
    raw: matches,
  };
}

/** Google Safe Browsing v4, on the full URL rather than the bare host. */
export const safeBrowsingUrlSource: TiSource = {
  meta: {
    id: "safebrowsing-url",
    name: "Google Safe Browsing (URL)",
    url: "https://safebrowsing.google.com",
    category: "reputation",
    requiresKey: true,
    keyEnv: "GOOGLE_SAFE_BROWSING_API_KEY",
    weight: 1,
  },
  isEnabled: () => Boolean(process.env.GOOGLE_SAFE_BROWSING_API_KEY),
  async check(url, signal): Promise<SourceFinding> {
    try {
      const key = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
      if (!key) return { status: "skipped" };
      const { ok, status, data } = await postJson<{ matches?: ThreatMatch[] }>(
        `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`,
        signal,
        {
          client: { clientId: "project-ophanim", clientVersion: "1.0.0" },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        },
      );
      if (!ok || !data) return { status: "error", error: `HTTP ${status}` };
      return safeBrowsingFinding(data.matches ?? []);
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
```

- [ ] **Step 5: Run the tests**

Run: `bun run test lib/ti/url/sources/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/url/sources/urlhaus-url.ts lib/ti/url/sources/urlhaus-url.test.ts \
        lib/ti/url/sources/safebrowsing-url.ts lib/ti/url/sources/safebrowsing-url.test.ts
git commit -m "feat(url): URLhaus and Safe Browsing lookups on the full URL"
```

---

### Task 6: The URL registry and the URL layer

**Files:**
- Create: `lib/ti/url/registry.ts`
- Create: `lib/ti/url/types.ts`
- Test: `lib/ti/url/registry.test.ts`

**Interfaces:**
- Consumes: the three sources from Tasks 3-5.
- Produces:
  ```ts
  // lib/ti/url/registry.ts
  export const urlSources: TiSource[];
  // lib/ti/url/types.ts
  export type LayerKind = "url" | "domain" | "ip";
  export type LayerStatus = "ok" | "unavailable" | "not-applicable";
  export interface UrlLayer {
    kind: LayerKind;
    /** the URL, host, or IP this layer actually checked */
    indicator: string;
    status: LayerStatus;
    /** why it is unavailable or not applicable, shown in the UI */
    reason?: string;
    riskScore: number;
    verdict: Verdict;
    sources: SourceResult[];
    stats: CheckStats;
    scoreBreakdown?: ScoreBreakdown;
    /** set when this layer was served from its own per-type cache */
    cachedAt?: string;
  }
  export interface UrlCheckResult {
    url: string;
    checkedAt: string;
    riskScore: number;
    verdict: Verdict;
    headlineLayer: LayerKind;
    layers: UrlLayer[];
    /** resolved addresses that were NOT checked, so a multi-homed host does not
     *  read as if every address were cleared */
    otherAddresses?: string[];
    sources: SourceResult[];
    stats: CheckStats;
    history?: HistorySnapshot[];
    cached?: boolean;
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// lib/ti/url/registry.test.ts
import { describe, expect, it } from "vitest";
import { urlSources } from "@/lib/ti/url/registry";

describe("urlSources", () => {
  it("has unique ids", () => {
    const ids = urlSources.map((s) => s.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every heuristic-style source under the floor weight", () => {
    // FLOOR_MIN_WEIGHT is 0.7: only genuinely authoritative listings may pin a
    // verdict alone. The structural check must stay well below it.
    const heuristics = urlSources.find((s) => s.meta.id === "url-heuristics")!;
    expect(heuristics.meta.weight).toBeLessThan(0.7);
  });

  it("declares keyEnv on every key-gated source", () => {
    for (const s of urlSources) {
      if (s.meta.requiresKey) expect(s.meta.keyEnv).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/url/registry.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the registry and the types**

```ts
// lib/ti/url/registry.ts
import type { TiSource } from "../types";
import { urlHeuristicsSource } from "./heuristics";
import { openphishUrlSource } from "./sources/openphish-url";
import { safeBrowsingUrlSource } from "./sources/safebrowsing-url";
import { urlhausUrlSource } from "./sources/urlhaus-url";

/** Sources that answer for a full URL. Order is display order. */
export const urlSources: TiSource[] = [
  urlhausUrlSource,
  safeBrowsingUrlSource,
  openphishUrlSource,
  urlHeuristicsSource,
];
```

Write `lib/ti/url/types.ts` with exactly the interfaces in the **Produces**
block above, importing `Verdict`, `SourceResult`, `CheckStats`,
`ScoreBreakdown`, and `HistorySnapshot` from `../types`.

- [ ] **Step 4: Run the test**

Run: `bun run test lib/ti/url/registry.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/url/registry.ts lib/ti/url/registry.test.ts lib/ti/url/types.ts
git commit -m "feat(url): the URL source registry and layered result types"
```

---

### Task 7: Headline selection

**Files:**
- Create: `lib/ti/url/layers.ts`
- Test: `lib/ti/url/layers.test.ts`

**Interfaces:**
- Consumes: `UrlLayer`, `LayerKind` from Task 6.
- Produces:
  ```ts
  export function selectHeadline(layers: UrlLayer[]):
    { kind: LayerKind; riskScore: number; verdict: Verdict };
  ```

**Rule:** the highest-scoring `ok` layer wins; ties break toward the more
specific layer (url > domain > ip). If no layer is `ok`, the headline is
`unknown` at score 0 on the `url` layer. A non-`ok` layer never contributes.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/ti/url/layers.test.ts
import { describe, expect, it } from "vitest";
import { selectHeadline } from "@/lib/ti/url/layers";
import type { UrlLayer } from "@/lib/ti/url/types";

const layer = (over: Partial<UrlLayer> & Pick<UrlLayer, "kind">): UrlLayer => ({
  indicator: "x",
  status: "ok",
  riskScore: 0,
  verdict: "clean",
  sources: [],
  stats: { total: 0, queried: 0, flagged: 0, skipped: 0, errored: 0 },
  ...over,
});

describe("selectHeadline", () => {
  it("picks the worst layer and names it", () => {
    const head = selectHeadline([
      layer({ kind: "url", riskScore: 5, verdict: "clean" }),
      layer({ kind: "domain", riskScore: 20, verdict: "low" }),
      layer({ kind: "ip", riskScore: 80, verdict: "malicious" }),
    ]);
    expect(head).toEqual({ kind: "ip", riskScore: 80, verdict: "malicious" });
  });

  it("breaks a tie toward the more specific layer", () => {
    const head = selectHeadline([
      layer({ kind: "ip", riskScore: 50, verdict: "suspicious" }),
      layer({ kind: "url", riskScore: 50, verdict: "suspicious" }),
    ]);
    expect(head.kind).toBe("url");
  });

  it("ignores a layer that could not run", () => {
    const head = selectHeadline([
      layer({ kind: "url", riskScore: 10, verdict: "low" }),
      layer({ kind: "ip", status: "unavailable", riskScore: 0, verdict: "unknown" }),
    ]);
    expect(head.kind).toBe("url");
    expect(head.riskScore).toBe(10);
  });

  it("is unknown when no layer ran, never clean", () => {
    const head = selectHeadline([
      layer({ kind: "url", status: "unavailable", verdict: "unknown" }),
      layer({ kind: "ip", status: "unavailable", verdict: "unknown" }),
    ]);
    expect(head.verdict).toBe("unknown");
    expect(head.riskScore).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/url/layers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/ti/url/layers.ts
import type { Verdict } from "../types";
import type { LayerKind, UrlLayer } from "./types";

/** More specific first. Used only to break a score tie. */
const SPECIFICITY: LayerKind[] = ["url", "domain", "ip"];

/**
 * The headline is the worst layer that actually ran. A layer that could not run
 * contributes nothing, and if none ran the headline is unknown rather than
 * clean: silence is not evidence of safety.
 */
export function selectHeadline(layers: UrlLayer[]): {
  kind: LayerKind;
  riskScore: number;
  verdict: Verdict;
} {
  const ran = layers.filter((l) => l.status === "ok");
  if (ran.length === 0) {
    return { kind: "url", riskScore: 0, verdict: "unknown" };
  }
  const best = [...ran].sort(
    (a, b) =>
      b.riskScore - a.riskScore ||
      SPECIFICITY.indexOf(a.kind) - SPECIFICITY.indexOf(b.kind),
  )[0];
  return { kind: best.kind, riskScore: best.riskScore, verdict: best.verdict };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test lib/ti/url/layers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/url/layers.ts lib/ti/url/layers.test.ts
git commit -m "feat(url): headline picks the worst layer that actually ran"
```

---

### Task 8: Compose the three layers

**Files:**
- Create: `lib/ti/url/check.ts`
- Test: `lib/ti/url/check.test.ts`

**Interfaces:**
- Consumes: `selectHeadline` (Task 7), `urlSources` (Task 6), `parseUrl`
  (Task 1), plus the existing `runAll` (`lib/ti/orchestrate.ts`), `checkDomain`
  (`lib/ti/domain/check.ts`), `checkIp` (`lib/ti/check.ts`),
  `getCachedDomainResult` / `getCachedResult` (`lib/ti/cache.ts`),
  `dohQuery` and `answers` (`lib/ti/dns/doh.ts`), `aggregateRisk`
  (`lib/ti/aggregate.ts`), `computeStats` (`lib/ti/assemble.ts`).
- Produces:
  ```ts
  export interface CheckUrlDeps {
    resolve?: (host: string, signal: AbortSignal) => Promise<string[]>;
    checkDomainLayer?: typeof checkDomain;
    checkIpLayer?: typeof checkIp;
    getCachedDomain?: typeof getCachedDomainResult;
    getCachedIp?: typeof getCachedResult;
  }
  export function checkUrl(
    url: string,
    onSettled?: (r: SourceResult) => void,
    deps?: CheckUrlDeps,
  ): Promise<UrlCheckResult>;
  ```
  `deps` exists so the test can drive the composition without network. Production
  callers pass nothing.

**Behaviour:**
- The URL layer runs `runAll(urlSources, canonical, onSettled)`.
- The host layer: if `parsed.isIpHost`, status `not-applicable` with reason
  `"The URL addresses an IP directly, so there is no host to check"`. Otherwise
  read `getCachedDomainResult(host)` first and use it (setting `cachedAt`), else
  run `checkDomain`.
- The IP layer: resolve A, fall back to AAAA. Check **the first address only**;
  the rest go in `otherAddresses`. Read `getCachedResult(ip)` first, else run
  `checkIp`. If resolution yields nothing, status `unavailable` with reason
  `"The host did not resolve, so there is no address to check"`.
- `sources` is every layer's rows concatenated, so `makeIndicatorRoute` and the
  history writer need no change.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/ti/url/check.test.ts
import { describe, expect, it, vi } from "vitest";
import { checkUrl } from "@/lib/ti/url/check";
import type { CheckResult, DomainCheckResult } from "@/lib/ti/types";

const STATS = { total: 1, queried: 1, flagged: 0, skipped: 0, errored: 0 };

const domainResult = (over: Partial<DomainCheckResult> = {}): DomainCheckResult => ({
  domain: "evil.com",
  checkedAt: "2026-08-15T00:00:00.000Z",
  riskScore: 0,
  verdict: "clean",
  sources: [],
  stats: STATS,
  ...over,
});

const ipResult = (over: Partial<CheckResult> = {}): CheckResult => ({
  ip: "1.2.3.4",
  checkedAt: "2026-08-15T00:00:00.000Z",
  riskScore: 0,
  verdict: "clean",
  sources: [],
  stats: STATS,
  ...over,
});

const deps = (over = {}) => ({
  resolve: vi.fn(async () => ["1.2.3.4"]),
  checkDomainLayer: vi.fn(async () => domainResult()),
  checkIpLayer: vi.fn(async () => ipResult()),
  getCachedDomain: vi.fn(async () => null),
  getCachedIp: vi.fn(async () => null),
  ...over,
});

describe("checkUrl", () => {
  it("produces three layers and a headline naming the worst", async () => {
    const result = await checkUrl(
      "https://evil.com/login",
      undefined,
      deps({
        checkIpLayer: vi.fn(async () => ipResult({ riskScore: 80, verdict: "malicious" })),
      }),
    );
    expect(result.layers.map((l) => l.kind)).toEqual(["url", "domain", "ip"]);
    expect(result.headlineLayer).toBe("ip");
    expect(result.verdict).toBe("malicious");
  });

  it("reuses a cached host layer instead of re-running it", async () => {
    const d = deps({
      getCachedDomain: vi.fn(async () => domainResult({ riskScore: 30, verdict: "low" })),
    });
    const result = await checkUrl("https://evil.com/login", undefined, d);
    expect(d.checkDomainLayer).not.toHaveBeenCalled();
    const host = result.layers.find((l) => l.kind === "domain")!;
    expect(host.riskScore).toBe(30);
    expect(host.cachedAt).toBe("2026-08-15T00:00:00.000Z");
  });

  it("marks the host layer not-applicable for an IP-literal URL", async () => {
    const d = deps();
    const result = await checkUrl("http://1.2.3.4/admin", undefined, d);
    const host = result.layers.find((l) => l.kind === "domain")!;
    expect(host.status).toBe("not-applicable");
    expect(d.checkDomainLayer).not.toHaveBeenCalled();
  });

  it("marks the IP layer unavailable when the host does not resolve", async () => {
    const result = await checkUrl(
      "https://evil.com/login",
      undefined,
      deps({ resolve: vi.fn(async () => []) }),
    );
    const ip = result.layers.find((l) => l.kind === "ip")!;
    expect(ip.status).toBe("unavailable");
    expect(ip.verdict).toBe("unknown");
    expect(ip.reason).toContain("did not resolve");
  });

  it("checks only the first address and records the rest as unchecked", async () => {
    const d = deps({ resolve: vi.fn(async () => ["1.2.3.4", "5.6.7.8"]) });
    const result = await checkUrl("https://evil.com/a", undefined, d);
    expect(d.checkIpLayer).toHaveBeenCalledWith("1.2.3.4", undefined);
    expect(result.otherAddresses).toEqual(["5.6.7.8"]);
  });

  it("an unavailable layer never reads as clean in the headline", async () => {
    const result = await checkUrl(
      "https://evil.com/a",
      undefined,
      deps({ resolve: vi.fn(async () => []) }),
    );
    const ip = result.layers.find((l) => l.kind === "ip")!;
    expect(ip.verdict).toBe("unknown");
    expect(result.headlineLayer).not.toBe("ip");
  });

  it("concatenates every layer's rows into sources for the route factory", async () => {
    const result = await checkUrl("https://evil.com/a", undefined, deps());
    expect(result.sources.length).toBe(
      result.layers.reduce((n, l) => n + l.sources.length, 0),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/url/check.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the composition**

```ts
// lib/ti/url/check.ts
import { parseUrl } from "@/lib/url";
// Both live in aggregate.ts, not assemble.ts, which only re-exports them by use.
import { aggregateRisk, computeStats } from "../aggregate";
import { getCachedDomainResult, getCachedResult } from "../cache";
import { checkIp } from "../check";
import { checkDomain } from "../domain/check";
import { answers, dohQuery, RESOLVERS } from "../dns/doh";
import { runAll } from "../orchestrate";
import type { SourceResult } from "../types";
import { selectHeadline } from "./layers";
import { urlSources } from "./registry";
import type { UrlCheckResult, UrlLayer } from "./types";

export interface CheckUrlDeps {
  resolve?: (host: string, signal: AbortSignal) => Promise<string[]>;
  checkDomainLayer?: typeof checkDomain;
  checkIpLayer?: typeof checkIp;
  getCachedDomain?: typeof getCachedDomainResult;
  getCachedIp?: typeof getCachedResult;
}

const RESOLVE_TIMEOUT_MS = 5000;

/** A/AAAA lookup over DoH. The query reaches the target's authoritative NS only
 *  via the public resolver, so the operator sees Cloudflare, not us. */
async function resolveHost(host: string, signal: AbortSignal): Promise<string[]> {
  const a = answers(await dohQuery(RESOLVERS.cloudflare, host, "A", signal));
  if (a.length > 0) return a;
  return answers(await dohQuery(RESOLVERS.cloudflare, host, "AAAA", signal));
}

function layerFrom(
  kind: UrlLayer["kind"],
  indicator: string,
  results: SourceResult[],
  cachedAt?: string,
): UrlLayer {
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
  return {
    kind,
    indicator,
    status: "ok",
    riskScore,
    verdict,
    sources: results,
    stats: computeStats(results),
    scoreBreakdown: breakdown,
    ...(cachedAt ? { cachedAt } : {}),
  };
}

function absentLayer(
  kind: UrlLayer["kind"],
  indicator: string,
  status: "unavailable" | "not-applicable",
  reason: string,
): UrlLayer {
  return {
    kind,
    indicator,
    status,
    reason,
    riskScore: 0,
    verdict: "unknown",
    sources: [],
    stats: { total: 0, queried: 0, flagged: 0, skipped: 0, errored: 0 },
  };
}

export async function checkUrl(
  url: string,
  onSettled?: (result: SourceResult) => void,
  deps: CheckUrlDeps = {},
): Promise<UrlCheckResult> {
  const parsed = parseUrl(url);
  if (!parsed) throw new Error("Unparseable URL");

  const resolve = deps.resolve ?? resolveHost;
  const runDomain = deps.checkDomainLayer ?? checkDomain;
  const runIp = deps.checkIpLayer ?? checkIp;
  const cachedDomain = deps.getCachedDomain ?? getCachedDomainResult;
  const cachedIp = deps.getCachedIp ?? getCachedResult;

  // URL layer.
  const urlRows = await runAll(urlSources, parsed.canonical, onSettled);
  const urlLayer = layerFrom("url", parsed.canonical, urlRows);

  // Host layer. An IP-literal URL has no host to check; that is not a failure.
  let hostLayer: UrlLayer;
  if (parsed.isIpHost) {
    hostLayer = absentLayer(
      "domain",
      parsed.host,
      "not-applicable",
      "The URL addresses an IP directly, so there is no host to check",
    );
  } else {
    const hit = await cachedDomain(parsed.host);
    hostLayer = hit
      ? layerFrom("domain", parsed.host, hit.sources, hit.checkedAt)
      : layerFrom("domain", parsed.host, (await runDomain(parsed.host, onSettled)).sources);
  }

  // IP layer. One address is checked; the rest are recorded as unchecked so a
  // multi-homed host does not read as if every address were cleared.
  const addresses = parsed.isIpHost
    ? [parsed.host]
    : await resolve(parsed.host, AbortSignal.timeout(RESOLVE_TIMEOUT_MS));
  const [first, ...others] = addresses;

  let ipLayer: UrlLayer;
  if (!first) {
    ipLayer = absentLayer(
      "ip",
      parsed.host,
      "unavailable",
      "The host did not resolve, so there is no address to check",
    );
  } else {
    const hit = await cachedIp(first);
    ipLayer = hit
      ? layerFrom("ip", first, hit.sources, hit.checkedAt)
      : layerFrom("ip", first, (await runIp(first, onSettled)).sources);
  }

  const layers = [urlLayer, hostLayer, ipLayer];
  const headline = selectHeadline(layers);
  const sources = layers.flatMap((l) => l.sources);

  return {
    url: parsed.canonical,
    checkedAt: new Date().toISOString(),
    riskScore: headline.riskScore,
    verdict: headline.verdict,
    headlineLayer: headline.kind,
    layers,
    ...(others.length ? { otherAddresses: others } : {}),
    sources,
    stats: computeStats(sources),
  };
}
```

`aggregateRisk` and `computeStats` are both exported from `lib/ti/aggregate.ts`
(`lib/ti/assemble.ts:10` imports them from there); do not add a duplicate.

- [ ] **Step 4: Run the tests**

Run: `bun run test lib/ti/url/check.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/url/check.ts lib/ti/url/check.test.ts lib/ti/assemble.ts
git commit -m "feat(url): compose the URL, host and IP layers with cache reuse"
```

---

### Task 9: Label co-tenancy on shared infrastructure

**Files:**
- Create: `lib/ti/url/shared-host.ts`
- Test: `lib/ti/url/shared-host.test.ts`
- Modify: `lib/ti/url/check.ts` (apply it to the IP layer)

**Read this before implementing.** The spec says reverse-IP "is not queried at
all" on a CDN. That is not achievable as written, and the plan implements the
achievable version instead. The suppression signal is `cloudProvider(asn, org)`
(`lib/ti/cloud.ts:44`), which is an **ASN** lookup, and the ASN arrives from the
geo sources inside the same parallel fan-out that runs `reverse-ip`. There is no
point at which we know the ASN and have not already dispatched the query.

What that costs is nothing, because the quota problem is already solved by layer
cache reuse in Task 8: the IP layer runs once per address, not once per URL.
What remains is the interpretive problem, that "40 domains share this IP" reads
as evidence on an address Cloudflare shares with millions. So this task relabels
rather than suppresses. `reverse-ip` already carries `weight: 0`
(`lib/ti/sources/reverse-ip.ts:41`), so it never moved the score; only the
wording was misleading.

**Interfaces:**
- Consumes: `cloudProvider` from `lib/ti/cloud.ts`, `UrlLayer` from Task 6.
- Produces:
  ```ts
  export function annotateSharedHost(layer: UrlLayer): UrlLayer;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// lib/ti/url/shared-host.test.ts
import { describe, expect, it } from "vitest";
import { annotateSharedHost } from "@/lib/ti/url/shared-host";
import type { UrlLayer } from "@/lib/ti/url/types";
import type { SourceResult } from "@/lib/ti/types";

const row = (id: string, over: Partial<SourceResult> = {}): SourceResult => ({
  source: {
    id,
    name: id,
    url: "https://example.test",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  enabled: true,
  status: "ok",
  durationMs: 1,
  ...over,
});

const layer = (sources: SourceResult[]): UrlLayer => ({
  kind: "ip",
  indicator: "1.2.3.4",
  status: "ok",
  riskScore: 0,
  verdict: "clean",
  sources,
  stats: { total: sources.length, queried: sources.length, flagged: 0, skipped: 0, errored: 0 },
});

describe("annotateSharedHost", () => {
  it("relabels reverse-ip when the ASN is a known cloud provider", () => {
    const result = annotateSharedHost(
      layer([
        row("ip-api", { geo: { asn: "AS13335", asnOrg: "Cloudflare" } }),
        row("reverse-ip", { summary: "40 domains share this IP" }),
      ]),
    );
    const rev = result.sources.find((s) => s.source.id === "reverse-ip")!;
    expect(rev.summary).toContain("Cloudflare");
    expect(rev.summary).toContain("not evidence");
  });

  it("leaves reverse-ip alone on an ordinary hosting ASN", () => {
    const result = annotateSharedHost(
      layer([
        row("ip-api", { geo: { asn: "AS64500", asnOrg: "Some Small ISP" } }),
        row("reverse-ip", { summary: "3 domains share this IP" }),
      ]),
    );
    const rev = result.sources.find((s) => s.source.id === "reverse-ip")!;
    expect(rev.summary).toBe("3 domains share this IP");
  });

  it("is a no-op when reverse-ip did not run", () => {
    const input = layer([row("ip-api", { geo: { asn: "AS13335" } })]);
    expect(annotateSharedHost(input)).toEqual(input);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/url/shared-host.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/ti/url/shared-host.ts
import { cloudProvider } from "../cloud";
import type { UrlLayer } from "./types";

/**
 * On shared infrastructure, co-tenancy is not a signal: an address Cloudflare
 * shares with millions of sites tells you nothing about this one. reverse-ip is
 * weight 0 so it never moved the score, but its summary reads like evidence.
 * Relabel it with the provider named, so the row stays informative without
 * inviting the wrong conclusion.
 */
export function annotateSharedHost(layer: UrlLayer): UrlLayer {
  const reverse = layer.sources.find((s) => s.source.id === "reverse-ip");
  if (!reverse) return layer;

  const geo = layer.sources.find((s) => s.geo?.asn || s.geo?.asnOrg)?.geo;
  const provider = cloudProvider(geo?.asn, geo?.asnOrg ?? geo?.org);
  if (!provider) return layer;

  return {
    ...layer,
    sources: layer.sources.map((s) =>
      s.source.id === "reverse-ip"
        ? {
            ...s,
            summary: `${provider.name} shared infrastructure, so co-tenancy is not evidence about this URL`,
          }
        : s,
    ),
  };
}
```

- [ ] **Step 4: Apply it in `checkUrl`**

In `lib/ti/url/check.ts`, wrap the IP layer as it is built:

```ts
import { annotateSharedHost } from "./shared-host";
// ...
    ipLayer = annotateSharedHost(
      hit
        ? layerFrom("ip", first, hit.sources, hit.checkedAt)
        : layerFrom("ip", first, (await runIp(first, onSettled)).sources),
    );
```

- [ ] **Step 5: Run the tests**

Run: `bun run test lib/ti/url/`
Expected: PASS, including Task 8's composition tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/url/shared-host.ts lib/ti/url/shared-host.test.ts lib/ti/url/check.ts
git commit -m "feat(url): name the provider when co-tenancy is not evidence"
```

---

### Task 10: Cache and route

**Files:**
- Create: `lib/ti/url/validate.ts`
- Test: `lib/ti/url/validate.test.ts`
- Modify: `lib/ti/cache.ts` (add the URL prefix and accessors)
- Create: `app/api/check-url/route.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/ti/url/validate.ts
  export interface UrlProblem { message: string; status: 400 | 422; scope?: string }
  /** null when the URL is checkable. */
  export function urlIndicatorProblem(raw: string): UrlProblem | null;
  // lib/ti/cache.ts
  export function getCachedUrlResult(url: string): Promise<UrlCheckResult | null>;
  export function setCachedUrlResult(url: string, result: UrlCheckResult): Promise<void>;
  ```
  Key prefix: `ti:url:v1:`.

**Why a separate module:** the other routes inline their `validate`, but their
checks are one call deep. This one composes `parseUrl`, `parseIP`, and
`parseDomain`, and the reserved and private cases are exactly the kind of thing
that regresses silently. Keeping the decision pure makes it testable; the route
stays a thin mapper to `Response`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/ti/url/validate.test.ts
import { describe, expect, it } from "vitest";
import { urlIndicatorProblem } from "@/lib/ti/url/validate";

describe("urlIndicatorProblem", () => {
  it("accepts an ordinary URL", () => {
    expect(urlIndicatorProblem("https://evil.com/login?id=abc")).toBeNull();
  });

  it("accepts a URL carrying credentials, which is a finding not an error", () => {
    expect(urlIndicatorProblem("https://user:pass@evil.com/a")).toBeNull();
  });

  it.each([
    ["ftp://evil.com/a", 400],
    ["javascript:alert(1)", 400],
    ["not a url", 400],
  ])("rejects %s with %i", (input, status) => {
    expect(urlIndicatorProblem(input)?.status).toBe(status);
  });

  it("rejects a private address host with 422", () => {
    const problem = urlIndicatorProblem("http://192.168.1.1/admin")!;
    expect(problem.status).toBe(422);
  });

  it("rejects a reserved TLD host with 422 and keeps the scope note", () => {
    const problem = urlIndicatorProblem("https://foo.onion/a")!;
    expect(problem.status).toBe(422);
    expect(problem.scope).toBeTruthy();
  });

  it("rejects a URL over the length cap", () => {
    expect(urlIndicatorProblem(`https://evil.com/${"a".repeat(2100)}`)?.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/url/validate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement validation and the cache accessors**

`ParsedIP` exposes `isPrivate` and `isReserved` (`lib/ip.ts:1` and `:73`); there
is no `isRoutable` field, so test the two booleans.

```ts
// lib/ti/url/validate.ts
import { parseDomain } from "@/lib/domain";
import { parseIP } from "@/lib/ip";
import { parseUrl } from "@/lib/url";

export interface UrlProblem {
  message: string;
  status: 400 | 422;
  scope?: string;
}

/** null when the URL is checkable, otherwise the problem to return. */
export function urlIndicatorProblem(raw: string): UrlProblem | null {
  const parsed = parseUrl(raw);
  if (!parsed) return { message: "Invalid URL", status: 400 };

  const ip = parseIP(parsed.host);
  if (ip) {
    if (ip.isPrivate || ip.isReserved) {
      return {
        message: `Cannot check non-routable address: ${ip.scopeNote ?? "reserved range"}`,
        status: 422,
        scope: ip.scopeNote,
      };
    }
    return null;
  }

  const domain = parseDomain(parsed.host);
  if (!domain) return { message: "Invalid host in URL", status: 400 };
  if (domain.isReserved) {
    return {
      message: `Cannot check special-use domain: ${domain.scopeNote}`,
      status: 422,
      scope: domain.scopeNote,
    };
  }
  return null;
}
```

In `lib/ti/cache.ts`, note that the private helpers take `(prefix, key)` as two
arguments, so mirror the existing accessors exactly:

```ts
const URL_KEY_PREFIX = "ti:url:v1:";

/** Returns the cached result for a URL, or null on miss / when caching is off. */
export function getCachedUrlResult(url: string): Promise<UrlCheckResult | null> {
  return getCached<UrlCheckResult>(URL_KEY_PREFIX, url);
}

/** Stores a URL result with the default TTL. Failures are swallowed. */
export function setCachedUrlResult(
  url: string,
  result: UrlCheckResult,
): Promise<void> {
  return setCached(URL_KEY_PREFIX, url, result);
}
```

- [ ] **Step 4: Write the route**

```ts
// app/api/check-url/route.ts
import { parseUrl } from "@/lib/url";
import { checkUrl } from "@/lib/ti/url/check";
import { urlSources } from "@/lib/ti/url/registry";
import { urlIndicatorProblem } from "@/lib/ti/url/validate";
import { domainSources } from "@/lib/ti/domain/registry";
import { sources as ipSources } from "@/lib/ti/registry";
import { getCachedUrlResult, setCachedUrlResult } from "@/lib/ti/cache";
import { makeIndicatorRoute, type Validated } from "@/lib/ti/route-handler";
import type { UrlCheckResult } from "@/lib/ti/url/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every source that can appear in the stream, across all three layers. The
 * `start` event uses this for its total, so the progress bar is not sized to
 * the URL layer alone while forty rows arrive. Layers served from cache, and
 * sources gated by key or IP family, simply never settle against it, which is
 * the same optimistic accounting the family gating already uses.
 */
const ALL_LAYER_SOURCES = [...urlSources, ...domainSources, ...ipSources];

/** Validate up front, returning the canonical URL or an error Response. */
function validateUrl(raw: string | null): Validated<string> {
  if (!raw) {
    return {
      error: Response.json({ error: "Missing 'url' parameter" }, { status: 400 }),
    };
  }
  const problem = urlIndicatorProblem(raw);
  if (problem) {
    return {
      error: Response.json(
        {
          error: problem.message,
          ...(problem.scope ? { scope: problem.scope } : {}),
        },
        { status: problem.status },
      ),
    };
  }
  return { value: parseUrl(raw)!.canonical };
}

export const { GET, POST } = makeIndicatorRoute<string, UrlCheckResult>({
  paramName: "url",
  label: "url",
  sources: ALL_LAYER_SOURCES,
  validate: validateUrl,
  getCached: (url) => getCachedUrlResult(url),
  setCached: (url, result) => setCachedUrlResult(url, result),
  run: (url, onSettled) => checkUrl(url, onSettled),
});
```

Confirm the export name of the IP registry in `lib/ti/registry.ts` before
writing the import; the IP list is the unprefixed one, so it needs the
`as ipSources` alias shown above.

- [ ] **Step 5: Verify end to end against a real URL**

```bash
bun run dev &
sleep 5
curl -s -X POST localhost:3000/api/check-url \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.google.com/search?q=test"}' | head -c 600
```

Expected: JSON with `layers` of length 3, `headlineLayer`, and a `verdict`.
Then repeat with a URL whose host is a known-bad IP to confirm the IP layer
drives the headline. Stop the dev server afterwards; do not `pkill` broadly,
the user runs their own dev server on port 3000.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/url/validate.ts lib/ti/url/validate.test.ts \
        lib/ti/cache.ts app/api/check-url/route.ts
git commit -m "feat(api): POST /api/check-url returning the three passive layers"
```

---

### Task 11: Layered result UI

**Files:**
- Create: `components/CheckResults/layers.tsx`
- Modify: `components/CheckResults/index.tsx:176` (the dispatch in `CheckResults`)
- Modify: `components/CheckResults/types.ts:5` (`Mode` gains `"url"`)
- Modify: `app/check/[ioc]/page.tsx:31` (route a detected `url` to the new API)

**Interfaces:**
- Consumes: `UrlCheckResult`, `UrlLayer` from Task 6.
- Produces: `export function LayerStack({ result }: { result: UrlCheckResult })`,
  `export function isUrlResult(r: AnyCheckResult | UrlCheckResult): r is UrlCheckResult`

**What it renders,** in this order:

1. The existing `VerdictHero`, with the headline verdict, and directly beneath it
   a line naming the layer: "This verdict comes from the IP layer, the URL itself
   is not listed."
2. A `LayerStack`: three rows, each with the layer name, its indicator, its
   verdict chip, its score, and its source count. A cached layer shows its age
   ("cached 3 days ago") and a refresh control that re-requests with
   `refresh: true`.
3. An `unavailable` or `not-applicable` layer renders its `reason` in place of a
   verdict chip. It must not render as a clean chip.
4. When `otherAddresses` is set, a line under the IP layer: "N other addresses
   resolved, not checked."
5. The existing `SourceBreakdown`, once per layer, grouped under the layer name.

- [ ] **Step 1: Add the type guard and the Mode value**

```ts
// components/CheckResults/layers.tsx
import type { AnyCheckResult } from "@/lib/ti/types";
import type { UrlCheckResult } from "@/lib/ti/url/types";

export function isUrlResult(
  r: AnyCheckResult | UrlCheckResult,
): r is UrlCheckResult {
  return "layers" in r && "headlineLayer" in r;
}
```

In `components/CheckResults/types.ts`, change
`export type Mode = "ip" | "domain" | "hash";` to include `"url"`.

- [ ] **Step 2: Build `LayerStack`**

Read `components/CheckResults/verdict.tsx` and `primitives.tsx` first and reuse
their chip and `Section` primitives rather than writing new ones. The skin is
monochrome, verdict is the only colour, flat, system fonts.

```tsx
const LAYER_LABEL: Record<LayerKind, string> = {
  url: "The URL",
  domain: "Its host",
  ip: "The host's address",
};

function relativeAge(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "cached today";
  return days === 1 ? "cached 1 day ago" : `cached ${days} days ago`;
}

function LayerRow({
  layer,
  onRefresh,
}: Readonly<{ layer: UrlLayer; onRefresh: (kind: LayerKind) => void }>) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{LAYER_LABEL[layer.kind]}</div>
        <div className="truncate font-mono text-xs opacity-70">
          {layer.indicator}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {layer.status === "ok" ? (
          <>
            <VerdictChip verdict={layer.verdict} score={layer.riskScore} />
            <span className="text-xs opacity-70">
              {layer.stats.queried} sources
            </span>
            {layer.cachedAt && (
              <button
                type="button"
                onClick={() => onRefresh(layer.kind)}
                className="text-xs underline opacity-70"
              >
                {relativeAge(layer.cachedAt)}, refresh
              </button>
            )}
          </>
        ) : (
          // Never a clean chip: an absent layer is not a cleared layer.
          <span className="max-w-xs text-right text-xs opacity-70">
            {layer.reason}
          </span>
        )}
      </div>
    </div>
  );
}

export function LayerStack({
  result,
  onRefresh,
}: Readonly<{ result: UrlCheckResult; onRefresh: (kind: LayerKind) => void }>) {
  return (
    <div>
      <p className="mb-3 text-sm">
        This verdict comes from {LAYER_LABEL[result.headlineLayer].toLowerCase()}.
      </p>
      {result.layers.map((layer) => (
        <LayerRow key={layer.kind} layer={layer} onRefresh={onRefresh} />
      ))}
      {result.otherAddresses?.length ? (
        <p className="pt-3 text-xs opacity-70">
          {result.otherAddresses.length} other{" "}
          {result.otherAddresses.length === 1 ? "address" : "addresses"} resolved,
          not checked: {result.otherAddresses.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
```

Import `VerdictChip` under whatever name `verdict.tsx` actually exports; if the
chip is not currently exported on its own, export it there rather than
duplicating its markup.

- [ ] **Step 3: Wire the dispatch**

In `components/CheckResults/index.tsx`, add the url branch **before** the
existing hash/domain checks, since `isUrlResult` is the most specific test:

```tsx
const body = isUrlResult(result) ? (
    <UrlResults result={result} onRefresh={onRefresh} research={research} />
) : isHashResult(result) ? (
    ...
```

In `app/check/[ioc]/page.tsx`, the `kind` from `detectIOC` now includes `"url"`;
point that case at `/api/check-url` with the `url` parameter.

- [ ] **Step 4: Verify in a browser**

```bash
bun run dev
```

Open `http://localhost:3000/check/https%3A%2F%2Fwww.google.com%2F` and confirm:
the three layers render, the headline names its layer, a cached layer shows its
age, and an unresolvable host shows the unavailable reason rather than a clean
chip. Check both light and dark themes and a 390px viewport, as
`issue.md` records for previous UI work. There are Playwright screenshot helpers
in `scripts/` (e.g. `node scripts/shot.mjs`). **If you cannot verify the UI in a
browser, say so explicitly rather than claiming it works.**

- [ ] **Step 5: Run the full suite and commit**

```bash
bun run test && bun run lint && bun run typecheck && bun run build
git add components/CheckResults/layers.tsx components/CheckResults/index.tsx \
        components/CheckResults/types.ts "app/check/[ioc]/page.tsx"
git commit -m "feat(ui): layered URL result with the headline naming its layer"
```

---

## Definition of done

- `bun run test`, `bun run lint`, `bun run typecheck`, `bun run build` all pass.
- Pasting `https://www.google.com/search?q=test` returns three layers with a
  clean headline; pasting a URL on a listed host returns a malicious headline
  that names the layer it came from.
- Checking two URLs on the same host performs one host lookup, the second
  reporting the host layer as cached.
- A URL whose host does not resolve shows the IP layer as unavailable, not clean.
