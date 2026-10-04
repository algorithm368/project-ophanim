# IOC Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Timeline tile above Subject record on `/check`, made of a phase strip (how the indicator lived) over a dated ledger (what happened when), built only from dates the sources already return.

**Architecture:** A pure module `lib/ti/timeline.ts` turns a check result into `{ events, gaps, phases }`. It reads per-source fields (not the merged context, which loses who said what), folds each event kind to its earliest (or latest) source, and derives phases from the folded events. A client component renders it. Subject record drops its date rows on `/check` only, through an option, so the active-scan page keeps them.

**Tech Stack:** TypeScript, React 19, Next 16 App Router, Tailwind, Vitest. Run everything with `bun run <script>`, never `bun test`.

**Spec:** `docs/superpowers/specs/2026-10-04-ioc-timeline-design.md`

## Global Constraints

- No Ophanim data in the timeline: `result.history` / `ti:hist` are never read.
- Copy uses commas, never em or en dashes or ` - ` separators.
- Monochrome skin: colour only on adverse rows and the listed phase (`text-red-600 dark:text-red-400`, `bg-red-600 dark:bg-red-400`). System fonts, mono for dates and sources.
- `no-nested-ternary` and `sonarjs/cognitive-complexity` (15) are lint errors in `app/`, `components/`, `lib/`.
- Tests are colocated `lib/**/*.test.ts`, pure, no network, `@/` alias.
- Dormant cutoff is `2018-05-01`. Quiet phase at ≥ 90 days. Ledger gap line at ≥ 6 months.
- "Now" for the timeline is `result.checkedAt`, not the wall clock (deterministic, and honest about a cached result).
- The working tree on `main` has unrelated uncommitted sprite work in `components/CheckResults/*`. Do this work in a worktree branched from `HEAD` (`superpowers:using-git-worktrees`, branch `feat/ioc-timeline`), and copy the spec and this plan into it first.

## Spec deltas found while planning

These are settled here and the spec is updated to match in Task 1:

- **VT `creation_date` is not read by the domain adapter** (type only), so `registered` comes from RDAP alone.
- **ThreatFox records no first-seen** in any of its three adapters, so it can't open a listing. Task 1 adds `details.firstSeen` (and `hashContext.firstSeen` for hashes).
- **The passive result page has no section nav** (only the scan page uses `SectionNav`), so the tile gets `id="timeline"` and no nav entry.
- **`IdentityCard` on the active-scan page also renders `RecordTile`.** Dates leave the record only when `omitDates` is passed, which `/check` does, so the scan page keeps its dates.
- **Live starts at the earliest of `first-resolved`, `cert-issued`, `first-seen`, `listed`**, for every type. Dormant ends at the same point.

## File map

| File | Change | Responsibility |
|---|---|---|
| `lib/ti/sources/threatfox.ts` | modify | export `threatFoxWindow`, put `firstSeen` in details |
| `lib/ti/domain/sources/threatfox.ts` | modify | use `threatFoxWindow`, `firstSeen` in details |
| `lib/ti/hash/sources/threatfox.ts` | modify | use `threatFoxWindow`, `firstSeen` in hashContext + details |
| `lib/ti/sources/threatfox.test.ts` | modify | `threatFoxWindow` cases |
| `lib/ti/timeline.ts` | create | events, gaps, phases, labels |
| `lib/ti/timeline.test.ts` | create | all timeline logic |
| `lib/ti/identity.ts` | modify | `buildIdentity(r, { omitDates })` |
| `lib/ti/identity.test.ts` | modify | `omitDates` case |
| `components/CheckResults/timeline.tsx` | create | `TimelineTile`, `PhaseStrip`, `Ledger` |
| `components/CheckResults/identity.tsx` | modify | `RecordTile` `omitDates` prop |
| `components/CheckResults/index.tsx` | modify | insert tile ×3, pass `omitDates` ×3 |
| `components/CheckResults/pending.tsx` | modify | timeline skeleton before Subject record |

---

### Task 1: ThreatFox first-seen, and the spec deltas

**Files:**
- Modify: `lib/ti/sources/threatfox.ts`, `lib/ti/domain/sources/threatfox.ts`, `lib/ti/hash/sources/threatfox.ts`
- Modify: `docs/superpowers/specs/2026-10-04-ioc-timeline-design.md`
- Test: `lib/ti/sources/threatfox.test.ts`

**Interfaces:**
- Produces: `threatFoxWindow(entries: { first_seen?: string; last_seen?: string }[]): { firstSeen?: string; lastSeen?: string }` exported from `lib/ti/sources/threatfox.ts`. All three ThreatFox findings carry `details.firstSeen`; the hash one also has `hashContext.firstSeen`.

- [ ] **Step 1: Write the failing test.** Append to `lib/ti/sources/threatfox.test.ts`, and add `threatFoxWindow` to the existing import from `./threatfox`:

```ts
describe("threatFoxWindow", () => {
  it("takes the earliest first_seen and the latest last_seen, skipping blanks", () => {
    expect(
      threatFoxWindow([
        { first_seen: "2025-03-01 10:00:00 UTC", last_seen: "2026-08-14 19:38:23 UTC" },
        { first_seen: "", last_seen: "2026-03-04 09:00:00 UTC" },
        { first_seen: "2025-01-19 08:00:00 UTC" },
      ]),
    ).toEqual({ firstSeen: "2025-01-19 08:00:00 UTC", lastSeen: "2026-08-14 19:38:23 UTC" });
  });

  it("answers undefined for both when no entry is dated", () => {
    expect(threatFoxWindow([{}, { first_seen: "" }])).toEqual({
      firstSeen: undefined,
      lastSeen: undefined,
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `bun run test lib/ti/sources/threatfox.test.ts`. Expected: FAIL, `threatFoxWindow` is not exported.

- [ ] **Step 3: Implement.** In `lib/ti/sources/threatfox.ts`, add above `threatFoxSource`:

```ts
/** Earliest first sighting and newest last sighting across a ThreatFox
 *  answer. Both lean on ThreatFox's timestamp format sorting chronologically
 *  by code unit, the same promise the last-seen pick already relied on. */
export function threatFoxWindow(
  entries: { first_seen?: string; last_seen?: string }[],
): { firstSeen?: string; lastSeen?: string } {
  const dated = (key: "first_seen" | "last_seen") =>
    entries
      .map((e) => e[key])
      .filter((s): s is string => Boolean(s))
      .sort(byCodeUnit);
  return { firstSeen: dated("first_seen")[0], lastSeen: dated("last_seen").at(-1) };
}
```

In the same file, replace the `const lastSeen = entries ... .at(-1);` block with:

```ts
      const { firstSeen, lastSeen } = threatFoxWindow(entries);
```

and add `firstSeen,` as the first key of the returned `details` object.

In `lib/ti/domain/sources/threatfox.ts`: add `first_seen?: string;` to `ThreatFoxEntry` above `last_seen`, add `import { threatFoxWindow } from "../../sources/threatfox";`, replace the `const lastSeen = entries ... .at(-1);` block with `const { firstSeen, lastSeen } = threatFoxWindow(entries);`, and add `firstSeen,` as the first key of `details`. If `byCodeUnit` is now unused there, remove its import.

In `lib/ti/hash/sources/threatfox.ts`: the same import and the same replacement. Add `firstSeen,` as the first key of `details`, and `firstSeen,` to `hashContext` above `lastSeen: lastSeen ?? undefined,`. Remove the `byCodeUnit` import if it's now unused.

- [ ] **Step 4: Run the ThreatFox tests.** `bun run test lib/ti/sources/threatfox.test.ts lib/ti/domain/sources/threatfox.test.ts lib/ti/hash/sources/threatfox.test.ts`. Expected: PASS, including the existing "newest last_seen" cases.

- [ ] **Step 5: Apply the spec deltas.** In the spec, add a `## Planning deltas` section listing the five bullets from this plan's "Spec deltas found while planning". In the event table, change the Registered cell to `RDAP createdAt`, and in the UI section remove "with an entry in the section nav".

- [ ] **Step 6: Commit.**

```bash
git add lib/ti/sources/threatfox.ts lib/ti/sources/threatfox.test.ts lib/ti/domain/sources/threatfox.ts lib/ti/hash/sources/threatfox.ts docs/superpowers/specs/2026-10-04-ioc-timeline-design.md docs/superpowers/plans/2026-10-04-ioc-timeline.md
git commit -m "ThreatFox records its first sighting, for the timeline"
```

---

### Task 2: Timeline events and gaps

**Files:**
- Create: `lib/ti/timeline.ts`
- Test: `lib/ti/timeline.test.ts`

**Interfaces:**
- Consumes: `parseSeen` from `lib/ti/subject-record.ts`, `isDomainResult` / `isHashResult` from `lib/ti/types.ts`, `src` / `stats` from `lib/ti/subject-record.test.ts` (test fixtures, already shared this way by `identity.test.ts`).
- Produces (later tasks rely on these exact names):

```ts
export type EventKind = "registered" | "first-resolved" | "cert-issued" | "first-seen" | "listed"
  | "last-seen" | "last-resolved" | "last-reported" | "cert-expires" | "expires";
export type PhaseKind = "before-records" | "dormant" | "live" | "listed" | "quiet" | "paid-to" | "lapsed";
export interface TimelineEvent { kind: EventKind; at: string; source: string;
  also: { source: string; at: string }[]; detail?: string; tone: "neutral" | "adverse" | "future" }
export interface TimelineGap { after: EventKind; months: number }
export interface Phase { kind: PhaseKind; from: string; to: string; ongoing: boolean; edges: EventKind[] }
export interface Timeline { now: string; events: TimelineEvent[]; gaps: TimelineGap[];
  phases: Phase[]; sourceCount: number }
export const EVENT_LABEL: Record<EventKind, string>;
export const PHASE_LABEL: Record<PhaseKind, string>;
export function buildTimeline(result: AnyCheckResult, now?: Date): Timeline;  // now defaults to result.checkedAt
export function phaseSpan(from: string, to: string): string;                  // Task 3
```

All `at`, `from`, `to` and `now` values are ISO days (`YYYY-MM-DD`).

- [ ] **Step 1: Write the failing tests.** Create `lib/ti/timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/lib/ti/timeline";
import type {
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
  SourceResult,
} from "@/lib/ti/types";
import { src, stats } from "@/lib/ti/subject-record.test";

const NOW = new Date(Date.UTC(2026, 9, 4, 12));

function domain(sources: SourceResult[]): DomainCheckResult {
  return {
    domain: "cdn-update-check.net",
    checkedAt: NOW.toISOString(),
    riskScore: 88,
    verdict: "malicious",
    sources,
    stats: stats(sources.length),
  };
}

function ip(sources: SourceResult[]): CheckResult {
  return {
    ip: "185.220.101.4",
    checkedAt: NOW.toISOString(),
    riskScore: 90,
    verdict: "malicious",
    sources,
    stats: stats(sources.length),
  } as CheckResult;
}

function hash(sources: SourceResult[]): HashCheckResult {
  return {
    hash: "a".repeat(64),
    algorithm: "sha256",
    checkedAt: NOW.toISOString(),
    riskScore: 95,
    verdict: "malicious",
    sources,
    stats: stats(sources.length),
  } as HashCheckResult;
}

const rdap = (createdAt: string, expiresAt?: string) =>
  src({ id: "rdap", domainContext: { createdAt, expiresAt, registrar: "NameCheap" } });

const pdns = (...rows: [string, string, string][]): SourceResult => ({
  ...src({ id: "mnemonic-pdns" }),
  passiveDns: rows.map(([value, firstSeen, lastSeen]) => ({ value, type: "ip", firstSeen, lastSeen })),
});

const cert = (firstSeen: string): SourceResult => ({
  ...src({ id: "certspotter" }),
  certificates: [{ issuer: "Let's Encrypt R11", sans: [], firstSeen }],
});

const listing = (id: string, firstSeen: string, lastSeen: string, categories: string[]) =>
  src({ id, malicious: true, details: { firstSeen }, lastSeen, categories });

/** The made-up domain from the mocks. */
const story = () =>
  domain([
    rdap("2023-04-12T00:00:00Z", "2027-04-12T00:00:00Z"),
    pdns(["185.220.101.4", "2024-11-02T10:00:00Z", "2026-09-01T00:00:00Z"]),
    cert("2024-11-03T00:00:00Z"),
    listing("urlhaus", "2025-01-19 08:00:00", "2025-01-19 08:00:00", ["malware_download", "emotet"]),
    listing("threatfox", "2025-02-01 00:00:00 UTC", "2026-09-30 12:00:00 UTC", ["botnet_cc"]),
  ]);

describe("buildTimeline events", () => {
  it("tells a domain's life in date order, one row per kind", () => {
    const t = buildTimeline(story(), NOW);
    expect(t.events.map((e) => [e.kind, e.at, e.source])).toEqual([
      ["registered", "2023-04-12", "rdap"],
      ["first-resolved", "2024-11-02", "mnemonic-pdns"],
      ["cert-issued", "2024-11-03", "certspotter"],
      ["listed", "2025-01-19", "urlhaus"],
      ["last-resolved", "2026-09-01", "mnemonic-pdns"],
      ["last-reported", "2026-09-30", "threatfox"],
      ["expires", "2027-04-12", "rdap"],
    ]);
    expect(t.now).toBe("2026-10-04");
    expect(t.sourceCount).toBe(5);
  });

  it("folds the other sources into `also`, earliest wins for first kinds, latest for last", () => {
    const t = buildTimeline(story(), NOW);
    const listed = t.events.find((e) => e.kind === "listed");
    const reported = t.events.find((e) => e.kind === "last-reported");
    expect(listed?.also).toEqual([{ source: "threatfox", at: "2025-02-01" }]);
    expect(reported?.also).toEqual([{ source: "urlhaus", at: "2025-01-19" }]);
  });

  it("colours only listings and reports, and marks future dates", () => {
    const tones = Object.fromEntries(buildTimeline(story(), NOW).events.map((e) => [e.kind, e.tone]));
    expect(tones).toEqual({
      registered: "neutral",
      "first-resolved": "neutral",
      "cert-issued": "neutral",
      listed: "adverse",
      "last-resolved": "neutral",
      "last-reported": "adverse",
      expires: "future",
    });
  });

  it("carries a short detail where the source gives one", () => {
    const by = Object.fromEntries(buildTimeline(story(), NOW).events.map((e) => [e.kind, e.detail]));
    expect(by.registered).toBe("via NameCheap");
    expect(by["first-resolved"]).toBe("to 185.220.101.4");
    expect(by["cert-issued"]).toBe("Let's Encrypt R11");
    expect(by.listed).toBe("malware_download, emotet");
  });

  it("counts a source once per kind, by its own earliest row", () => {
    const t = buildTimeline(
      domain([
        pdns(
          ["1.2.3.4", "2024-01-01T00:00:00Z", "2024-02-01T00:00:00Z"],
          ["5.6.7.8", "2023-06-01T00:00:00Z", "2024-03-01T00:00:00Z"],
        ),
      ]),
      NOW,
    );
    const first = t.events.find((e) => e.kind === "first-resolved");
    expect(first).toMatchObject({ at: "2023-06-01", detail: "to 5.6.7.8", also: [] });
  });

  it("files a malicious listing source as listed, any other source as seen (IP)", () => {
    const t = buildTimeline(
      ip([
        src({ id: "rdap-ip", domainContext: { createdAt: "1998-01-01T00:00:00Z" } }),
        listing("feodo", "2025-06-01 00:00:00", "2026-10-01 00:00:00", ["botnet-c2"]),
        src({ id: "dshield", details: { feedFirstSeen: "2025-03-01" }, lastSeen: "2026-09-28" }),
        src({ id: "abuseipdb", malicious: true, lastSeen: "2026-10-03T00:00:00+00:00" }),
      ]),
      NOW,
    );
    expect(t.events.map((e) => [e.kind, e.at, e.source])).toEqual([
      ["first-seen", "2025-03-01", "dshield"],
      ["listed", "2025-06-01", "feodo"],
      ["last-seen", "2026-09-28", "dshield"],
      ["last-reported", "2026-10-03", "abuseipdb"],
    ]);
  });

  it("reads a hash's dates from hashContext, and lists only malicious listing sources", () => {
    const t = buildTimeline(
      hash([
        src({ id: "virustotal", malicious: true, hashContext: { firstSeen: "2025-02-07T09:00:00Z", lastSeen: "2026-03-01T00:00:00Z" } }),
        src({ id: "malwarebazaar", malicious: true, hashContext: { firstSeen: "2025-02-07 12:00:00", lastSeen: "2025-08-01 00:00:00" } }),
        src({ id: "kaspersky-opentip", hashContext: { firstSeen: "2025-03-01T00:00:00Z" } }),
      ]),
      NOW,
    );
    expect(t.events.map((e) => [e.kind, e.at, e.source, e.also.length])).toEqual([
      ["first-seen", "2025-02-07", "virustotal", 2],
      ["listed", "2025-02-07", "malwarebazaar", 0],
      ["last-seen", "2026-03-01", "virustotal", 1],
    ]);
  });

  it("ignores sources that did not answer and dates that do not parse", () => {
    const t = buildTimeline(
      ip([
        src({ id: "greynoise", status: "error", lastSeen: "2026-01-01" }),
        src({ id: "dshield", details: { feedFirstSeen: "not a date" }, lastSeen: "1985-01-01" }),
      ]),
      NOW,
    );
    expect(t.events).toEqual([]);
  });

  it("answers an empty timeline for an undated result", () => {
    expect(buildTimeline(hash([]), NOW)).toEqual({
      now: "2026-10-04",
      events: [],
      gaps: [],
      phases: [],
      sourceCount: 0,
    });
  });

  it("defaults now to the result's checkedAt", () => {
    expect(buildTimeline(story()).now).toBe("2026-10-04");
  });
});

describe("buildTimeline gaps", () => {
  it("marks every stretch of six calendar months or more", () => {
    expect(buildTimeline(story(), NOW).gaps).toEqual([
      { after: "registered", months: 18 },
      { after: "listed", months: 19 },
      { after: "last-reported", months: 6 },
    ]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** `bun run test lib/ti/timeline.test.ts`. Expected: FAIL, cannot resolve `@/lib/ti/timeline`.

- [ ] **Step 3: Implement.** Create `lib/ti/timeline.ts`:

```ts
import { parseSeen } from "./subject-record";
import { isDomainResult, isHashResult } from "./types";
import type { AnyCheckResult, SourceResult } from "./types";

/**
 * The indicator's life, in the order the outside world recorded it.
 *
 * Only what the sources dated. Ophanim's own check history is deliberately
 * absent: it says when we looked, not when anything happened.
 *
 * Every kind appears once. Several sources reporting the same kind fold into
 * one row, dated by the earliest (or, for the "last" kinds, the latest), with
 * the rest kept in `also`, so a data-rich hash stays a short story instead of
 * six "first seen" rows in one February.
 */

export type EventKind =
  | "registered"
  | "first-resolved"
  | "cert-issued"
  | "first-seen"
  | "listed"
  | "last-seen"
  | "last-resolved"
  | "last-reported"
  | "cert-expires"
  | "expires";

export type PhaseKind =
  | "before-records"
  | "dormant"
  | "live"
  | "listed"
  | "quiet"
  | "paid-to"
  | "lapsed";

export interface TimelineEvent {
  kind: EventKind;
  /** ISO day, from the winning source. */
  at: string;
  source: string;
  also: { source: string; at: string }[];
  detail?: string;
  tone: "neutral" | "adverse" | "future";
}

export interface TimelineGap {
  after: EventKind;
  months: number;
}

export interface Phase {
  kind: PhaseKind;
  from: string;
  to: string;
  /** Still running as of `now`. */
  ongoing: boolean;
  /** The events that open and close it, for the ledger highlight. */
  edges: EventKind[];
}

export interface Timeline {
  now: string;
  events: TimelineEvent[];
  gaps: TimelineGap[];
  phases: Phase[];
  sourceCount: number;
}

export const EVENT_LABEL: Record<EventKind, string> = {
  registered: "Registered",
  "first-resolved": "First resolved",
  "cert-issued": "Cert issued",
  "first-seen": "First seen",
  listed: "Listed",
  "last-seen": "Last seen",
  "last-resolved": "Last resolved",
  "last-reported": "Last reported",
  "cert-expires": "Cert expires",
  expires: "Expires",
};

export const PHASE_LABEL: Record<PhaseKind, string> = {
  "before-records": "Before records",
  dormant: "Dormant",
  live: "Live",
  listed: "Listed",
  quiet: "Quiet",
  "paid-to": "Paid ahead",
  lapsed: "Lapsed",
};

/** Kind order, which is also the tie-break for two events on one day. */
const ORDER: EventKind[] = Object.keys(EVENT_LABEL) as EventKind[];

const LATEST_WINS = new Set<EventKind>([
  "last-seen",
  "last-resolved",
  "last-reported",
  "cert-expires",
  "expires",
]);

/** Sources whose malicious finding is a listing: a curated feed put the
 *  indicator on it on a date. A scanner's verdict (VirusTotal) is not. */
const LISTING_SOURCES = new Set(["feodo", "threatfox", "urlhaus", "malwarebazaar", "abuseipdb"]);

/** The `details` keys that carry a first-seen (see subject-record.ts). */
const FIRST_SEEN_KEYS = ["firstSeen", "feedFirstSeen"] as const;

type Kind = "ip" | "domain" | "hash";
type Candidate = { kind: EventKind; ms: number; source: string; detail?: string };

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** An expiry may sit years ahead, past `parseSeen`'s next-year cap. */
function parseExpiry(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || new Date(ms).getUTCFullYear() < 1990) return undefined;
  return ms;
}

function firstSeenOf(s: SourceResult): string | undefined {
  if (s.hashContext?.firstSeen) return s.hashContext.firstSeen;
  for (const key of FIRST_SEEN_KEYS) {
    const v = s.details?.[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function domainCandidates(s: SourceResult, push: (k: EventKind, ms?: number, d?: string) => void) {
  const ctx = s.domainContext;
  push("registered", parseSeen(ctx?.createdAt), ctx?.registrar && `via ${ctx.registrar}`);
  push("expires", parseExpiry(ctx?.expiresAt));
  for (const c of s.certificates ?? []) {
    push("cert-issued", parseSeen(c.firstSeen), c.issuer);
    push("cert-expires", parseExpiry(c.notAfter));
  }
}

function sourceCandidates(s: SourceResult, kind: Kind): Candidate[] {
  const out: Candidate[] = [];
  const push = (k: EventKind, ms?: number, detail?: string) => {
    if (ms !== undefined) out.push({ kind: k, ms, source: s.source.id, detail: detail || undefined });
  };

  if (kind === "domain") domainCandidates(s, push);
  if (kind !== "hash") {
    for (const p of s.passiveDns ?? []) {
      push("first-resolved", parseSeen(p.firstSeen), `to ${p.value}`);
      push("last-resolved", parseSeen(p.lastSeen), `to ${p.value}`);
    }
  }

  const first = parseSeen(firstSeenOf(s));
  const last = parseSeen(s.hashContext?.lastSeen ?? s.lastSeen);
  const listing = s.malicious === true && LISTING_SOURCES.has(s.source.id);
  const what = s.categories?.slice(0, 2).join(", ");

  if (kind === "hash") {
    push("first-seen", first);
    push("last-seen", last);
    if (listing) push("listed", first, what);
  } else if (listing) {
    push("listed", first, what);
    push("last-reported", last, what);
  } else {
    push("first-seen", first);
    push("last-seen", last);
  }
  return out;
}

function wins(kind: EventKind, a: Candidate, b: Candidate): boolean {
  return LATEST_WINS.has(kind) ? a.ms > b.ms : a.ms < b.ms;
}

function foldKind(kind: EventKind, candidates: Candidate[], nowMs: number): TimelineEvent {
  const perSource = new Map<string, Candidate>();
  for (const c of candidates) {
    const held = perSource.get(c.source);
    if (!held || wins(kind, c, held)) perSource.set(c.source, c);
  }
  const ranked = [...perSource.values()].sort(
    (a, b) => (wins(kind, a, b) ? -1 : 0) || (wins(kind, b, a) ? 1 : 0) || a.source.localeCompare(b.source),
  );
  const [winner, ...rest] = ranked;
  let tone: TimelineEvent["tone"] = "neutral";
  if (winner.ms > nowMs) tone = "future";
  else if (kind === "listed" || kind === "last-reported") tone = "adverse";
  return {
    kind,
    at: isoDay(winner.ms),
    source: winner.source,
    also: rest.map((c) => ({ source: c.source, at: isoDay(c.ms) })),
    detail: winner.detail,
    tone,
  };
}

/** Whole calendar months from one ISO day to a later one. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

const GAP_MONTHS = 6;

function findGaps(events: TimelineEvent[]): TimelineGap[] {
  const gaps: TimelineGap[] = [];
  for (let i = 1; i < events.length; i++) {
    const months = monthsBetween(events[i - 1].at, events[i].at);
    if (months >= GAP_MONTHS) gaps.push({ after: events[i - 1].kind, months });
  }
  return gaps;
}

function kindOf(result: AnyCheckResult): Kind {
  if (isHashResult(result)) return "hash";
  if (isDomainResult(result)) return "domain";
  return "ip";
}

export function buildTimeline(result: AnyCheckResult, now = new Date(result.checkedAt)): Timeline {
  const kind = kindOf(result);
  const nowMs = now.getTime();
  const candidates = result.sources
    .filter((s) => s.status === "ok")
    .flatMap((s) => sourceCandidates(s, kind));

  const events = ORDER.flatMap((k) => {
    const of = candidates.filter((c) => c.kind === k);
    return of.length ? [foldKind(k, of, nowMs)] : [];
  }).sort((a, b) => a.at.localeCompare(b.at) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  const sources = new Set(events.flatMap((e) => [e.source, ...e.also.map((a) => a.source)]));

  return {
    now: isoDay(nowMs),
    events,
    gaps: findGaps(events),
    phases: buildPhases(events, kind, nowMs),
    sourceCount: sources.size,
  };
}

/** Filled in by Task 3. */
function buildPhases(_events: TimelineEvent[], _kind: Kind, _nowMs: number): Phase[] {
  return [];
}
```

- [ ] **Step 4: Run the tests.** `bun run test lib/ti/timeline.test.ts`. Expected: PASS. (No phase test exists yet, and the empty-result test expects `phases: []`.)

- [ ] **Step 5: Lint.** `bun run lint`. Expected: clean. If `buildPhases`' unused parameters trip `@typescript-eslint/no-unused-vars`, it's short-lived: Task 3 replaces it in the next commit. Keep the leading underscores, which the config should ignore. If it doesn't, have the stub reference them with `void _events;` lines.

- [ ] **Step 6: Commit.**

```bash
git add lib/ti/timeline.ts lib/ti/timeline.test.ts
git commit -m "Timeline events: one row per kind, folded across sources"
```

---

### Task 3: Phases and phase spans

**Files:**
- Modify: `lib/ti/timeline.ts`
- Test: `lib/ti/timeline.test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: `Timeline.phases` filled, and `phaseSpan(from: string, to: string): string` exported.

- [ ] **Step 1: Write the failing tests.** Append to `lib/ti/timeline.test.ts`, and add `phaseSpan` to the import from `@/lib/ti/timeline`:

```ts
const phases = (r: Parameters<typeof buildTimeline>[0]) =>
  buildTimeline(r, NOW).phases.map((p) => [p.kind, p.from, p.to, p.ongoing]);

describe("buildTimeline phases", () => {
  it("draws a young domain as dormant, live, listed, paid ahead", () => {
    expect(phases(story())).toEqual([
      ["dormant", "2023-04-12", "2024-11-02", false],
      ["live", "2024-11-02", "2025-01-19", false],
      ["listed", "2025-01-19", "2026-10-04", true],
      ["paid-to", "2026-10-04", "2027-04-12", true],
    ]);
  });

  it("names the edges of each phase, for the ledger highlight", () => {
    const t = buildTimeline(story(), NOW);
    expect(t.phases.find((p) => p.kind === "dormant")?.edges).toEqual(["registered", "first-resolved"]);
  });

  it("refuses to call a pre-2018 domain dormant", () => {
    const old = domain([
      rdap("1997-09-15T00:00:00Z"),
      pdns(["142.250.0.1", "2009-06-01T00:00:00Z", "2026-10-01T00:00:00Z"]),
    ]);
    expect(phases(old)[0]).toEqual(["before-records", "1997-09-15", "2009-06-01", false]);
  });

  it("goes quiet 90 days after the last report", () => {
    const r = domain([
      rdap("2023-04-12T00:00:00Z"),
      pdns(["185.220.101.4", "2024-11-02T00:00:00Z", "2024-12-01T00:00:00Z"]),
      listing("threatfox", "2025-02-01 00:00:00 UTC", "2026-05-01 00:00:00 UTC", ["botnet_cc"]),
    ]);
    expect(phases(r).slice(-2)).toEqual([
      ["listed", "2025-02-01", "2026-05-01", false],
      ["quiet", "2026-05-01", "2026-10-04", true],
    ]);
  });

  it("ends the bar at a lapsed registration", () => {
    const r = domain([rdap("2023-04-12T00:00:00Z", "2026-01-01T00:00:00Z")]);
    expect(phases(r)).toEqual([["lapsed", "2026-01-01", "2026-10-04", false]]);
  });

  it("draws an IP from first seen, never from its netblock", () => {
    const r = ip([
      src({ id: "rdap-ip", domainContext: { createdAt: "1998-01-01T00:00:00Z" } }),
      listing("feodo", "2025-06-01 00:00:00", "2026-10-01 00:00:00", ["botnet-c2"]),
      src({ id: "dshield", details: { feedFirstSeen: "2025-03-01" }, lastSeen: "2026-09-28" }),
    ]);
    expect(phases(r)).toEqual([
      ["live", "2025-03-01", "2025-06-01", false],
      ["listed", "2025-06-01", "2026-10-04", true],
    ]);
  });

  it("skips a zero-length live phase when a hash was listed on the day it surfaced", () => {
    const r = hash([
      src({ id: "virustotal", hashContext: { firstSeen: "2025-02-07T09:00:00Z", lastSeen: "2026-03-01T00:00:00Z" } }),
      src({ id: "malwarebazaar", malicious: true, hashContext: { firstSeen: "2025-02-07 12:00:00" } }),
    ]);
    expect(phases(r)).toEqual([
      ["listed", "2025-02-07", "2026-03-01", false],
      ["quiet", "2026-03-01", "2026-10-04", true],
    ]);
  });

  it("keeps an unlisted hash live until its last sighting", () => {
    const r = hash([
      src({ id: "virustotal", hashContext: { firstSeen: "2026-08-01T00:00:00Z", lastSeen: "2026-09-20T00:00:00Z" } }),
    ]);
    expect(phases(r)).toEqual([["live", "2026-08-01", "2026-10-04", true]]);
  });
});

describe("phaseSpan", () => {
  it("speaks in days, then months, then years", () => {
    expect(phaseSpan("2026-09-20", "2026-10-04")).toBe("14 d");
    expect(phaseSpan("2023-04-12", "2024-11-02")).toBe("18 mo");
    expect(phaseSpan("1997-09-15", "2009-06-01")).toBe("11 yr");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** `bun run test lib/ti/timeline.test.ts`. Expected: the new phase cases FAIL (empty arrays), and `phaseSpan` isn't exported.

- [ ] **Step 3: Implement.** In `lib/ti/timeline.ts`, replace the `buildPhases` stub with:

```ts
const DAY_MS = 86_400_000;
/** CT enforcement in Chrome: from here a new name's first cert or resolution
 *  is seen almost at once, so a gap after registration means nobody used it.
 *  Before it, the gap only means nobody was watching. */
const DORMANT_FROM = Date.UTC(2018, 4, 1);
const QUIET_MS = 90 * DAY_MS;
const LIVE_STARTS: EventKind[] = ["first-resolved", "cert-issued", "first-seen", "listed"];

type PhaseDraft = Omit<Phase, "from" | "to"> & { from: number; to: number };

function buildPhases(events: TimelineEvent[], kind: Kind, nowMs: number): Phase[] {
  const at = (k: EventKind): number | undefined => {
    const e = events.find((x) => x.kind === k);
    return e ? Date.parse(`${e.at}T00:00:00Z`) : undefined;
  };
  const drafts: PhaseDraft[] = [];
  const add = (p: PhaseDraft) => {
    if (p.to > p.from) drafts.push(p);
  };

  const start = LIVE_STARTS.map((k) => ({ k, ms: at(k) }))
    .filter((s): s is { k: EventKind; ms: number } => s.ms !== undefined)
    .sort((a, b) => a.ms - b.ms)[0];

  const registered = kind === "domain" ? at("registered") : undefined;
  if (registered !== undefined && start) {
    add({
      kind: registered >= DORMANT_FROM ? "dormant" : "before-records",
      from: registered,
      to: start.ms,
      ongoing: false,
      edges: ["registered", start.k],
    });
  }

  addActivity(add, start, at, kind, nowMs);
  addRegistration(add, at("expires"), nowMs);

  return drafts.map((p) => ({ ...p, from: isoDay(p.from), to: isoDay(p.to) }));
}

/** Live, listed and quiet: the stretch the indicator was in use. */
function addActivity(
  add: (p: PhaseDraft) => void,
  start: { k: EventKind; ms: number } | undefined,
  at: (k: EventKind) => number | undefined,
  kind: Kind,
  nowMs: number,
) {
  const listed = at("listed");
  const lastKind: EventKind = kind === "hash" ? "last-seen" : "last-reported";
  const lastActive = at(lastKind);
  // An unlisted IP or domain has no dated end to its activity; a hash does.
  const activityEnd = listed !== undefined || kind === "hash" ? lastActive : undefined;
  const quiet = activityEnd !== undefined && nowMs - activityEnd >= QUIET_MS;
  const edge = quiet ? (activityEnd as number) : nowMs;
  const closing: EventKind[] = quiet ? [lastKind] : [];

  if (start && listed === undefined) {
    add({ kind: "live", from: start.ms, to: edge, ongoing: !quiet, edges: [start.k, ...closing] });
  } else if (start && listed !== undefined) {
    add({ kind: "live", from: start.ms, to: listed, ongoing: false, edges: [start.k, "listed"] });
  }
  if (listed !== undefined) {
    add({ kind: "listed", from: listed, to: edge, ongoing: !quiet, edges: ["listed", ...closing] });
  }
  if (quiet) {
    add({ kind: "quiet", from: activityEnd as number, to: nowMs, ongoing: true, edges: [lastKind] });
  }
}

/** Paid ahead, or lapsed: what the registration says about the future. */
function addRegistration(add: (p: PhaseDraft) => void, expires: number | undefined, nowMs: number) {
  if (expires === undefined) return;
  if (expires > nowMs) {
    add({ kind: "paid-to", from: nowMs, to: expires, ongoing: true, edges: ["expires"] });
  } else {
    add({ kind: "lapsed", from: expires, to: nowMs, ongoing: false, edges: ["expires"] });
  }
}

/** A phase's length as a fragment for its label: "14 d", "18 mo", "11 yr". */
export function phaseSpan(from: string, to: string): string {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
  if (days < 60) return `${days} d`;
  const months = monthsBetween(from, to);
  if (months < 24) return `${months} mo`;
  return `${Math.floor(months / 12)} yr`;
}
```

Check one detail against the "paid ahead" story test: `nowMs` is 12:00 UTC on 2026-10-04, so `isoDay(nowMs)` is `2026-10-04`. The listed phase's `to` is `edge = nowMs`, so it is also `2026-10-04`. Matches.

- [ ] **Step 4: Run the tests.** `bun run test lib/ti/timeline.test.ts`. Expected: PASS.

- [ ] **Step 5: Lint.** `bun run lint`. Expected: clean, with no function over cognitive complexity 15. If `buildPhases` or `addActivity` trips S3776, split the dormant block into its own `addPrelude` function, in the same style as `addRegistration`.

- [ ] **Step 6: Commit.**

```bash
git add lib/ti/timeline.ts lib/ti/timeline.test.ts
git commit -m "Timeline phases: dormant, live, listed, quiet, paid ahead"
```

---

### Task 4: Subject record can omit its dates

**Files:**
- Modify: `lib/ti/identity.ts:559-564`
- Modify: `components/CheckResults/identity.tsx` (`RecordTile`)
- Test: `lib/ti/identity.test.ts`

**Interfaces:**
- Produces: `buildIdentity(r: AnyResult, opts?: { omitDates?: boolean }): IdentityRecord` and `RecordTile({ result, omitDates? })`.

- [ ] **Step 1: Write the failing test.** In `lib/ti/identity.test.ts`, inside `describe("domains", ...)`, after the "fills the fixed list" case:

```ts
  it("leaves the dates to the timeline when asked", () => {
    const r = domain({
      registrar: "Example Registrar",
      createdAt: "2015-03-04T00:00:00Z",
      expiresAt: "2028-03-04T00:00:00Z",
    });
    const rec = buildIdentity(r, { omitDates: true });
    expect(find(rec, "created")).toBeUndefined();
    expect(find(rec, "expires")).toBeUndefined();
    expect(find(rec, "registrar")?.value).toBe("Example Registrar");
    expect(rec.fields.length).toBe(buildIdentity(r).fields.length - 2);
  });
```

Inside the hash `describe` block (the one asserting `find(rec, "first")` near line 495), add:

```ts
  it("leaves first and last seen to the timeline when asked", () => {
    const rec = buildIdentity(
      hash({ firstSeen: "2006-05-22T00:00:00Z", lastSeen: "2026-01-01T00:00:00Z" }),
      { omitDates: true },
    );
    expect(find(rec, "first")).toBeUndefined();
    expect(find(rec, "last")).toBeUndefined();
  });
```

`hash(ctx?: HashContext, sources?)` and `domain(ctx?: DomainContext, opts?)` are the file's existing fixture builders (lines 42 and 55).

- [ ] **Step 2: Run them and confirm they fail.** `bun run test lib/ti/identity.test.ts`. Expected: FAIL, the fields are still present.

- [ ] **Step 3: Implement.** Replace `buildIdentity` in `lib/ti/identity.ts` with:

```ts
/** Rows the timeline tile owns on `/check`. The active-scan page has no
 *  timeline, so it keeps them. */
const DATE_FIELDS = new Set(["created", "expires", "first", "last"]);

export function buildIdentity(
  r: AnyResult,
  opts: { omitDates?: boolean } = {},
): IdentityRecord {
  const rec = identityOf(r);
  return opts.omitDates
    ? { ...rec, fields: rec.fields.filter((f) => !DATE_FIELDS.has(f.key)) }
    : rec;
}

function identityOf(r: AnyResult): IdentityRecord {
  const kind = buildSubjectRecord(r).class.label;
  if (isHashResult(r)) return { kind, vitals: hashVitals(r), fields: hashFields(r) };
  if (isDomainResult(r)) return { kind, vitals: domainVitals(r), fields: domainFields(r) };
  return { kind, vitals: ipVitals(r), fields: ipFields(r) };
}
```

In `components/CheckResults/identity.tsx`, change `RecordTile` to:

```tsx
export const RecordTile = memo(function RecordTile({
    result,
    omitDates = false,
}: Readonly<{ result: AnyCheckResult; omitDates?: boolean }>) {
    const identity = useMemo(() => buildIdentity(result, { omitDates }), [result, omitDates]);
```

The rest of the body stays the same. `placement(i, identity.fields.length)` already rebalances the two columns for any count.

- [ ] **Step 4: Run the tests.** `bun run test lib/ti/identity.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/ti/identity.ts lib/ti/identity.test.ts components/CheckResults/identity.tsx
git commit -m "Subject record can hand its dates to the timeline"
```

---

### Task 5: The Timeline tile on `/check`

**Files:**
- Create: `components/CheckResults/timeline.tsx`
- Modify: `components/CheckResults/index.tsx` (three result views)
- Modify: `components/CheckResults/pending.tsx` (skeleton before "Subject record")

**Interfaces:**
- Consumes: `buildTimeline`, `phaseSpan`, `EVENT_LABEL`, `PHASE_LABEL`, and the types from `lib/ti/timeline.ts`. `Tile` from `./frame`. `RecordTile`'s `omitDates`.
- Produces: `TimelineTile({ result })`.

- [ ] **Step 1: Create `components/CheckResults/timeline.tsx`.**

```tsx
"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    buildTimeline,
    EVENT_LABEL,
    PHASE_LABEL,
    phaseSpan,
    type EventKind,
    type Phase,
    type PhaseKind,
    type Timeline,
    type TimelineEvent,
} from "@/lib/ti/timeline";
import type { AnyCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Tile } from "./frame";

/**
 * The indicator's life, as a phase strip over a dated ledger.
 *
 * The strip is the shape (sat unused, went live, got listed, still reported)
 * and the ledger is the detail. The strip is decorative to a screen reader:
 * every phase edge is a ledger row, so nothing lives only in the picture.
 * It is a section of the panel's frame, directly above the record, which no
 * longer carries any dates of its own.
 */
export const TimelineTile = memo(function TimelineTile({
    result,
}: Readonly<{ result: AnyCheckResult }>) {
    const timeline = useMemo(() => buildTimeline(result), [result]);
    const [lit, setLit] = useState<readonly EventKind[]>([]);
    const { events, sourceCount } = timeline;
    return (
        <Tile
            span={12}
            id="timeline"
            title="Timeline"
            note={events.length > 0 ? `${plural(events.length, "event")} · ${plural(sourceCount, "source")}` : undefined}
        >
            {events.length === 0 ? (
                <p className="font-mono text-xs text-muted-foreground">No source has dated this indicator</p>
            ) : (
                <>
                    {timeline.phases.length > 0 && <PhaseStrip timeline={timeline} onHover={setLit} />}
                    <Ledger timeline={timeline} lit={lit} />
                </>
            )}
        </Tile>
    );
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

const PHASE_STYLE: Record<PhaseKind, string> = {
    "before-records": "top-[24px] h-px bg-muted-foreground/60",
    dormant:
        "top-[18px] h-3.5 border border-muted-foreground/50 bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--color-muted-foreground)_3px_4px)] opacity-60",
    live: "top-[18px] h-3.5 bg-muted-foreground/60",
    listed: "top-[18px] h-3.5 bg-red-600 dark:bg-red-400",
    quiet: "top-[18px] h-3.5 border border-muted-foreground/50",
    "paid-to": "top-[18px] h-3.5 border border-dashed border-muted-foreground",
    lapsed: "top-[18px] h-3.5 border-l-2 border-muted-foreground/40",
};

function PhaseStrip({
    timeline,
    onHover,
}: Readonly<{ timeline: Timeline; onHover: (edges: readonly EventKind[]) => void }>) {
    const { events, phases, now } = timeline;
    const start = Math.min(...events.map((e) => dayMs(e.at)), ...phases.map((p) => dayMs(p.from)));
    const end = Math.max(dayMs(now), ...events.map((e) => dayMs(e.at)));
    const span = Math.max(end - start, 86_400_000);
    const pct = (ms: number) => ((ms - start) / span) * 100;
    const years: number[] = [];
    for (let y = new Date(start).getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= end; y++) years.push(y);
    const todayAt = pct(dayMs(now));

    return (
        <div className="relative mb-2 h-14" aria-hidden="true">
            {phases.map((p) => (
                <Segment
                    key={p.kind}
                    phase={p}
                    left={pct(dayMs(p.from))}
                    width={pct(dayMs(p.to)) - pct(dayMs(p.from))}
                    onHover={onHover}
                />
            ))}
            {years.map((y) => (
                <div key={y} className="absolute top-[34px]" style={{ left: `${pct(Date.UTC(y, 0, 1))}%` }}>
                    <span className="block h-1 w-px bg-muted-foreground/60" />
                    <span className="absolute top-1.5 -translate-x-1/2 font-mono text-[9px] text-muted-foreground">
                        {y}
                    </span>
                </div>
            ))}
            <div className="absolute top-2 h-8 border-l border-dashed border-foreground" style={{ left: `${todayAt}%` }}>
                <span
                    className={cn(
                        "absolute -top-2 font-mono text-[8.5px] tracking-[0.1em]",
                        todayAt > 90 ? "right-1" : "left-1",
                    )}
                >
                    TODAY
                </span>
            </div>
        </div>
    );
}

function Segment({
    phase,
    left,
    width,
    onHover,
}: Readonly<{
    phase: Phase;
    left: number;
    width: number;
    onHover: (edges: readonly EventKind[]) => void;
}>) {
    const label = phase.kind === "lapsed" ? PHASE_LABEL.lapsed : `${PHASE_LABEL[phase.kind]} ${phaseSpan(phase.from, phase.to)}`;
    return (
        <div
            className="absolute inset-y-0"
            style={{ left: `${left}%`, width: `${width}%` }}
            title={`${label}, ${phase.from} to ${phase.to}`}
            onMouseEnter={() => onHover(phase.edges)}
            onMouseLeave={() => onHover([])}
        >
            <FitLabel text={label} adverse={phase.kind === "listed"} />
            <div className={cn("absolute inset-x-0", PHASE_STYLE[phase.kind])} />
        </div>
    );
}

/** A phase name that shows only when it fits its segment, so two labels can
 *  never overlap; a hidden one is still in the segment's tooltip. */
function FitLabel({ text, adverse }: Readonly<{ text: string; adverse: boolean }>) {
    const ref = useRef<HTMLSpanElement>(null);
    const [fits, setFits] = useState(true);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const check = () => setFits(el.scrollWidth <= el.clientWidth);
        check();
        const observer = new ResizeObserver(check);
        observer.observe(el);
        return () => observer.disconnect();
    }, [text]);
    return (
        <span
            ref={ref}
            className={cn(
                "absolute inset-x-0 top-0.5 overflow-hidden whitespace-nowrap pr-1 font-mono text-[9px] tracking-[0.06em] uppercase",
                adverse ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                !fits && "invisible",
            )}
        >
            {text}
        </span>
    );
}

function Ledger({ timeline, lit }: Readonly<{ timeline: Timeline; lit: readonly EventKind[] }>) {
    const gapAfter = new Map(timeline.gaps.map((g) => [g.after, g.months]));
    const rows: React.ReactNode[] = [];
    let year = "";
    for (const e of timeline.events) {
        const y = e.at.slice(0, 4);
        if (y !== year) {
            year = y;
            rows.push(
                <li key={`y${y}`} className="col-span-4 pt-3 pb-0.5 font-mono text-[10px] tracking-[0.1em] text-muted-foreground">
                    {y}
                </li>,
            );
        }
        rows.push(<Row key={e.kind} event={e} lit={lit.includes(e.kind)} />);
        const months = gapAfter.get(e.kind);
        if (months) {
            rows.push(
                <li key={`g${e.kind}`} className="col-span-4 py-1 pl-[calc(3.5rem+14px+1.5rem)] font-mono text-[10px] italic text-muted-foreground">
                    · {months} months quiet ·
                </li>,
            );
        }
    }
    return <ol className="grid list-none grid-cols-[3.5rem_14px_1fr_auto] gap-x-3">{rows}</ol>;
}

const DOT: Record<TimelineEvent["tone"], string> = {
    neutral: "border-foreground bg-foreground",
    adverse: "border-red-600 bg-red-600 dark:border-red-400 dark:bg-red-400",
    future: "border-dashed border-muted-foreground bg-card",
};

function Row({ event, lit }: Readonly<{ event: TimelineEvent; lit: boolean }>) {
    const cell = cn("border-b border-foreground/8 py-1.5", lit && "bg-muted/60");
    const also = event.also.map((a) => `${a.source} ${a.at}`).join("\n");
    return (
        <li className={cn("contents", event.tone === "future" && "text-muted-foreground")}>
            <span className={cn(cell, "font-mono text-xs text-muted-foreground")}>{event.at.slice(5)}</span>
            <span className={cn(cell, "relative flex justify-center")}>
                <span className="absolute inset-y-0 left-1/2 border-l border-foreground/15" />
                <span className={cn("relative mt-1 size-[7px] rounded-full border", DOT[event.tone])} />
            </span>
            <span className={cn(cell, "text-sm")}>
                <b className={cn("font-semibold", event.tone === "adverse" && "text-red-600 dark:text-red-400")}>
                    {EVENT_LABEL[event.kind]}
                </b>
                {event.detail && <span className="text-muted-foreground"> {event.detail}</span>}
            </span>
            <span className={cn(cell, "text-right font-mono text-[10px] text-muted-foreground")} title={also || undefined}>
                {event.source}
                {event.also.length > 0 && ` +${event.also.length}`}
            </span>
        </li>
    );
}
```

- [ ] **Step 2: Wire it into all three views.** In `components/CheckResults/index.tsx`, add `import { TimelineTile } from "./timeline";` next to the `./identity` import. In each of `Results`, `DomainResults` and `HashResults`, replace

```tsx
                    <RecordTile result={result} />
```

with

```tsx
                    <TimelineTile result={result} />
                    <RecordTile result={result} omitDates />
```

There are three occurrences. Replace all of them, and confirm with `grep -n "TimelineTile" components/CheckResults/index.tsx`, which should print 4 lines (1 import + 3 uses).

- [ ] **Step 3: Add the skeleton.** In `components/CheckResults/pending.tsx`, directly above `<Tile span={12} title="Subject record">`, insert:

```tsx
            <Tile span={12} title="Timeline">
                <span className="sweep mb-5 block h-3.5 w-full rounded" />
                {["w-1/2", "w-2/3", "w-2/5", "w-3/5"].map((w, i) => (
                    <div key={`${w}-${i}`} className="py-1.5">
                        <span className={cn("sweep block h-3 rounded", w)} />
                    </div>
                ))}
            </Tile>
```

- [ ] **Step 4: Static checks.** Run `bun run typecheck && bun run lint && bun run test`. Expected: all pass. If lint flags `Ledger` for cognitive complexity, move the gap `<li>` into a `GapRow` component.

- [ ] **Step 5: Verify in the browser.** Follow `memory: ui-screenshots-behind-auth` to mint a session cookie, build, and serve on :3001 (never touch the user's :3000):

```bash
bun run build
AUTH_TRUST_HOST=true bun run start -- -p 3001
```

At 1280px, screenshot `/check/<ioc>` for three indicators: a data-rich malicious hash (from MalwareBazaar's recent feed), a listed domain (from URLhaus's recent feed), and an old clean domain (`google.com`). Check that:
- the strip's phases line up with the ledger rows, and hovering a segment highlights its edge rows
- `google.com` starts with `Before records`, not `Dormant`
- no phase labels overlap, and short phases are unlabelled
- Subject record shows no `Registered` / `Paid to` / `First seen` / `Last seen` rows
- the skeleton has a Timeline band, and nothing jumps when the result lands
- both themes look right

If anything can't be verified, say so explicitly in the handoff.

- [ ] **Step 6: Commit.**

```bash
git add components/CheckResults/timeline.tsx components/CheckResults/index.tsx components/CheckResults/pending.tsx
git commit -m "Timeline tile above Subject record: phase strip over a dated ledger"
```

---

### Task 6: Final verification

- [ ] **Step 1:** `bun run typecheck && bun run lint && bun run test && bun run build`. Expected: all pass. Paste the tail of each.
- [ ] **Step 2:** `bun run coverage` and confirm `lib/ti/timeline.ts` is ≥ 80% line coverage (the Sonar new-code gate).
- [ ] **Step 3:** Stop the :3001 server you started (by its PID, never a broad `pkill`).
- [ ] **Step 4:** Report back with the screenshots. Do not open a PR without asking.
