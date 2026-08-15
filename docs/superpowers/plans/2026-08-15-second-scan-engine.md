# Second scan engine (Cloudflare) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every active scan through Cloudflare's URL Scanner as well as urlscan, and show one merged reading in the existing inline card, with disagreement between the engines called out.

**Architecture:** Cloudflare gets its own submit/poll client mirroring `lib/ti/url/active/urlscan.ts`, and its own adapter into the shared `ScanDetail`, because the payloads are similar but not identical. Every `ActiveScan` gains an `engine` tag, so a batch holds two records per target. A pure merge function folds the per-engine details into one reading plus a list of disagreements.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest, Bun.

Spec: `docs/superpowers/specs/2026-08-15-active-scan-page-design.md` (plan 1 of 2)

## Global Constraints

- Free sources only. Cloudflare URL Scanner is free on all plans.
- Run `bun run test` and `bun run lint` before declaring any task done. Use `bun run test`, never `bun test`.
- Tests are Vitest, colocated as `lib/**/*.test.ts`, pure, no network, `@/` alias.
- Clients never throw: catch and return an errored record.
- HTTP goes through `lib/ti/http.ts` helpers, never bare `fetch`.
- **A poll that has not finished is `running`, never `error`.** The quota is spent and the provider is still working; reporting failure invites a resubmission.
- **Anything missing is named.** An absent block is never rendered as an observation of absence.
- User-facing copy uses commas, not dashes, as separators.
- Credentials: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, both already present and verified.

## Verified contracts

Probed 2026-08-15 against the live API, recorded so nobody re-guesses:

- Submit: `POST /client/v4/accounts/<id>/urlscanner/v2/scan`
- Result: `GET /client/v4/accounts/<id>/urlscanner/v2/result/<uuid>`
- Search: `GET /client/v4/accounts/<id>/urlscanner/v2/search?limit=1` returns **200**. Note `v2/scans` is **404**; the path is easy to get wrong.
- The result schema mirrors urlscan's blocks (`data`, `lists`, `meta`, `page`, `stats`, `task`, `verdicts`) but differs in three ways that matter:
  1. **No `data.redirects`.** The chain lives in `page.history`, a list of `{url, statusCode, uuid, requestId}`; consecutive entries form the hops.
  2. **`verdicts` has only `overall`.** No `engines` or `community` lanes.
  3. **`task.screenshotURL` and `task.domURL` are authenticated API endpoints** under `api.cloudflare.com`, not public files. An `<img src>` pointed at one fails without an `Authorization` header.
- Extra processors under `meta.processors` that urlscan has no equivalent for: `whois`, `domainCategories`, `urlCategories`, `radarRank`, `phishing`, `phishing_v2`, `dns`, `robotsTxt`.
- Certificate `validFrom` / `validTo` are unix **seconds**, same as urlscan, so the existing `certTime` helper applies.

**Not yet verified, and Task 1 must establish it:** the submit request/response shape, which `visibility` values Cloudflare accepts, and what a poll returns while a scan is still running. urlscan answers 404 while pending; Cloudflare may not.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/ti/url/active/engines.ts` (create) | The `ScanEngine` union and per-engine display names. |
| `lib/ti/url/active/cloudflare.ts` (create) | Cloudflare submit + poll, mirroring `urlscan.ts`. |
| `lib/ti/url/active/cloudflare-detail.ts` (create) | Cloudflare result → shared `ScanDetail`. |
| `lib/ti/url/active/detail.ts` (modify) | Extract the shared helpers the second adapter needs. |
| `lib/ti/url/active/types.ts` (modify) | `ActiveScan.engine`, plus the extra `ScanDetail` fields only Cloudflare fills. |
| `lib/ti/url/active/merge.ts` (create) | Fold per-engine details into one reading plus disagreements. |
| `app/api/scan-url/route.ts` (modify) | Submit to and poll both engines. |
| `components/CheckResults/active-scan.tsx` (modify) | Render per engine, plus the disagreement line. |

---

### Task 1: Cloudflare submit and poll

**Files:**
- Create: `lib/ti/url/active/engines.ts`
- Create: `lib/ti/url/active/cloudflare.ts`
- Test: `lib/ti/url/active/cloudflare.test.ts`
- Modify: `lib/ti/url/active/types.ts`

**Interfaces:**
- Consumes: `ActiveScan`, `ScanVisibility` from `./types`; `postJson`, `getJson`, `isTimeout`, `errorMessage` from `../../http`.
- Produces:
  ```ts
  // engines.ts
  export type ScanEngine = "urlscan" | "cloudflare";
  export const ENGINE_NAME: Record<ScanEngine, string>;
  // cloudflare.ts
  export function cfSubmissionOutcome(
    target: string, visibility: ScanVisibility, status: number, data: unknown,
  ): ActiveScan;
  export function cfPollOutcome(
    scan: ActiveScan, status: number, data: unknown,
  ): ActiveScan;
  export function submitCloudflareScan(
    target: string, token: string, accountId: string, signal: AbortSignal,
  ): Promise<ActiveScan>;
  export function pollCloudflareScan(
    scan: ActiveScan, token: string, accountId: string, signal: AbortSignal,
  ): Promise<ActiveScan>;
  ```
  `ActiveScan` gains a required `engine: ScanEngine`.

- [ ] **Step 1: Add the engine tag to the shared type**

In `lib/ti/url/active/types.ts`, import the union and add the field to `ActiveScan`:

```ts
import type { ScanEngine } from "./engines";

// ...inside ActiveScan, directly under `target`:
  /** Which scanner produced this record. A batch holds one per engine per
   *  target, so every consumer must read this rather than assume urlscan. */
  engine: ScanEngine;
```

Create `lib/ti/url/active/engines.ts`:

```ts
/** The scanners an active scan is submitted to. Both are free. */
export type ScanEngine = "urlscan" | "cloudflare";

/** Display name, used wherever a claim is attributed to its source. */
export const ENGINE_NAME: Record<ScanEngine, string> = {
  urlscan: "urlscan.io",
  cloudflare: "Cloudflare",
};
```

`tsc` will now flag every construction of an `ActiveScan` in
`lib/ti/url/active/urlscan.ts` and its tests. Add `engine: "urlscan"` to each.

- [ ] **Step 2: Write the failing tests**

```ts
// lib/ti/url/active/cloudflare.test.ts
import { describe, expect, it } from "vitest";
import { cfPollOutcome, cfSubmissionOutcome } from "@/lib/ti/url/active/cloudflare";
import type { ActiveScan } from "@/lib/ti/url/active/types";

describe("cfSubmissionOutcome", () => {
  it("keeps the uuid and reports running on acceptance", () => {
    const scan = cfSubmissionOutcome("https://evil.com/a", "unlisted", 200, {
      success: true,
      result: { uuid: "cf-1", visibility: "unlisted" },
    });
    expect(scan.engine).toBe("cloudflare");
    expect(scan.status).toBe("running");
    expect(scan.uuid).toBe("cf-1");
    expect(scan.resultUrl).toBe("https://radar.cloudflare.com/scan/cf-1");
  });

  it("reports the API's own error message rather than a bare status", () => {
    const scan = cfSubmissionOutcome("https://evil.com/a", "unlisted", 400, {
      success: false,
      errors: [{ code: 1001, message: "Invalid URL" }],
    });
    expect(scan.status).toBe("error");
    expect(scan.error).toContain("Invalid URL");
    expect(scan.uuid).toBeUndefined();
  });

  it("treats a 429 as an error the caller can retry differently", () => {
    const scan = cfSubmissionOutcome("https://evil.com/a", "unlisted", 429, {
      success: false,
      errors: [{ message: "Rate limited" }],
    });
    expect(scan.status).toBe("error");
    expect(scan.error).toMatch(/rate limited/i);
  });
});

describe("cfPollOutcome", () => {
  const pending: ActiveScan = {
    target: "https://evil.com/a",
    engine: "cloudflare",
    status: "running",
    uuid: "cf-1",
  };

  it("stays running while the scan is queued, never erroring", () => {
    // The quota is spent and the scanner is still working. Reporting failure
    // here would invite a second submission for the same page.
    expect(cfPollOutcome(pending, 404, null).status).toBe("running");
    expect(cfPollOutcome(pending, 202, null).status).toBe("running");
    expect(cfPollOutcome(pending, 404, null).error).toBeUndefined();
  });

  it("completes on a finished task and carries the verdict", () => {
    const scan = cfPollOutcome(pending, 200, {
      task: { uuid: "cf-1", status: "finished", success: true, url: "https://evil.com/a" },
      page: { url: "https://evil.com/final", ip: "1.2.3.4", asn: "13335", server: "cloudflare" },
      verdicts: { overall: { malicious: true, categories: ["phishing"] } },
      lists: { domains: ["evil.com"] },
    });
    expect(scan.status).toBe("done");
    expect(scan.verdict?.malicious).toBe(true);
    expect(scan.verdict?.finalUrl).toBe("https://evil.com/final");
  });

  it("stays running when the task exists but has not finished", () => {
    const scan = cfPollOutcome(pending, 200, {
      task: { uuid: "cf-1", status: "inProgress" },
    });
    expect(scan.status).toBe("running");
  });

  it("keeps the uuid when the provider errors, so polling resumes", () => {
    expect(cfPollOutcome(pending, 500, null).uuid).toBe("cf-1");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run test lib/ti/url/active/cloudflare.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the client**

```ts
// lib/ti/url/active/cloudflare.ts
import { errorMessage, getJson, isTimeout, postJson } from "../../http";
import type { ActiveScan, ActiveVerdict, ScanVisibility } from "./types";

const BASE = "https://api.cloudflare.com/client/v4/accounts";

/** Cloudflare exposes no private tier, so an unlisted scan is the tightest it
 *  offers. Public is never used. */
export const CF_VISIBILITY: ScanVisibility = "unlisted";

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Cloudflare reports failures in an `errors` array; prefer its wording. */
function cfError(data: unknown, status: number): string {
  const errors = obj(data).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const message = str(obj(errors[0]).message);
    if (message) return message;
  }
  return `HTTP ${status}`;
}

export function cfSubmissionOutcome(
  target: string,
  visibility: ScanVisibility,
  status: number,
  data: unknown,
): ActiveScan {
  const result = obj(obj(data).result);
  const uuid = str(result.uuid);
  if (status === 200 && uuid) {
    return {
      target,
      engine: "cloudflare",
      status: "running",
      uuid,
      visibility,
      resultUrl: `https://radar.cloudflare.com/scan/${uuid}`,
    };
  }
  return {
    target,
    engine: "cloudflare",
    status: "error",
    error: cfError(data, status),
  };
}

function cfVerdict(data: Json): ActiveVerdict {
  const page = obj(data.page);
  const overall = obj(obj(data.verdicts).overall);
  const lists = obj(data.lists);
  return {
    malicious: overall.malicious === true,
    categories: Array.isArray(overall.categories)
      ? (overall.categories as string[])
      : undefined,
    finalUrl: str(page.url),
    contactedDomains: Array.isArray(lists.domains)
      ? (lists.domains as string[])
      : undefined,
    // Cloudflare's screenshot is an authenticated API endpoint, not a public
    // file, so it is deliberately not carried as an <img> source here.
    ip: str(page.ip),
    asn: str(page.asn),
    server: str(page.server),
  };
}

/**
 * Fold a poll response into the scan.
 *
 * Cloudflare reports progress through `task.status` rather than by withholding
 * the document, so "the task exists but is not finished" is a distinct case
 * from urlscan's 404. Both mean the same thing to us: still running.
 */
export function cfPollOutcome(
  scan: ActiveScan,
  status: number,
  data: unknown,
): ActiveScan {
  if (status === 200) {
    const task = obj(obj(data).task);
    if (str(task.status) === "finished") {
      // `detail` is attached in Task 2, once the adapter exists.
      return { ...scan, status: "done", verdict: cfVerdict(obj(data)) };
    }
    return { ...scan, status: "running" };
  }
  if (status === 404 || status === 202) return { ...scan, status: "running" };
  return { ...scan, status: "running", error: `HTTP ${status}` };
}

export async function submitCloudflareScan(
  target: string,
  token: string,
  accountId: string,
  signal: AbortSignal,
): Promise<ActiveScan> {
  try {
    const { status, data } = await postJson<unknown>(
      `${BASE}/${accountId}/urlscanner/v2/scan`,
      signal,
      { url: target, visibility: CF_VISIBILITY },
      { Authorization: `Bearer ${token}` },
    );
    return cfSubmissionOutcome(target, CF_VISIBILITY, status, data);
  } catch (err) {
    return {
      target,
      engine: "cloudflare",
      status: "error",
      error: isTimeout(err) ? "Submission timed out" : errorMessage(err),
    };
  }
}

export async function pollCloudflareScan(
  scan: ActiveScan,
  token: string,
  accountId: string,
  signal: AbortSignal,
): Promise<ActiveScan> {
  if (!scan.uuid) return scan;
  try {
    const { status, data } = await getJson<unknown>(
      `${BASE}/${accountId}/urlscanner/v2/result/${scan.uuid}`,
      signal,
      { Authorization: `Bearer ${token}` },
    );
    return cfPollOutcome(scan, status, data);
  } catch (err) {
    return { ...scan, status: "running", error: errorMessage(err) };
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `bun run test lib/ti/url/active/ && bun run typecheck`
Expected: PASS. This task deliberately does not attach a `detail`; the adapter
that builds one is Task 2, and wiring it in is that task's first step. A
finished Cloudflare scan therefore carries a verdict but no teardown until then,
which is a smaller and more honest intermediate state than a stub returning an
empty detail that later reads as "the scanner reported nothing".

- [ ] **Step 6: Verify the unverified half against the live API**

The submit contract is the one thing probing could not establish. Spend one
scan on a benign target and record what comes back:

```bash
set -a; . ./.env.local; set +a
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/urlscanner/v2/scan" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.org/","visibility":"unlisted"}' | head -c 400
```

Expected: a `result.uuid`. **If `visibility: "unlisted"` is rejected**, retry
without the field to learn the default, and update `CF_VISIBILITY` plus the
comment above it to match what the API actually accepts. Then poll the returned
uuid immediately and record whether an unfinished scan answers 404, 202, or 200
with a non-finished `task.status`, and make sure `cfPollOutcome` covers it.

- [ ] **Step 7: Commit**

```bash
git add lib/ti/url/active/engines.ts lib/ti/url/active/cloudflare.ts \
        lib/ti/url/active/cloudflare.test.ts lib/ti/url/active/types.ts \
        lib/ti/url/active/urlscan.ts lib/ti/url/active/urlscan.test.ts
git commit -m "feat(scan): Cloudflare URL Scanner submit and poll"
```

---

### Task 2: Cloudflare result adapter

**Files:**
- Modify: `lib/ti/url/active/detail.ts` (export the shared helpers)
- Replace: `lib/ti/url/active/cloudflare-detail.ts`
- Test: `lib/ti/url/active/cloudflare-detail.test.ts`
- Modify: `lib/ti/url/active/types.ts` (the Cloudflare-only fields)

**Interfaces:**
- Consumes: `ScanDetail`, `MAX_LISTED` from `./detail`.
- Produces:
  ```ts
  export function distillCloudflareResult(raw: unknown): ScanDetail;
  ```
  `ScanDetail` gains, all optional, all Cloudflare-only:
  ```ts
  registrar?: string;
  domainCreated?: string;   // ISO, from WHOIS
  domainExpires?: string;
  nameservers?: string[];
  riskCategories?: string[]; // e.g. "Newly Seen Domains", "Security Risks"
  radarRankBucket?: string;  // e.g. ">200000"
  domStructHash?: string;
  siblingDomains?: string[]; // hosts named by robots.txt sitemaps
  dnssecValid?: boolean;
  ```

**Why a second adapter rather than one function with branches:** the two
payloads agree on most block names and disagree on exactly the parts that
matter, so a single function would be a thicket of conditionals. Two adapters
into one shape keeps each readable, and the shape is the contract.

- [ ] **Step 1: Wire the adapter into the Cloudflare poll**

Task 1 left a finished scan without a `detail`. In
`lib/ti/url/active/cloudflare.ts`, import the adapter and attach it:

```ts
import { distillCloudflareResult } from "./cloudflare-detail";
// ...in cfPollOutcome, replacing the verdict-only return:
      return {
        ...scan,
        status: "done",
        verdict: cfVerdict(obj(data)),
        detail: distillCloudflareResult(data),
      };
```

Add the matching assertion back to `cloudflare.test.ts`:

```ts
    expect(scan.detail?.finalUrl).toBe("https://evil.com/final");
```

- [ ] **Step 2: Export the shared helpers**

In `lib/ti/url/active/detail.ts`, change `obj`, `str`, `num`, `capped`, `lane`
and `certTime` from module-private to exported, adding this comment above the
first of them:

```ts
// Exported for the Cloudflare adapter, which reads a payload shaped like this
// one in most blocks and unlike it in a few. Sharing the readers keeps the two
// adapters honest about producing the same ScanDetail.
```

- [ ] **Step 3: Write the failing tests**

```ts
// lib/ti/url/active/cloudflare-detail.test.ts
import { describe, expect, it } from "vitest";
import { distillCloudflareResult } from "@/lib/ti/url/active/cloudflare-detail";

/** Shaped after a real Cloudflare result, inventoried 2026-08-15. */
const CF = {
  page: {
    url: "https://arwana855jp.com/",
    title: "403 Forbidden",
    status: "403",
    server: "cloudflare",
    ip: "104.21.17.202",
    asn: "13335",
    asnname: "CLOUDFLARENET",
    country: "United States",
    domain: "arwana855jp.com",
    apexDomain: "arwana855jp.com",
    tlsIssuer: "",
    tlsAgeDays: 1,
    tlsValidDays: 365,
    domStructHash: "ebc3889a75f4",
    history: [
      { url: "https://arwana855jp.com/", statusCode: 301 },
      { url: "https://arwana855jp.com/blocked", statusCode: 403 },
    ],
  },
  verdicts: { overall: { malicious: false, categories: [], tags: [] } },
  lists: { domains: ["arwana855jp.com"], ips: ["104.21.17.202"], certificates: [] },
  data: { requests: [{}, {}], cookies: [], console: [], links: [] },
  stats: { securePercentage: 100, malicious: 0 },
  task: { uuid: "cf-1", status: "finished" },
  meta: {
    processors: {
      whois: {
        data: {
          registrar: "Dynadot Inc",
          created_date: "2026-08-15T11:32:58.000Z",
          expiration_date: "2027-08-15T11:32:58.000Z",
          nameservers: ["ALEC.NS.CLOUDFLARE.COM"],
        },
      },
      domainCategories: {
        data: [
          {
            name: "arwana855jp.com",
            isPrimary: true,
            risks: [{ name: "Newly Seen Domains" }, { name: "Security Risks" }],
          },
          { name: "static.cloudflareinsights.com", isPrimary: false },
        ],
      },
      radarRank: { data: [{ hostname: "arwana855jp.com", rank: null, bucket: ">200000" }] },
      dns: { data: [{ name: "arwana855jp.com", type: "A", dnssec_valid: false }] },
      robotsTxt: { data: [{ sitemaps: ["https://arwana855silver.com/sitemap.xml"] }] },
    },
  },
};

describe("distillCloudflareResult", () => {
  it("derives the redirect chain from page.history, which has no data.redirects", () => {
    const d = distillCloudflareResult(CF);
    expect(d.redirects).toEqual([
      {
        from: "https://arwana855jp.com/",
        to: "https://arwana855jp.com/blocked",
        status: 301,
      },
    ]);
  });

  it("reports no redirect when history holds a single entry", () => {
    const d = distillCloudflareResult({
      ...CF,
      page: { ...CF.page, history: [{ url: "https://x.test/", statusCode: 200 }] },
    });
    expect(d.redirects).toEqual([]);
  });

  it("carries WHOIS, which urlscan has no equivalent for", () => {
    const d = distillCloudflareResult(CF);
    expect(d.registrar).toBe("Dynadot Inc");
    expect(d.domainCreated).toBe("2026-08-15T11:32:58.000Z");
    expect(d.nameservers).toContain("ALEC.NS.CLOUDFLARE.COM");
  });

  it("takes risk categories from the primary domain only", () => {
    // A third-party asset's categories say nothing about the page under test.
    const d = distillCloudflareResult(CF);
    expect(d.riskCategories).toEqual(["Newly Seen Domains", "Security Risks"]);
  });

  it("keeps the radar rank bucket and the DOM structure hash", () => {
    const d = distillCloudflareResult(CF);
    expect(d.radarRankBucket).toBe(">200000");
    expect(d.domStructHash).toBe("ebc3889a75f4");
  });

  it("reads sibling domains out of the robots.txt sitemaps", () => {
    const d = distillCloudflareResult(CF);
    expect(d.siblingDomains).toEqual(["arwana855silver.com"]);
  });

  it("omits a sitemap host that is just the scanned domain again", () => {
    const d = distillCloudflareResult({
      ...CF,
      meta: {
        processors: {
          ...CF.meta.processors,
          robotsTxt: { data: [{ sitemaps: ["https://arwana855jp.com/sitemap.xml"] }] },
        },
      },
    });
    expect(d.siblingDomains).toEqual([]);
  });

  it("records DNSSEC validity", () => {
    expect(distillCloudflareResult(CF).dnssecValid).toBe(false);
  });

  it("leaves the urlscan-only verdict lanes unset rather than faking them", () => {
    const d = distillCloudflareResult(CF);
    expect(d.verdicts.engines).toBeUndefined();
    expect(d.verdicts.community).toBeUndefined();
  });

  it("names what Cloudflare did not report", () => {
    const d = distillCloudflareResult(CF);
    expect(d.absent).toContain("cookies");
    expect(d.absent).toContain("certificates");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun run test lib/ti/url/active/cloudflare-detail.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Implement the adapter**

```ts
// lib/ti/url/active/cloudflare-detail.ts
import {
  capped,
  certTime,
  lane,
  MAX_LISTED,
  num,
  obj,
  str,
  type ScanDetail,
  type ScanRedirect,
} from "./detail";

/** Hostname of a URL, or undefined when it will not parse. */
function hostOf(value: unknown): string | undefined {
  const url = str(value);
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Cloudflare has no data.redirects: the chain is consecutive history entries,
 *  so N entries mean N-1 hops and a single entry means no redirect at all. */
function chainFromHistory(history: unknown): ScanRedirect[] {
  if (!Array.isArray(history)) return [];
  const hops: ScanRedirect[] = [];
  for (let i = 0; i + 1 < history.length && hops.length < MAX_LISTED; i++) {
    const from = str(obj(history[i]).url);
    const to = str(obj(history[i + 1]).url);
    if (from && to) {
      hops.push({ from, to, status: num(obj(history[i]).statusCode) });
    }
  }
  return hops;
}

export function distillCloudflareResult(raw: unknown): ScanDetail {
  const root = obj(raw);
  const page = obj(root.page);
  const lists = obj(root.lists);
  const data = obj(root.data);
  const stats = obj(root.stats);
  const processors = obj(obj(root.meta).processors);

  const requests = Array.isArray(data.requests) ? data.requests : [];
  const cookiesRaw = Array.isArray(data.cookies) ? data.cookies : [];
  const certsRaw = Array.isArray(lists.certificates) ? lists.certificates : [];
  const consoleRaw = Array.isArray(data.console) ? data.console : [];

  const whois = obj(obj(processors.whois).data);
  const scannedHost = str(page.domain);

  // Only the primary domain's risks describe the page under test; a
  // third-party asset's categories say nothing about it.
  const categoryRows = obj(processors.domainCategories).data;
  const primary = Array.isArray(categoryRows)
    ? categoryRows.find((row) => obj(row).isPrimary === true)
    : undefined;
  const risks = Array.isArray(obj(primary).risks)
    ? (obj(primary).risks as unknown[])
        .map((risk) => str(obj(risk).name))
        .filter((name): name is string => Boolean(name))
    : undefined;

  const rankRows = obj(processors.radarRank).data;
  const radarRankBucket = Array.isArray(rankRows)
    ? str(obj(rankRows[0]).bucket)
    : undefined;

  const dnsRows = obj(processors.dns).data;
  const dnssecValid = Array.isArray(dnsRows)
    ? obj(dnsRows[0]).dnssec_valid === true
    : undefined;

  const robotsRows = obj(processors.robotsTxt).data;
  const siblingDomains = Array.isArray(robotsRows)
    ? [
        ...new Set(
          robotsRows
            .flatMap((row) => {
              const sitemaps = obj(row).sitemaps;
              return Array.isArray(sitemaps) ? sitemaps : [];
            })
            .map(hostOf)
            .filter((host): host is string => Boolean(host) && host !== scannedHost),
        ),
      ]
    : undefined;

  const linkDomains = capped(lists.linkDomains);

  const detail: ScanDetail = {
    finalUrl: str(page.url),
    title: str(page.title),
    httpStatus: str(page.status),
    mimeType: str(page.mimeType),
    server: str(page.server),
    ip: str(page.ip),
    asn: str(page.asn),
    asnName: str(page.asnname),
    country: str(page.country),
    city: str(page.city),
    domain: scannedHost,
    apexDomain: str(page.apexDomain),

    // Cloudflare reports no domainAgeDays; the WHOIS creation date below is the
    // better signal anyway, since it is an instant rather than a rounded count.
    tlsIssuer: str(page.tlsIssuer),
    tlsValidFrom: str(page.tlsValidFrom),
    tlsValidDays: num(page.tlsValidDays),
    tlsAgeDays: num(page.tlsAgeDays),

    requestCount: requests.length,
    securePercentage: num(stats.securePercentage),
    maliciousRequestCount: num(stats.malicious),

    redirects: chainFromHistory(page.history),
    domains: capped(lists.domains).items,
    ips: capped(lists.ips).items,
    asns: capped(lists.asns).items,
    countries: capped(lists.countries).items,
    servers: capped(lists.servers).items,
    linkDomains: linkDomains.items,
    linkDomainCount: linkDomains.total,

    cookies: cookiesRaw.slice(0, MAX_LISTED).map((c) => {
      const cookie = obj(c);
      return {
        name: str(cookie.name) ?? "",
        domain: str(cookie.domain),
        secure: cookie.secure === true,
        httpOnly: cookie.httpOnly === true,
      };
    }),
    certificates: certsRaw.slice(0, MAX_LISTED).map((c) => {
      const cert = obj(c);
      return {
        subject: str(cert.subjectName),
        issuer: str(cert.issuer),
        validFrom: certTime(cert.validFrom),
        validTo: certTime(cert.validTo),
      };
    }),
    consoleMessages: consoleRaw
      .slice(0, MAX_LISTED)
      .map((entry) => str(obj(obj(entry).message).text) ?? str(obj(entry).text))
      .filter((m): m is string => Boolean(m)),

    // Cloudflare publishes one lane. The urlscan-only lanes stay unset rather
    // than being invented as false, which would read as a scanner's verdict.
    verdicts: { overall: lane(obj(root.verdicts).overall) ?? { malicious: false } },

    registrar: str(whois.registrar),
    domainCreated: str(whois.created_date),
    domainExpires: str(whois.expiration_date),
    nameservers: Array.isArray(whois.nameservers)
      ? (whois.nameservers as string[]).slice(0, MAX_LISTED)
      : undefined,
    riskCategories: risks,
    radarRankBucket,
    domStructHash: str(page.domStructHash),
    siblingDomains,
    dnssecValid,

    absent: [],
  };

  const emptyChecks: [string, boolean][] = [
    ["requests", requests.length === 0],
    ["cookies", cookiesRaw.length === 0],
    ["certificates", certsRaw.length === 0],
    ["console output", consoleRaw.length === 0],
    ["page links", (linkDomains.total ?? 0) === 0],
  ];
  detail.absent = emptyChecks.filter(([, empty]) => empty).map(([name]) => name);

  return detail;
}
```

Add the nine new optional fields to `ScanDetail` in `detail.ts`, each with a
one-line comment naming Cloudflare as the only source.

- [ ] **Step 6: Run the tests**

Run: `bun run test lib/ti/url/active/ && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 7: Check the adapter against the real payload, not only the fixture**

The urlscan adapter shipped with a redirect bug precisely because its fixture
encoded the same guess as its parser. Do not repeat that. Save a real result and
run the adapter over it:

```bash
set -a; . ./.env.local; set +a
UUID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/urlscanner/v2/search?limit=1" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['results'][0]['task']['uuid'])")
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/urlscanner/v2/result/$UUID" \
  -o /tmp/cf-real.json
```

Then write a throwaway script that imports `distillCloudflareResult`, runs it
over `/tmp/cf-real.json`, prints the result, and delete the script afterwards.
Confirm `redirects`, `registrar`, `riskCategories` and `siblingDomains` are
populated when the source data has them. If any field is empty while the raw
JSON clearly holds it, the adapter is wrong, not the payload.

- [ ] **Step 8: Commit**

```bash
git add lib/ti/url/active/cloudflare-detail.ts lib/ti/url/active/cloudflare-detail.test.ts \
        lib/ti/url/active/detail.ts lib/ti/url/active/cloudflare.ts \
        lib/ti/url/active/cloudflare.test.ts
git commit -m "feat(scan): adapt Cloudflare results into the shared scan detail"
```

---

### Task 3: Merge the two engines

**Files:**
- Create: `lib/ti/url/active/merge.ts`
- Test: `lib/ti/url/active/merge.test.ts`

**Interfaces:**
- Consumes: `ScanDetail` from `./detail`, `ScanEngine` / `ENGINE_NAME` from `./engines`, `ActiveScan` from `./types`.
- Produces:
  ```ts
  export interface EngineDisagreement {
    field: string;              // human label, e.g. "HTTP status"
    values: { engine: ScanEngine; value: string }[];
    note?: string;              // why it matters, when it does
  }
  export interface MergedScan {
    target: string;
    engines: ScanEngine[];      // engines that produced a finished scan
    detail: ScanDetail;         // one reading, single-sided data merged in
    disagreements: EngineDisagreement[];
    /** Engines that ran but did not finish or failed, with their reason. */
    incomplete: { engine: ScanEngine; status: string; error?: string }[];
  }
  export function mergeScans(scans: ActiveScan[]): MergedScan[];
  ```
  `mergeScans` groups by `target` and returns one `MergedScan` per target.

**Merge rules, from the spec:** data only one engine has is taken as-is; data
both agree on appears once; data they disagree on stays in `detail` from the
first engine in `ENGINE_ORDER` **and** is recorded in `disagreements`, so the UI
can show both attributed.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/ti/url/active/merge.test.ts
import { describe, expect, it } from "vitest";
import { mergeScans } from "@/lib/ti/url/active/merge";
import type { ActiveScan } from "@/lib/ti/url/active/types";
import type { ScanDetail } from "@/lib/ti/url/active/detail";

const detail = (over: Partial<ScanDetail> = {}): ScanDetail => ({
  requestCount: 0,
  verdicts: { overall: { malicious: false } },
  absent: [],
  ...over,
});

const scan = (over: Partial<ActiveScan> & Pick<ActiveScan, "engine">): ActiveScan => ({
  target: "https://evil.com/a",
  status: "done",
  ...over,
});

describe("mergeScans", () => {
  it("merges data only one engine reported", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ domainAgeDays: 3 }) }),
      scan({ engine: "cloudflare", detail: detail({ registrar: "Dynadot Inc" }) }),
    ]);
    expect(merged.detail.domainAgeDays).toBe(3);
    expect(merged.detail.registrar).toBe("Dynadot Inc");
    expect(merged.engines).toEqual(["urlscan", "cloudflare"]);
  });

  it("shows agreeing data once and reports no disagreement", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ httpStatus: "200", ip: "1.2.3.4" }) }),
      scan({ engine: "cloudflare", detail: detail({ httpStatus: "200", ip: "1.2.3.4" }) }),
    ]);
    expect(merged.detail.httpStatus).toBe("200");
    expect(merged.disagreements).toEqual([]);
  });

  it("records a disagreement with both values attributed", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ httpStatus: "200" }) }),
      scan({ engine: "cloudflare", detail: detail({ httpStatus: "403" }) }),
    ]);
    expect(merged.disagreements).toEqual([
      {
        field: "HTTP status",
        values: [
          { engine: "urlscan", value: "200" },
          { engine: "cloudflare", value: "403" },
        ],
        note: "A site answering differently by visitor is what a kit dodging scanners does.",
      },
    ]);
  });

  it("treats a malicious split as a disagreement worth naming", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ verdicts: { overall: { malicious: true } } }) }),
      scan({ engine: "cloudflare", detail: detail({ verdicts: { overall: { malicious: false } } }) }),
    ]);
    expect(merged.disagreements.map((d) => d.field)).toContain("Verdict");
  });

  it("does not call a value missing from one engine a disagreement", () => {
    // Silence is not a competing claim.
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ httpStatus: "200" }) }),
      scan({ engine: "cloudflare", detail: detail({}) }),
    ]);
    expect(merged.disagreements).toEqual([]);
    expect(merged.detail.httpStatus).toBe("200");
  });

  it("reports an engine that did not finish rather than dropping it", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ httpStatus: "200" }) }),
      scan({ engine: "cloudflare", status: "error", error: "Rate limited" }),
    ]);
    expect(merged.engines).toEqual(["urlscan"]);
    expect(merged.incomplete).toEqual([
      { engine: "cloudflare", status: "error", error: "Rate limited" },
    ]);
  });

  it("groups by target, so an IP's two ports stay separate", () => {
    const merged = mergeScans([
      scan({ target: "http://1.2.3.4/", engine: "urlscan", detail: detail() }),
      scan({ target: "https://1.2.3.4/", engine: "urlscan", detail: detail() }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.target)).toEqual(["http://1.2.3.4/", "https://1.2.3.4/"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/url/active/merge.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the merge**

```ts
// lib/ti/url/active/merge.ts
import type { ScanDetail } from "./detail";
import type { ScanEngine } from "./engines";
import type { ActiveScan } from "./types";

/** Whose value wins a tie-break in the merged detail. urlscan first only
 *  because it reports more fields; the loser is never discarded, it is
 *  recorded as a disagreement. */
const ENGINE_ORDER: ScanEngine[] = ["urlscan", "cloudflare"];

export interface EngineDisagreement {
  field: string;
  values: { engine: ScanEngine; value: string }[];
  note?: string;
}

export interface MergedScan {
  target: string;
  engines: ScanEngine[];
  detail: ScanDetail;
  disagreements: EngineDisagreement[];
  incomplete: { engine: ScanEngine; status: string; error?: string }[];
}

/** Fields worth comparing across engines, with the label the UI shows. Only
 *  facts about what was served: a field one engine simply does not report is
 *  not a competing claim. */
const COMPARED: { key: keyof ScanDetail; label: string; note?: string }[] = [
  {
    key: "httpStatus",
    label: "HTTP status",
    note: "A site answering differently by visitor is what a kit dodging scanners does.",
  },
  { key: "finalUrl", label: "Final URL" },
  { key: "ip", label: "Serving IP" },
  { key: "server", label: "Server" },
  { key: "title", label: "Page title" },
];

function readingsOf(
  finished: { engine: ScanEngine; detail: ScanDetail }[],
  key: keyof ScanDetail,
): { engine: ScanEngine; value: string }[] {
  return finished
    .map(({ engine, detail }) => ({ engine, value: detail[key] }))
    .filter(
      (r): r is { engine: ScanEngine; value: string } =>
        typeof r.value === "string" && r.value !== "",
    );
}

function disagreementsIn(
  finished: { engine: ScanEngine; detail: ScanDetail }[],
): EngineDisagreement[] {
  const out: EngineDisagreement[] = [];

  for (const { key, label, note } of COMPARED) {
    const values = readingsOf(finished, key);
    if (values.length < 2) continue;
    if (new Set(values.map((v) => v.value)).size === 1) continue;
    out.push({ field: label, values, ...(note ? { note } : {}) });
  }

  const verdicts = finished.map(({ engine, detail }) => ({
    engine,
    value: detail.verdicts.overall.malicious ? "malicious" : "not malicious",
  }));
  if (
    verdicts.length >= 2 &&
    new Set(verdicts.map((v) => v.value)).size > 1
  ) {
    out.push({
      field: "Verdict",
      values: verdicts,
      note: "One engine flagged this and the other did not.",
    });
  }

  return out;
}

/** First defined value across engines, in ENGINE_ORDER. */
function mergedDetail(
  finished: { engine: ScanEngine; detail: ScanDetail }[],
): ScanDetail {
  const ordered = [...finished].sort(
    (a, b) => ENGINE_ORDER.indexOf(a.engine) - ENGINE_ORDER.indexOf(b.engine),
  );
  const base: ScanDetail = {
    requestCount: 0,
    verdicts: { overall: { malicious: false } },
    absent: [],
  };
  const out: Record<string, unknown> = { ...base };
  for (const { detail } of ordered) {
    for (const [key, value] of Object.entries(detail)) {
      const empty =
        value === undefined ||
        value === null ||
        (Array.isArray(value) && value.length === 0);
      if (!empty && (out[key] === undefined || isEmptyValue(out[key]))) {
        out[key] = value;
      }
    }
  }
  // Malicious anywhere is malicious in the merged reading; the split itself is
  // reported separately as a disagreement.
  out.verdicts = {
    ...(out.verdicts as ScanDetail["verdicts"]),
    overall: {
      ...(out.verdicts as ScanDetail["verdicts"]).overall,
      malicious: finished.some((f) => f.detail.verdicts.overall.malicious),
    },
  };
  // absent is the intersection: a block one engine reported is not absent.
  const absentSets = finished.map((f) => new Set(f.detail.absent));
  out.absent = [...(absentSets[0] ?? new Set<string>())].filter((name) =>
    absentSets.every((set) => set.has(name)),
  );
  return out as unknown as ScanDetail;
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** One merged reading per scanned target. */
export function mergeScans(scans: ActiveScan[]): MergedScan[] {
  const byTarget = new Map<string, ActiveScan[]>();
  for (const scan of scans) {
    byTarget.set(scan.target, [...(byTarget.get(scan.target) ?? []), scan]);
  }

  return [...byTarget.entries()].map(([target, group]) => {
    const finished = group
      .filter((s) => s.status === "done" && s.detail)
      .map((s) => ({ engine: s.engine, detail: s.detail as ScanDetail }));
    const incomplete = group
      .filter((s) => s.status !== "done" || !s.detail)
      .map((s) => ({
        engine: s.engine,
        status: s.status,
        ...(s.error ? { error: s.error } : {}),
      }));

    return {
      target,
      engines: finished.map((f) => f.engine),
      detail: mergedDetail(finished),
      disagreements: disagreementsIn(finished),
      incomplete,
    };
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test lib/ti/url/active/merge.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/url/active/merge.ts lib/ti/url/active/merge.test.ts
git commit -m "feat(scan): merge the two engines and name their disagreements"
```

---

### Task 4: Run both engines from the route

**Files:**
- Modify: `app/api/scan-url/route.ts`

**Interfaces:**
- Consumes: `submitCloudflareScan`, `pollCloudflareScan` (Task 1); `submitScan`, `pollScan` from `./urlscan`.
- Produces: no new exports. `ActiveScanBatch.scans` now holds one record per engine per target.

**Behaviour:** each engine is gated on its own credentials. urlscan needs
`URLSCAN_API_KEY`; Cloudflare needs both `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. With one configured the route runs that one and says
which is missing. With neither, it returns 503 as it does today.

- [ ] **Step 1: Replace the submit fan-out**

In `POST`, replace the single-engine `Promise.all` with one that runs every
configured engine against every target:

```ts
const urlscanKey = process.env.URLSCAN_API_KEY;
const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfReady = Boolean(cfToken && cfAccount);

if (!urlscanKey && !cfReady) {
  return Response.json(MISSING_KEY, { status: 503 });
}

const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
const jobs: Promise<ActiveScan>[] = [];
for (const target of targets) {
  if (urlscanKey) jobs.push(submitScan(target, urlscanKey, signal));
  if (cfReady) {
    jobs.push(submitCloudflareScan(target, cfToken as string, cfAccount as string, signal));
  }
}
const scans = await Promise.all(jobs);
```

Widen `MISSING_KEY` so it names both:

```ts
const MISSING_KEY = {
  error:
    "Active scanning needs urlscan.io or Cloudflare credentials. Set URLSCAN_API_KEY, or CLOUDFLARE_API_TOKEN with CLOUDFLARE_ACCOUNT_ID.",
  keyEnv: "URLSCAN_API_KEY",
};
```

- [ ] **Step 2: Route each poll to its own engine**

In `GET`, dispatch on the record's engine:

```ts
const scans = await Promise.all(
  batch.scans.map((scan) => {
    if (scan.status !== "running") return scan;
    if (scan.engine === "cloudflare") {
      return cfReady
        ? pollCloudflareScan(scan, cfToken as string, cfAccount as string, signal)
        : scan;
    }
    return urlscanKey ? pollScan(scan, urlscanKey, signal) : scan;
  }),
);
```

Read the three env vars at the top of `GET` as well, and keep the existing 503
when neither engine is configured.

- [ ] **Step 3: Verify both engines end to end**

This spends one scan on each engine. Use a benign target.

```bash
bun run build && (setsid bun run start --port 3100 &) ; sleep 9
curl -s -X POST localhost:3100/api/scan-url -H 'content-type: application/json' \
  -d '{"indicator":"wikipedia.org","force":true}' \
  | python3 -c "import sys,json;[print(s['engine'], s['status'], s.get('uuid'), s.get('error')) for s in json.load(sys.stdin)['scans']]"
```

Expected: two rows, one per engine, both `running` with a uuid. Then poll until
both read `done`:

```bash
until curl -s "localhost:3100/api/scan-url?indicator=wikipedia.org" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);exit(0 if all(s['status']=='done' for s in d['scans']) else 1)"; do sleep 5; done
```

Stop the server afterwards with `pkill -f "next start.*3100"`. **Do not kill
anything on port 3000**; the owner runs their own dev server there.

- [ ] **Step 4: Commit**

```bash
git add app/api/scan-url/route.ts
git commit -m "feat(api): submit and poll both scan engines"
```

---

### Task 5: Show both engines in the inline card

**Files:**
- Modify: `components/CheckResults/active-scan.tsx`

**Interfaces:**
- Consumes: `mergeScans`, `MergedScan` (Task 3); `ENGINE_NAME` (Task 1).

**What changes:** the card currently renders one row per `ActiveScan`. It now
renders one row per **merged target**, with the engines that finished named on
the row, the disagreements written out beneath it, and any engine that did not
finish named rather than omitted.

- [ ] **Step 1: Render merged targets**

Replace the `batch.scans.map(...)` body with a merge first:

```tsx
const merged = mergeScans(batch.scans);
// ...
{merged.map((m) => (
  <MergedRow key={m.target} merged={m} />
))}
```

- [ ] **Step 2: Write the row**

```tsx
function MergedRow({ merged }: Readonly<{ merged: MergedScan }>) {
  const d = merged.detail;
  const malicious = d.verdicts.overall.malicious;
  return (
    <div className="space-y-2 border-b border-foreground/10 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <code className="min-w-0 truncate font-mono text-xs">{merged.target}</code>
        <span
          className={`text-xs ${malicious ? "text-red-600 dark:text-red-400" : "text-foreground/70"}`}
        >
          {merged.engines.length === 0
            ? "no engine finished yet"
            : malicious
              ? "flagged by the scanner"
              : "no verdict from the scanner"}
        </span>
      </div>

      {merged.engines.length > 0 && (
        <p className="text-xs text-foreground/55">
          Scanned by {merged.engines.map((e) => ENGINE_NAME[e]).join(" and ")}
        </p>
      )}

      {merged.disagreements.map((disagreement) => (
        <p key={disagreement.field} className="text-xs text-amber-600 dark:text-amber-400">
          {disagreement.field} differs:{" "}
          {disagreement.values
            .map((v) => `${ENGINE_NAME[v.engine]} saw ${v.value}`)
            .join(", ")}
          {disagreement.note ? `. ${disagreement.note}` : ""}
        </p>
      ))}

      {merged.incomplete.map((entry) => (
        <p key={entry.engine} className="text-xs text-foreground/55">
          {ENGINE_NAME[entry.engine]}:{" "}
          {entry.status === "running" ? "still scanning" : (entry.error ?? entry.status)}
        </p>
      ))}
    </div>
  );
}
```

Keep the existing detail rows (redirected-to, served-from, contacted) and the
screenshot, reading them from `merged.detail`. **Only render a screenshot whose
URL is on `urlscan.io`.** Cloudflare's screenshot is an authenticated API
endpoint and an `<img>` pointed at it fails; carrying it would show a broken
image. Add that as a comment where the check happens.

- [ ] **Step 3: Verify in a browser**

Start the production server on port 3100 as in Task 4, open
`http://localhost:3100/check/wikipedia.org`, run a scan, and confirm: one row
per target naming both engines, a disagreement line when they differ, no broken
image, and zero console errors. Check 1280px light, 1280px dark, and 390px.
**If you cannot verify in a browser, say so explicitly rather than claiming it
works.**

- [ ] **Step 4: Run the full suite and commit**

```bash
bun run test && bun run lint && bun run typecheck && bun run build
git add components/CheckResults/active-scan.tsx
git commit -m "feat(ui): show both scan engines and name their disagreements"
```

---

## Definition of done

- `bun run test`, `bun run lint`, `bun run typecheck`, `bun run build` all pass.
- One scan submits to both engines and both appear in the batch, each tagged.
- A target both engines finished shows one merged row naming both.
- A field the engines read differently is written out with each value attributed.
- An engine that failed or is still running is named on the row, not omitted.
- No broken screenshot from Cloudflare's authenticated endpoint.
