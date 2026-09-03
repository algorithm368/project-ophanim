# Subject Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three per-type identity cards with one "Subject record" card carrying a 16x16 pixel sprite in the top right and rows saying what the indicator is, what it is hosted on, and what it was reported for, each with its provenance.

**Architecture:** Two pure `lib/` modules do all the thinking. `lib/ti/sprite.ts` turns ASCII grids into SVG rects and composites a base body, an optional provider mark and a horns overlay in the grid domain. `lib/ti/subject-record.ts` runs two independent resolver ladders (`infra`, `threat`) over the `SourceResult[]` already in the result, plus the existing `threatTypeOf` with identification sources filtered out for the behaviour axis. Two components render them. No source adapter, no scoring, no cache schema is touched.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Vitest, Tailwind, Bun as the package manager and script runner.

**Spec:** `docs/superpowers/specs/2026-09-03-subject-record-design.md`

## Global Constraints

- Run `bun run test`, never `bun test`. The latter invokes Bun's own runner, which does not understand the Vitest API.
- Tests are colocated: `lib/**/*.test.ts`, imported through the `@/` alias. Pure, no network.
- Sonar's `new_coverage` gate requires 80% on changed lines. Every new `lib/` file needs tests in the same commit.
- `sonarjs/cognitive-complexity` (S3776) is an **error** at 15, and `no-nested-ternary` (S3358) is an **error**, both scoped to `app/`, `components/`, `lib/`. Keep functions small.
- User-facing copy uses commas, never an em dash, en dash, or " - " as a separator.
- A rung the sprite depends on must be a source with `requiresKey: false` and no quota. Key-gated sources may only refine label text.
- `bun run lint` and `bun run typecheck` must pass before every commit. `.githooks/pre-commit` autofixes and re-stages, then lints.
- Do not commit `next-env.d.ts` churn separately; `next dev` rewrites it and `AGENTS.md`.

---

### Task 1: `cloudProvider` reports how it matched

The sprite may only put a named provider mark on a fact, never on an inference. `cloud.ts` resolves a provider from an ASN table (a fact: AS16509 is Amazon) or from a regex over the ASN org name (an inference the file already carries a scar from: `jAWSon`, `strAWSon`, `hAWSley`). The caller currently cannot tell which happened.

**Files:**
- Modify: `lib/ti/cloud.ts:41-76`
- Test: `lib/ti/cloud.test.ts` (create if absent, otherwise append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `cloudProvider(asn?: string, org?: string): { name: string; via: "asn" | "org" } | undefined`. Task 7 reads `via`.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/cloud.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cloudProvider } from "@/lib/ti/cloud";

describe("cloudProvider provenance", () => {
  it("reports an ASN table hit as a fact", () => {
    expect(cloudProvider("AS16509", "AMAZON-02")).toEqual({
      name: "Amazon Web Services",
      via: "asn",
    });
  });

  it("reports an org name hit as an inference", () => {
    // No ASN, so only the org regex can match.
    expect(cloudProvider(undefined, "Hetzner Online GmbH")).toEqual({
      name: "Hetzner",
      via: "org",
    });
  });

  it("prefers the ASN table when both could match", () => {
    // AS8075 is in the table; the org string would also hit /microsoft|azure/.
    expect(cloudProvider("AS8075 MICROSOFT-CORP-MSN-AS-BLOCK", "Microsoft")).toEqual({
      name: "Microsoft Azure",
      via: "asn",
    });
  });

  it("still returns undefined for an unrecognised network", () => {
    expect(cloudProvider("AS64500", "Example University")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/ti/cloud.test.ts`
Expected: FAIL, the returned objects have no `via` key.

- [ ] **Step 3: Write minimal implementation**

In `lib/ti/cloud.ts`, change the return type and both return sites:

```ts
/**
 * Identify the cloud/hosting provider behind an IP from its ASN (preferred) or
 * ASN org name. Returns undefined when it is not a recognized provider.
 *
 * `via` says which path matched, and callers that put a provider's name in
 * front of a user must check it. The ASN table is a fact; the org regex is an
 * inference, and the comment on CLOUD_BY_ORG records what a bad inference
 * looks like.
 */
export function cloudProvider(
  asn?: string,
  org?: string,
): { name: string; via: "asn" | "org" } | undefined {
  if (asn) {
    const canon = canonicalAsn(asn);
    const n = canon ? Number(canon.slice(2)) : Number.NaN;
    if (Number.isFinite(n) && CLOUD_BY_ASN[n]) {
      return { name: CLOUD_BY_ASN[n], via: "asn" };
    }
  }
  if (org) {
    for (const [re, name] of CLOUD_BY_ORG) {
      if (re.test(org)) return { name, via: "org" };
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `bun run test lib/ti/cloud.test.ts && bun run typecheck`
Expected: PASS. The two existing callers (`lib/ti/ip-dossier.ts:89`, `lib/ti/url/shared-host.ts:24`) only read `.name`, so they compile unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/cloud.ts lib/ti/cloud.test.ts
git commit -m "feat(ti): cloudProvider says whether it matched an ASN or guessed from an org name"
```

---

### Task 2: Move the indicator class labels into `lib/`

`classifyType`, `classifyDomain` and `classifyHash` live in `components/CheckResults/classify.ts` and return a lucide icon alongside the label, so `lib/` cannot import them. The record needs the labels as a last-resort rung. Split the data from the icons rather than writing a second copy: the labels also move inside `lib/`, which is what `vitest.config.ts` scopes coverage to.

**Files:**
- Create: `lib/ti/indicator-class.ts`
- Create: `lib/ti/indicator-class.test.ts`
- Modify: `components/CheckResults/classify.ts:25-140`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type IndicatorClass = { label: string; desc: string }`
  - `classifyIpLabel(geo?: GeoContext): IndicatorClass`
  - `classifyDomainLabel(ctx?: DomainContext, resolves?: boolean): IndicatorClass`
  - `classifyHashLabel(ctx: HashContext | undefined, hasData: boolean): IndicatorClass`

  Tasks 7 and 9 call these.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/indicator-class.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyDomainLabel,
  classifyHashLabel,
  classifyIpLabel,
} from "@/lib/ti/indicator-class";

describe("classifyIpLabel", () => {
  it("reads the proxy flag before the hosting flag", () => {
    // A VPN endpoint in a datacentre sets both; "Anonymizer" is the more
    // specific claim and the one an analyst acts on.
    expect(classifyIpLabel({ isProxy: true, isHosting: true }).label).toBe(
      "Anonymizer",
    );
  });

  it("names hosting, mobile and residential from the geo flags", () => {
    expect(classifyIpLabel({ isHosting: true }).label).toBe("Hosting / Datacenter");
    expect(classifyIpLabel({ isMobile: true }).label).toBe("Mobile network");
    expect(classifyIpLabel({ country: "Thailand" }).label).toBe("Residential / Other");
  });

  it("says so when there is no geo context at all", () => {
    expect(classifyIpLabel(undefined).label).toBe("Unknown type");
  });
});

describe("classifyDomainLabel", () => {
  it("calls a domain under 30 days newly registered", () => {
    expect(classifyDomainLabel({ ageDays: 3 }, true).label).toBe("Newly registered");
  });

  it("calls a non-resolving domain parked", () => {
    expect(classifyDomainLabel({ ageDays: 4000 }, false).label).toBe("Inactive / parked");
  });

  it("calls a resolving, aged domain established", () => {
    const c = classifyDomainLabel({ ageDays: 4000 }, true);
    expect(c.label).toBe("Established");
    expect(c.desc).toContain("year");
  });

  it("falls back to Domain when the age is unknown", () => {
    expect(classifyDomainLabel({}, true).label).toBe("Domain");
  });
});

describe("classifyHashLabel", () => {
  it("prefers the malware family over the file type", () => {
    expect(classifyHashLabel({ malwareFamily: "Emotet", fileType: "exe" }, true).label).toBe(
      "Emotet",
    );
  });

  it("falls back to the file type, then to Unknown file", () => {
    expect(classifyHashLabel({ fileType: "PDF document" }, true).label).toBe("PDF document");
    expect(classifyHashLabel(undefined, false).label).toBe("Unknown file");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/ti/indicator-class.test.ts`
Expected: FAIL, cannot resolve `@/lib/ti/indicator-class`.

- [ ] **Step 3: Create the module**

Create `lib/ti/indicator-class.ts` by moving the label and desc strings out of `components/CheckResults/classify.ts` verbatim. The icons stay behind.

```ts
import type { DomainContext, GeoContext, HashContext } from "./types";

/** What an indicator is, in one short label plus a sentence of why. The icon
 *  that used to travel with these lives in components/CheckResults/classify.ts,
 *  which now wraps these functions. Splitting them is what lets lib/ and the
 *  coverage scope reach the labels. */
export type IndicatorClass = { label: string; desc: string };

/** Classify an IP from the geo provider flags. */
export function classifyIpLabel(geo?: GeoContext): IndicatorClass {
  if (!geo) {
    return { label: "Unknown type", desc: "No network classification available." };
  }
  if (geo.isProxy) {
    return { label: "Anonymizer", desc: "Proxy, VPN, or Tor; the real user is hidden." };
  }
  if (geo.isHosting) {
    return {
      label: "Hosting / Datacenter",
      desc: "Server or cloud infrastructure, not a home user.",
    };
  }
  if (geo.isMobile) {
    return { label: "Mobile network", desc: "A mobile carrier (cellular) address." };
  }
  return {
    label: "Residential / Other",
    desc: "Likely a home or business end-user network.",
  };
}

/** Classify a domain from its registration age and whether it resolves. */
export function classifyDomainLabel(
  ctx?: DomainContext,
  resolves?: boolean,
): IndicatorClass {
  if (ctx?.ageDays !== undefined && ctx.ageDays < 30) {
    return {
      label: "Newly registered",
      desc: `Created ${ctx.ageDays} day(s) ago; young domains skew higher-risk.`,
    };
  }
  if (resolves === false) {
    return { label: "Inactive / parked", desc: "Doesn't currently resolve to an address." };
  }
  if (ctx?.ageDays !== undefined) {
    const years = Math.floor(ctx.ageDays / 365);
    return {
      label: "Established",
      desc:
        years >= 1
          ? `Registered ${years}+ year(s) ago.`
          : "Registered under a year ago.",
    };
  }
  return { label: "Domain", desc: "Registration age unknown." };
}

/** Classify a file from its known malware family, file type, or lack thereof. */
export function classifyHashLabel(
  ctx: HashContext | undefined,
  hasData: boolean,
): IndicatorClass {
  if (ctx?.malwareFamily) {
    return {
      label: ctx.malwareFamily,
      desc: `Identified as ${ctx.malwareFamily}${ctx.fileType ? ` (${ctx.fileType})` : ""}.`,
    };
  }
  if (ctx?.fileType) {
    return {
      label: ctx.fileType,
      desc: ctx.fileName
        ? `Seen as "${ctx.fileName}".`
        : "Known file, no malware family attributed.",
    };
  }
  if (!hasData) {
    return {
      label: "Unknown file",
      desc: "No threat-intel source has this file on record.",
    };
  }
  return { label: "File", desc: "No file metadata was returned." };
}
```

- [ ] **Step 4: Rewrite `classify.ts` to wrap them**

In `components/CheckResults/classify.ts`, replace the bodies of `classifyType`, `classifyDomain` and `classifyHash` with icon lookups over the label. Keep the exported signatures exactly as they are, so `profile.tsx` and `dossier.tsx` compile unchanged.

```ts
import {
    classifyDomainLabel,
    classifyHashLabel,
    classifyIpLabel,
} from "@/lib/ti/indicator-class";

/** The icon each label carries. Kept here rather than in lib/ because lucide is
 *  a component-layer dependency and the labels are not. */
const IP_ICON: Record<string, IconType> = {
    "Unknown type": ShieldQuestion,
    Anonymizer: ShieldAlert,
    "Hosting / Datacenter": Server,
    "Mobile network": Smartphone,
    "Residential / Other": Network,
};

export function classifyType(geo?: GeoContext): {
    label: string;
    desc: string;
    icon: IconType;
} {
    const c = classifyIpLabel(geo);
    return { ...c, icon: IP_ICON[c.label] ?? ShieldQuestion };
}

const DOMAIN_ICON: Record<string, IconType> = {
    "Newly registered": Sparkles,
    "Inactive / parked": ShieldQuestion,
    Established: ShieldCheck,
    Domain: Globe,
};

export function classifyDomain(
    ctx?: DomainContext,
    resolves?: boolean,
): { label: string; desc: string; icon: IconType } {
    const c = classifyDomainLabel(ctx, resolves);
    return { ...c, icon: DOMAIN_ICON[c.label] ?? Globe };
}

export function classifyHash(
    ctx: HashContext | undefined,
    hasData: boolean,
): { label: string; desc: string; icon: IconType } {
    const c = classifyHashLabel(ctx, hasData);
    // The hash label is the malware family or file type itself, so it cannot be
    // a table key. Pick the icon from which branch produced it.
    if (ctx?.malwareFamily) return { ...c, icon: Bug };
    if (ctx?.fileType) return { ...c, icon: FileText };
    return { ...c, icon: FileDigit };
}
```

- [ ] **Step 5: Run the full suite, typecheck and lint**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS. If any lucide import in `classify.ts` is now unused, delete it; lint will say which.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/indicator-class.ts lib/ti/indicator-class.test.ts components/CheckResults/classify.ts
git commit -m "refactor(ti): move the indicator class labels into lib, leaving the icons in the component layer"
```

---

### Task 3: `lib/ti/sprite.ts`, ASCII grids to SVG rects

Pure geometry. No React, no colour, no knowledge of indicators. Composition happens on the grid so a test can assert exactly which cells changed; the conversion to rects happens once at the end.

**Files:**
- Create: `lib/ti/sprite.ts`
- Create: `lib/ti/sprite.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type BodyKey = "hosting" | "scanner" | "c2" | "anonymizer" | "site" | "file"`
  - `type MarkKey = "aws" | "azure" | "gcp" | "cloudflare"`
  - `type SpriteSpec = { body: BodyKey; mark?: MarkKey; flagged: boolean }`
  - `type Rect = { x: number; y: number; w: number }`
  - `SPRITE_SIZE = 16`
  - `parseGrid(ascii: string): string[]`
  - `composeGrid(spec: SpriteSpec): string[]`
  - `toRects(grid: string[]): Rect[]`
  - `spriteRects(spec: SpriteSpec): Rect[]`
  - `BODY_KEYS: readonly BodyKey[]`, `MARK_KEYS: readonly MarkKey[]`

  Tasks 4, 5, 9 and 11 use these.

  Note: this refines the spec's flat `SpriteKey`. The spec listed the four
  provider keys in the same union with a caveat that they are never standalone.
  Splitting `BodyKey` from `MarkKey` makes that a type error instead of a
  caveat, which is strictly better and changes nothing else.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/sprite.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BODY_KEYS,
  MARK_KEYS,
  SPRITE_SIZE,
  composeGrid,
  parseGrid,
  spriteRects,
  toRects,
  type Rect,
} from "@/lib/ti/sprite";

/** Paint rects back onto a blank grid, so a round trip can be compared as art
 *  rather than as coordinates. */
function rectsToGrid(rects: Rect[], size = SPRITE_SIZE): string[] {
  const rows = Array.from({ length: size }, () => Array.from({ length: size }, () => "."));
  for (const r of rects) {
    for (let i = 0; i < r.w; i++) rows[r.y][r.x + i] = "#";
  }
  return rows.map((r) => r.join(""));
}

describe("parseGrid", () => {
  it("strips indentation and blank framing lines", () => {
    const g = parseGrid(`
      ##
      .#
    `);
    expect(g).toEqual(["##", ".#"]);
  });

  it("rejects a row containing anything but # and .", () => {
    expect(() => parseGrid("#X")).toThrow(/only/i);
  });
});

describe("every drawn grid", () => {
  it.each(BODY_KEYS)("%s is 16 by 16", (key) => {
    const g = composeGrid({ body: key, flagged: false });
    expect(g).toHaveLength(SPRITE_SIZE);
    for (const row of g) {
      expect(row).toHaveLength(SPRITE_SIZE);
      expect(row).toMatch(/^[#.]+$/);
    }
  });

  it.each(MARK_KEYS)("%s composites into hosting without leaving the well", (mark) => {
    const plain = composeGrid({ body: "hosting", flagged: false });
    const marked = composeGrid({ body: "hosting", mark, flagged: false });
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        const inWell = y >= 8 && y <= 10 && x >= 5 && x <= 10;
        if (!inWell) expect(marked[y][x]).toBe(plain[y][x]);
      }
    }
  });
});

describe("the horns overlay", () => {
  it("adds pixels and never removes them", () => {
    const plain = composeGrid({ body: "scanner", flagged: false });
    const horned = composeGrid({ body: "scanner", flagged: true });
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        if (plain[y][x] === "#") expect(horned[y][x]).toBe("#");
      }
    }
    expect(horned.join("")).not.toBe(plain.join(""));
  });

  it("only touches the top two rows", () => {
    const plain = composeGrid({ body: "file", flagged: false });
    const horned = composeGrid({ body: "file", flagged: true });
    expect(horned.slice(2)).toEqual(plain.slice(2));
  });
});

describe("toRects", () => {
  it("merges each horizontal run into one rect", () => {
    expect(toRects(["..###.", "######"])).toEqual([
      { x: 2, y: 0, w: 3 },
      { x: 0, y: 1, w: 6 },
    ]);
  });

  it("emits nothing for an empty grid", () => {
    expect(toRects(["....", "...."])).toEqual([]);
  });

  it.each(BODY_KEYS)("round-trips %s to the same drawing", (key) => {
    const grid = composeGrid({ body: key, flagged: true });
    expect(rectsToGrid(toRects(grid))).toEqual(grid);
  });
});

describe("spriteRects", () => {
  it("is the composition and the conversion in one call", () => {
    const spec = { body: "hosting", mark: "aws", flagged: true } as const;
    expect(spriteRects(spec)).toEqual(toRects(composeGrid(spec)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/ti/sprite.test.ts`
Expected: FAIL, cannot resolve `@/lib/ti/sprite`.

- [ ] **Step 3: Write the module**

Create `lib/ti/sprite.ts`. The grids below are **first drafts**: they fix the size and the visual language, and Tasks 4 and 5 judge and revise them against a rendered contact sheet. A terminal character cell is taller than it is wide, so nothing here can be judged as text.

```ts
/**
 * 1-bit sprites, 16x16, stored as ASCII in source.
 *
 * A hex-per-row encoding would be four times smaller and completely
 * unreviewable: a one-character diff in hex is a change nobody can evaluate.
 * ASCII is editable in any editor with no tooling, and `git diff` shows what
 * actually changed about the drawing. The whole set is a couple of kilobytes of
 * text that gzips extremely well.
 *
 * Composition happens here, on the grid, and the conversion to rectangles
 * happens once at the end. Stacking three SVGs instead would render the same
 * picture but make "did the mark stay inside its well" untestable.
 */

export const SPRITE_SIZE = 16;

/** The 6x3 region a provider mark occupies, inside the hosting body's chest. */
const MARK_X = 5;
const MARK_Y = 8;
const MARK_W = 6;
const MARK_H = 3;

export type BodyKey = "hosting" | "scanner" | "c2" | "anonymizer" | "site" | "file";
export type MarkKey = "aws" | "azure" | "gcp" | "cloudflare";
export type SpriteSpec = { body: BodyKey; mark?: MarkKey; flagged: boolean };
export type Rect = { x: number; y: number; w: number };

export const BODY_KEYS = [
  "hosting",
  "scanner",
  "c2",
  "anonymizer",
  "site",
  "file",
] as const satisfies readonly BodyKey[];

export const MARK_KEYS = [
  "aws",
  "azure",
  "gcp",
  "cloudflare",
] as const satisfies readonly MarkKey[];

/** Turn indented ASCII art into rows, rejecting anything that is not 1-bit. */
export function parseGrid(ascii: string): string[] {
  const rows = ascii
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  for (const row of rows) {
    if (!/^[#.]+$/.test(row)) {
      throw new Error(`sprite rows may contain only # and . , got "${row}"`);
    }
  }
  return rows;
}

const BODIES: Record<BodyKey, string[]> = {
  // A rack with two eyes. Rows 8 to 10, columns 5 to 10, are the mark well,
  // filled here with a plain bar. Every provider substitutes that bar.
  hosting: parseGrid(`
    ................
    ...##########...
    ..############..
    ..##........##..
    ..##.##..##.##..
    ..##.##..##.##..
    ..##........##..
    ..############..
    ..##........##..
    ..##.######.##..
    ..##........##..
    ..############..
    ...##########...
    ....##....##....
    ...###....###...
    ................
  `),
  // One eye rather than two, plus an antenna. One eye reads instantly even
  // shrunk, and it happens to mean the right thing: the thing that is watching.
  scanner: parseGrid(`
    ................
    .......##.......
    .......##.......
    ....########....
    ..############..
    .##############.
    .###..####..###.
    .##..######..##.
    .##..######..##.
    .###..####..###.
    .##############.
    ..############..
    ....########....
    ...##......##...
    ..##........##..
    ................
  `),
  // A tower that transmits: two aerials over a squat body with a wide mouth.
  c2: parseGrid(`
    ................
    ....#......#....
    .....#....#.....
    ......####......
    .....######.....
    ....########....
    ...##########...
    ..############..
    ..##.##..##.##..
    ..##........##..
    ..############..
    ..##.#....#.##..
    ..############..
    ...##########...
    ....##....##....
    ................
  `),
  // A hood with nothing under it but eyes.
  anonymizer: parseGrid(`
    ................
    .....######.....
    ....########....
    ...##########...
    ..############..
    ..###......###..
    ..##........##..
    ..##.##..##.##..
    ..##........##..
    ..############..
    ..############..
    .##############.
    .##############.
    .####......####.
    .###........###.
    ................
  `),
  // A window with a title bar, two eyes, and lines of content.
  site: parseGrid(`
    ................
    .##############.
    .##############.
    .#............#.
    .#.##......##.#.
    .#.##......##.#.
    .#............#.
    .#....####....#.
    .#............#.
    .#.##########.#.
    .#............#.
    .#.########...#.
    .#............#.
    .##############.
    ................
    ................
  `),
  // A sheet with a folded corner, two eyes, and lines of content.
  file: parseGrid(`
    ................
    ..#########.....
    ..###########...
    ..##......####..
    ..##........##..
    ..##.##..##.##..
    ..##.##..##.##..
    ..##........##..
    ..##.######.##..
    ..##........##..
    ..##.######.##..
    ..##........##..
    ..##.####...##..
    ..##........##..
    ..############..
    ................
  `),
};

/**
 * 6x3 chest marks. Drawing each provider's real logo does not survive 16x16 at
 * one bit, and would mean reproducing trademarks. One shared body plus a
 * changing mark reads as a family automatically, and a new provider costs six
 * by three pixels rather than a whole character.
 */
const MARKS: Record<MarkKey, string[]> = {
  aws: parseGrid(`
    ..##..
    .####.
    ##..##
  `),
  azure: parseGrid(`
    ##..##
    .####.
    ..##..
  `),
  gcp: parseGrid(`
    .####.
    ##..##
    .####.
  `),
  cloudflare: parseGrid(`
    ..##..
    .####.
    ######
  `),
};

/**
 * Two horns over the top corners, composited onto whichever base was chosen.
 * Better than a corner warning badge on three counts: it needs no explanation,
 * it is native to the idiom being borrowed, and it produces an evil AWS rather
 * than an AWS with a sticker on it. A `.` here is transparent.
 */
const HORNS = parseGrid(`
  ##...........###
  .##.........##..
`);

/** Overwrite a rectangular region, used for the mark well. */
function paintOpaque(rows: string[][], patch: string[], x0: number, y0: number): void {
  patch.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      rows[y0 + dy][x0 + dx] = ch;
    });
  });
}

/** Add pixels only, used for the overlay. */
function paintOver(rows: string[][], patch: string[], x0: number, y0: number): void {
  patch.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      if (ch === "#") rows[y0 + dy][x0 + dx] = "#";
    });
  });
}

/** Base body, then the provider mark into its well, then the overlay. */
export function composeGrid(spec: SpriteSpec): string[] {
  const rows = BODIES[spec.body].map((r) => [...r]);
  if (spec.mark && spec.body === "hosting") {
    paintOpaque(rows, MARKS[spec.mark], MARK_X, MARK_Y);
  }
  if (spec.flagged) paintOver(rows, HORNS, 0, 0);
  return rows.map((r) => r.join(""));
}

/** Merge each horizontal run of set pixels into one rectangle. A 16x16 sprite
 *  lands around 30 to 40 of these, which is a small enough SVG to inline. */
export function toRects(grid: string[]): Rect[] {
  const out: Rect[] = [];
  grid.forEach((row, y) => {
    let run = 0;
    [...row].forEach((ch, x) => {
      if (ch === "#") {
        run++;
        return;
      }
      if (run) out.push({ x: x - run, y, w: run });
      run = 0;
    });
    if (run) out.push({ x: row.length - run, y, w: run });
  });
  return out;
}

/** The whole pipeline, which is what the renderer calls. */
export function spriteRects(spec: SpriteSpec): Rect[] {
  return toRects(composeGrid(spec));
}
```

Sanity check on `MARK_H`: it is referenced only by this comment and the tests, which assert rows 8 to 10 inclusive. Keep the constant so the well's height is stated once; if lint reports it unused, inline it into a comment and delete the constant.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/ti/sprite.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sprite.ts lib/ti/sprite.test.ts
git commit -m "feat(ti): 1-bit sprite grids, composed on the grid and emitted as SVG rects"
```

---

### Task 4: The contact sheet

The grids in Task 3 are drafts and cannot be judged as text. Build the viewer before revising the art, exactly as issue #59 argues: drawing one and seeing it immediately beats drawing eleven and discovering the language does not work.

**Files:**
- Create: `scripts/sprites.mjs`

**Interfaces:**
- Consumes: `spriteRects`, `BODY_KEYS`, `MARK_KEYS`, `SPRITE_SIZE` from `lib/ti/sprite.ts`.
- Produces: a PNG per theme in `$SHOT_DIR` (default `<tmpdir>/claude/shots`).

- [ ] **Step 1: Write the script**

Create `scripts/sprites.mjs`. It renders inline SVG through `page.setContent`, so it needs no dev server and steps around the Google sign-in gate entirely.

```js
// Contact sheet for the 1-bit sprite set: every body, every provider mark,
// at 16, 32 and 64 px, with and without the flagged overlay, in both themes.
//
// Run with Bun, not node: it imports a TypeScript module directly.
//   bun scripts/sprites.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BODY_KEYS,
  MARK_KEYS,
  SPRITE_SIZE,
  spriteRects,
} from "../lib/ti/sprite.ts";

const OUT = process.env.SHOT_DIR || join(tmpdir(), "claude", "shots");
mkdirSync(OUT, { recursive: true });

const SIZES = [16, 32, 64];

function svg(spec, px) {
  const rects = spriteRects(spec)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1"/>`)
    .join("");
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}"
     shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
}

function cell(label, spec) {
  const row = SIZES.map((px) => `<span class="s">${svg(spec, px)}</span>`).join("");
  return `<figure><div class="row">${row}</div><figcaption>${label}</figcaption></figure>`;
}

const specs = [];
for (const body of BODY_KEYS) {
  specs.push([body, { body, flagged: false }]);
  specs.push([`${body} + horns`, { body, flagged: true }]);
}
for (const mark of MARK_KEYS) {
  specs.push([`hosting + ${mark}`, { body: "hosting", mark, flagged: false }]);
  specs.push([`hosting + ${mark} + horns`, { body: "hosting", mark, flagged: true }]);
}

const html = (theme) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:32px; font:12px ui-monospace,monospace;
         background:${theme === "dark" ? "#0a0a0a" : "#ffffff"};
         color:${theme === "dark" ? "#ededed" : "#171717"}; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:28px 20px; }
  .row { display:flex; align-items:flex-end; gap:14px; min-height:68px; }
  figcaption { margin-top:8px; opacity:.6; letter-spacing:.06em; text-transform:uppercase; }
  h1 { font-size:13px; letter-spacing:.14em; text-transform:uppercase; margin:0 0 24px; }
</style></head><body>
  <h1>sprite contact sheet, ${theme}, 16 / 32 / 64 px</h1>
  <div class="grid">${specs.map(([l, s]) => cell(l, s)).join("")}</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
for (const theme of ["light", "dark"]) {
  await page.setContent(html(theme), { waitUntil: "load" });
  const file = `sprites-${theme}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  console.log(`saved ${file}`);
}
await browser.close();
```

- [ ] **Step 2: Run it**

Run: `bunx playwright install chromium` once if the browser is missing, then:
Run: `bun scripts/sprites.mjs`
Expected: two lines, `saved sprites-light.png` and `saved sprites-dark.png`.

- [ ] **Step 3: Look at the output**

Read both PNGs. Confirm, at 32px in particular, that the hosting rack, the scanner, the c2 tower, the anonymizer hood, the site window and the file sheet are each recognisable, that the five hosting variants read as one family, and that the horns are legible without explanation. Write down which grids fail; Task 5 fixes them.

- [ ] **Step 4: Commit**

```bash
git add scripts/sprites.mjs
git commit -m "chore(sprites): contact sheet for the sprite set, both themes, three sizes"
```

---

### Task 5: Revise the art against the contact sheet

Task 3's grids are drafts. This is the loop that turns them into the set that ships.

**Files:**
- Modify: `lib/ti/sprite.ts` (the `BODIES` and `MARKS` constants only)

**Interfaces:**
- Consumes: `scripts/sprites.mjs` from Task 4.
- Produces: no signature changes. The tests from Task 3 keep passing, which is the point of having written them first.

- [ ] **Step 1: Fix one grid**

Pick the worst offender from Task 4 Step 3 and edit its ASCII in `lib/ti/sprite.ts`. Constraints that must hold:

- exactly 16 rows of exactly 16 characters, only `#` and `.`
- rows 8 to 10, columns 5 to 10 of `hosting` stay reserved for the mark; nothing else may rely on those cells
- the five hosting variants must share an identical silhouette, differing only inside the well, so the eye reads "some kind of hosting" first and "which one" second
- `scanner`, `c2`, `anonymizer`, `site` and `file` must separate by silhouette, not by a mark, because they have to be told apart at a glance
- rows 0 and 1 must leave room for the horns to read; a body that already fills both top corners will swallow them

- [ ] **Step 2: Re-render and look**

Run: `bun scripts/sprites.mjs`
Read the two PNGs again. Keep the change or revert it.

- [ ] **Step 3: Repeat until the set holds together**

One grid per pass. Do not batch edits; the whole reason the viewer exists is that a change is judged by looking at it.

- [ ] **Step 4: Run the tests**

Run: `bun run test lib/ti/sprite.test.ts`
Expected: PASS. A failure here means a grid stopped being 16x16 or a mark leaked out of the well.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sprite.ts
git commit -m "feat(sprites): the drawn set, judged at 32px on the contact sheet"
```

---

### Task 6: `subject-record.ts` foundations, types and timestamps

`SourceFinding.lastSeen` is typed `string` and carries at least three formats. `Date.parse("2026-08-30 01:00:00")`, the Onionoo shape, is read as **local** time; `Date.parse("2026-08-30 01:00:00 UTC")`, the URLhaus shape, is read as UTC. Same field, same renderer, and the Tor timestamp silently shifts by the deployment's offset, seven hours on `sin1`. Comparing values across sources means parsing them, so the fix cannot be deferred.

**Files:**
- Create: `lib/ti/subject-record.ts`
- Create: `lib/ti/subject-record.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type Claim = { label: string; sources: string[] }`
  - `type SubjectRecord = { subject: string; qualifier?: string; class: Claim; hostedOn?: Claim; reportedFor?: (Claim & { also: string[] }); seen?: { first?: string; last?: string }; sprite: SpriteSpec; footer: string }`
  - `parseSeen(value: string | undefined): number | undefined`
  - `seenRange(sources: SourceResult[], ctx?: { firstSeen?: string; lastSeen?: string }): { first?: string; last?: string } | undefined`

  Tasks 7 to 10 extend this file. Task 12 renders `SubjectRecord`.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/subject-record.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSeen, seenRange } from "@/lib/ti/subject-record";
import type { CheckStats, SourceResult } from "@/lib/ti/types";

/** A settled source row. Every field the resolvers read is optional, so tests
 *  set only what they are about. */
export function src(opts: {
  id: string;
  status?: SourceResult["status"];
  categories?: string[];
  details?: Record<string, unknown>;
  lastSeen?: string;
  score?: number;
  malicious?: boolean;
  weight?: number;
  requiresKey?: boolean;
}): SourceResult {
  return {
    source: {
      id: opts.id,
      name: opts.id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: opts.requiresKey ?? false,
      weight: opts.weight ?? 1,
    },
    enabled: true,
    durationMs: 1,
    status: opts.status ?? "ok",
    categories: opts.categories,
    details: opts.details,
    lastSeen: opts.lastSeen,
    score: opts.score,
    malicious: opts.malicious,
  };
}

/** CheckStats is required on every result type and no resolver reads it, so
 *  the fixtures fill it honestly rather than casting around it. */
function stats(n: number): CheckStats {
  return { total: n, queried: n, flagged: 0, skipped: 0, errored: 0, rateLimited: 0 };
}

describe("parseSeen", () => {
  it("reads a zone-less timestamp as UTC, not as local time", () => {
    // Onionoo's shape. Date.parse reads this as local, which is the live bug:
    // on sin1 the Tor timestamp lands seven hours out and nothing logs it.
    expect(parseSeen("2026-08-30 01:00:00")).toBe(Date.UTC(2026, 7, 30, 1, 0, 0));
  });

  it("agrees with the same instant written the URLhaus way", () => {
    expect(parseSeen("2026-08-30 01:00:00 UTC")).toBe(parseSeen("2026-08-30 01:00:00"));
  });

  it("still reads a proper ISO string with an offset", () => {
    expect(parseSeen("2026-08-30T08:00:00+07:00")).toBe(Date.UTC(2026, 7, 30, 1, 0, 0));
  });

  it("discards what it cannot place rather than rendering it", () => {
    expect(parseSeen(undefined)).toBeUndefined();
    expect(parseSeen("")).toBeUndefined();
    expect(parseSeen("not a date")).toBeUndefined();
    expect(parseSeen("1970-01-01T00:00:00Z")).toBeUndefined();
  });
});

describe("seenRange", () => {
  it("takes the latest lastSeen across sources", () => {
    const range = seenRange([
      src({ id: "abuseipdb", lastSeen: "2026-08-01T00:00:00Z" }),
      src({ id: "otx", lastSeen: "2026-08-30T00:00:00Z" }),
    ]);
    expect(range).toEqual({ first: undefined, last: "2026-08-30" });
  });

  it("finds first-seen where the two sources that carry it put it", () => {
    const range = seenRange([
      src({ id: "feodo", details: { firstSeen: "2026-02-11 09:00:00" } }),
      src({ id: "dshield", details: { feedFirstSeen: "2026-03-01" } }),
      src({ id: "otx", lastSeen: "2026-08-30T00:00:00Z" }),
    ]);
    expect(range).toEqual({ first: "2026-02-11", last: "2026-08-30" });
  });

  it("reads the hash context when one is given", () => {
    expect(
      seenRange([], { firstSeen: "2025-01-05T00:00:00Z", lastSeen: "2026-01-05T00:00:00Z" }),
    ).toEqual({ first: "2025-01-05", last: "2026-01-05" });
  });

  it("ignores a source that did not answer", () => {
    expect(
      seenRange([src({ id: "otx", status: "timeout", lastSeen: "2026-08-30T00:00:00Z" })]),
    ).toBeUndefined();
  });

  it("is undefined when nothing carries a usable date", () => {
    expect(seenRange([src({ id: "otx" })])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: FAIL, cannot resolve `@/lib/ti/subject-record`.

- [ ] **Step 3: Write the module**

Create `lib/ti/subject-record.ts`:

```ts
import type { SourceResult } from "./types";
import type { SpriteSpec } from "./sprite";

/**
 * One assertion about the indicator, plus who made it.
 *
 * `sources` holds registry source ids where a single source is responsible
 * ("feodo", "abuseipdb, otx"). Where the claim comes from merged context that
 * cannot be attributed to one row, it holds the mechanism instead ("asn table",
 * "asn org name", "geo flags"). Both render the same way, and both are honest
 * about where the sentence came from.
 */
export type Claim = { label: string; sources: string[] };

export type SubjectRecord = {
  /** The indicator, verbatim. */
  subject: string;
  /** Hash only: the algorithm, rendered as the chip beside the heading. */
  qualifier?: string;
  /** What it is. The threat identity when there is one, else the
   *  infrastructure identity, else the per-type classifier. */
  class: Claim;
  /** Who runs the box. Undefined when `class` already carries it, so the same
   *  fact never renders on two rows. */
  hostedOn?: Claim;
  /** What it did, as reported. */
  reportedFor?: Claim & { also: string[] };
  /** ISO days. */
  seen?: { first?: string; last?: string };
  sprite: SpriteSpec;
  footer: string;
};

/** A settled, successful row for a given source id. A timed-out or errored
 *  source must not back a claim, which is why the status is checked here rather
 *  than at each call site. */
export function ok(sources: SourceResult[], id: string): SourceResult | undefined {
  return sources.find((s) => s.source.id === id && s.status === "ok");
}

const ZONELESS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;

/**
 * Milliseconds for one of the timestamp shapes the sources emit, or undefined.
 *
 * A zone-less "YYYY-MM-DD HH:MM:SS" is read as UTC. `Date.parse` reads it as
 * local, which is how the Onionoo timestamp shifts by the deployment's offset
 * with nothing failing and nothing logging. #60 gives `lastSeen` a format
 * contract and a home in lib/ti/canon/; move this there when that lands.
 */
export function parseSeen(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\s+UTC$/i, "");
  const normalized = ZONELESS.test(trimmed) ? `${trimmed.replace(" ", "T")}Z` : trimmed;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) return undefined;
  const year = new Date(ms).getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return undefined;
  return ms;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The two `details` keys that carry a first-seen. No source puts one on the
 *  finding itself: `SourceFinding` has `lastSeen` and no sibling. */
const FIRST_SEEN_KEYS = ["firstSeen", "feedFirstSeen"] as const;

/** Earliest first-seen and latest last-seen across everything that answered. */
export function seenRange(
  sources: SourceResult[],
  ctx?: { firstSeen?: string; lastSeen?: string },
): { first?: string; last?: string } | undefined {
  const settled = sources.filter((s) => s.status === "ok");

  const firsts = [
    parseSeen(ctx?.firstSeen),
    ...settled.flatMap((s) =>
      FIRST_SEEN_KEYS.map((k) => {
        const v = s.details?.[k];
        return typeof v === "string" ? parseSeen(v) : undefined;
      }),
    ),
  ].filter((n): n is number => n !== undefined);

  const lasts = [
    parseSeen(ctx?.lastSeen),
    ...settled.map((s) => parseSeen(s.lastSeen)),
  ].filter((n): n is number => n !== undefined);

  if (!firsts.length && !lasts.length) return undefined;
  return {
    first: firsts.length ? isoDay(Math.min(...firsts)) : undefined,
    last: lasts.length ? isoDay(Math.max(...lasts)) : undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/ti/subject-record.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/subject-record.ts lib/ti/subject-record.test.ts
git commit -m "feat(ti): subject record foundations, and read a zone-less timestamp as UTC"
```

---

### Task 7: The infrastructure ladder

Who runs the box. Every rung is a source with `requiresKey: false` and no quota, because a rung the sprite depends on may not change answer with the day's API usage.

**Files:**
- Modify: `lib/ti/subject-record.ts`
- Modify: `lib/ti/subject-record.test.ts`

**Interfaces:**
- Consumes: `ok`, `Claim` (Task 6); `cloudProvider` with `via` (Task 1); `classifyIpLabel` (Task 2).
- Produces:
  - `type AnyResult = CheckResult | DomainCheckResult | HashCheckResult`
  - `type Resolver = (r: AnyResult) => Claim | null`
  - `firstClaim(resolvers: Resolver[], r: AnyResult): Claim | null`
  - `infraClaim(r: AnyResult): Claim | null`

  Task 10 calls `infraClaim`.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/subject-record.test.ts`:

```ts
import { infraClaim } from "@/lib/ti/subject-record";
import type { CheckResult, DomainCheckResult } from "@/lib/ti/types";

function ipResult(sources: SourceResult[], geo?: CheckResult["geo"]): CheckResult {
  return {
    ip: "185.220.101.42",
    checkedAt: "2026-09-03T00:00:00Z",
    riskScore: 0,
    verdict: "unknown",
    geo,
    sources,
    stats: stats(sources.length),
  } as CheckResult;
}

describe("infraClaim", () => {
  it("prefers the provider's own published prefix list", () => {
    const claim = infraClaim(
      ipResult(
        [
          src({
            id: "cloud-range",
            details: {
              provider: "Amazon Web Services",
              region: "eu-west-1",
              service: "EC2",
              cidr: "3.248.0.0/13",
            },
          }),
        ],
        { asn: "AS16509", asnOrg: "AMAZON-02" },
      ),
    );
    expect(claim).toEqual({
      label: "Amazon Web Services, eu-west-1, EC2",
      sources: ["cloud-range"],
    });
  });

  it("falls back to the ASN table, which is a fact", () => {
    const claim = infraClaim(ipResult([], { asn: "AS8075", asnOrg: "MICROSOFT-CORP" }));
    expect(claim).toEqual({ label: "Microsoft Azure", sources: ["asn table"] });
  });

  it("never names a provider it only inferred from the org string", () => {
    // No ASN, so cloudProvider can only match the org regex. #59: a correct
    // generic beats a confident wrong logo (jAWSon, strAWSon, hAWSley).
    const claim = infraClaim(ipResult([], { asnOrg: "Hetzner Online GmbH" }));
    expect(claim).toEqual({ label: "Hosting", sources: ["asn org name"] });
  });

  it("reads a CDN tag from Shodan before falling through to PeeringDB", () => {
    const claim = infraClaim(
      ipResult([src({ id: "shodan-internetdb", details: { tags: ["cdn", "https"] } })]),
    );
    expect(claim).toEqual({ label: "CDN edge", sources: ["shodan-internetdb"] });
  });

  it("names the network from PeeringDB", () => {
    const claim = infraClaim(
      ipResult([
        src({
          id: "peeringdb",
          details: { networkClass: "Content", peeringName: "Fastly" },
        }),
      ]),
    );
    expect(claim).toEqual({ label: "Content, Fastly", sources: ["peeringdb"] });
  });

  it("ends at the geo flags, and does not claim a residential address is infra", () => {
    expect(infraClaim(ipResult([], { isHosting: true }))).toEqual({
      label: "Hosting / Datacenter",
      sources: ["geo flags"],
    });
    // isProxy belongs to the threat ladder; isMobile and residential are not
    // "who runs the box" claims, so infra declines them.
    expect(infraClaim(ipResult([], { isProxy: true }))).toBeNull();
    expect(infraClaim(ipResult([], { country: "Thailand" }))).toBeNull();
  });

  it("says a domain is behind a provider, not that it is one", () => {
    // #59: the same prefix match is a different claim for a domain. On an IP it
    // means this address is the edge; on a domain it means the origin is not
    // visible from here.
    const domain: DomainCheckResult = {
      domain: "example.test",
      checkedAt: "2026-09-03T00:00:00Z",
      riskScore: 0,
      verdict: "unknown",
      sources: [
        src({ id: "cloud-range", details: { provider: "Cloudflare", cidr: "104.16.0.0/13" } }),
      ],
      stats: stats(1),
    } as DomainCheckResult;
    expect(infraClaim(domain)).toEqual({
      label: "Behind Cloudflare",
      sources: ["cloud-range"],
    });
  });

  it("is null when nothing free could place the network", () => {
    expect(infraClaim(ipResult([]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: FAIL, `infraClaim` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/ti/subject-record.ts`:

```ts
import { cloudProvider } from "./cloud";
import { classifyIpLabel } from "./indicator-class";
import type { CheckResult, DomainCheckResult, HashCheckResult } from "./types";

export type AnyResult = CheckResult | DomainCheckResult | HashCheckResult;
export type Resolver = (r: AnyResult) => Claim | null;

/** First resolver that answers wins. Written as a reduce rather than a chain of
 *  ifs so the ladder stays one statement and S3776 stays flat however long it
 *  gets. */
export function firstClaim(resolvers: Resolver[], r: AnyResult): Claim | null {
  return resolvers.reduce<Claim | null>((hit, f) => hit ?? f(r), null);
}

const isDomain = (r: AnyResult): r is DomainCheckResult => "domain" in r;
const geoOf = (r: AnyResult) => ("ip" in r ? r.geo : undefined);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** The provider's own published prefix list, which is the only authoritative
 *  answer available. For a domain the match is against the resolved IPs, and
 *  the claim is weaker: it says the origin is hidden, not that the domain is
 *  the provider. */
const fromCloudRange: Resolver = (r) => {
  const d = ok(r.sources, "cloud-range")?.details;
  const provider = str(d?.provider);
  if (!provider) return null;
  if (isDomain(r)) return { label: `Behind ${provider}`, sources: ["cloud-range"] };
  const label = [provider, str(d?.region), str(d?.service)].filter(Boolean).join(", ");
  return { label, sources: ["cloud-range"] };
};

/** AS16509 is Amazon. A fact, and safe to put a named mark on. */
const fromAsnTable: Resolver = (r) => {
  const geo = geoOf(r);
  const hit = cloudProvider(geo?.asn, geo?.asnOrg);
  return hit?.via === "asn" ? { label: hit.name, sources: ["asn table"] } : null;
};

const fromShodanCdn: Resolver = (r) => {
  const tags = strArr(ok(r.sources, "shodan-internetdb")?.details?.tags).map((t) =>
    t.toLowerCase(),
  );
  return tags.includes("cdn")
    ? { label: "CDN edge", sources: ["shodan-internetdb"] }
    : null;
};

const fromPeeringDb: Resolver = (r) => {
  const d = ok(r.sources, "peeringdb")?.details;
  const label = [str(d?.networkClass), str(d?.peeringName)].filter(Boolean).join(", ");
  return label ? { label, sources: ["peeringdb"] } : null;
};

/** An org-name regex is an inference, so it yields the generic and never a
 *  name. See the comment on CLOUD_BY_ORG in lib/ti/cloud.ts for what a bad
 *  inference looks like. */
const fromOrgRegex: Resolver = (r) => {
  const geo = geoOf(r);
  const hit = cloudProvider(geo?.asn, geo?.asnOrg);
  return hit?.via === "org" ? { label: "Hosting", sources: ["asn org name"] } : null;
};

/** Only the hosting flag is an infrastructure claim. isProxy is a threat claim
 *  and belongs to the other ladder; mobile and residential answer "what kind of
 *  network", which is not the same question as "who runs the box". */
const fromGeoFlags: Resolver = (r) => {
  const geo = geoOf(r);
  if (!geo?.isHosting || geo.isProxy) return null;
  return { label: classifyIpLabel(geo).label, sources: ["geo flags"] };
};

const INFRA: Resolver[] = [
  fromCloudRange,
  fromAsnTable,
  fromShodanCdn,
  fromPeeringDb,
  fromOrgRegex,
  fromGeoFlags,
];

/** Who runs the box, from free, unmetered sources only. */
export function infraClaim(r: AnyResult): Claim | null {
  return firstClaim(INFRA, r);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/ti/subject-record.test.ts && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/subject-record.ts lib/ti/subject-record.test.ts
git commit -m "feat(ti): the infrastructure ladder, and a named provider only on a fact"
```

---

### Task 8: The threat ladder for IPs

What the box is, as opposed to what it did. Feodo's `details.malware` is the pick of the set: it names the family, free and without a key, and today it reaches `categories` as a flat string and is never read again.

**Files:**
- Modify: `lib/ti/subject-record.ts`
- Modify: `lib/ti/subject-record.test.ts`

**Interfaces:**
- Consumes: `ok`, `firstClaim`, `Resolver` (Tasks 6, 7).
- Produces: `threatClaim(r: AnyResult): Claim | null`. Task 9 extends the ladder with domain and hash rungs; Task 10 calls it.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/subject-record.test.ts`:

```ts
import { threatClaim } from "@/lib/ti/subject-record";

describe("threatClaim, IP rungs", () => {
  it("names the family Feodo already knows", () => {
    expect(
      threatClaim(
        ipResult([
          src({
            id: "feodo",
            malicious: true,
            categories: ["botnet-c2", "Dridex"],
            details: { malware: "Dridex", port: 443, status: "online" },
          }),
        ]),
      ),
    ).toEqual({ label: "Dridex C2", sources: ["feodo"] });
  });

  it("falls back to a bare C2 when Feodo has no family for the hit", () => {
    expect(
      threatClaim(ipResult([src({ id: "feodo", malicious: true, details: { port: 443 } })])),
    ).toEqual({ label: "Botnet C2", sources: ["feodo"] });
  });

  it("tells an exit node from a relay", () => {
    expect(
      threatClaim(ipResult([src({ id: "tor-project", details: { role: "exit" } })])),
    ).toEqual({ label: "Tor exit node", sources: ["tor-project"] });
    expect(
      threatClaim(ipResult([src({ id: "tor-project", details: { role: "relay" } })])),
    ).toEqual({ label: "Tor relay", sources: ["tor-project"] });
  });

  it("names the scanner operator the host's own PTR gave up", () => {
    expect(
      threatClaim(
        ipResult([
          src({
            id: "scanner-id",
            weight: 0,
            details: { operator: "Censys", hostname: "scanner.censys.io" },
          }),
        ]),
      ),
    ).toEqual({ label: "Research scanner, Censys", sources: ["scanner-id"] });
  });

  it("reads only the tags Shodan treats as marking the host itself", () => {
    expect(
      threatClaim(
        ipResult([src({ id: "shodan-internetdb", details: { tags: ["honeypot", "cdn"] } })]),
      ),
    ).toEqual({ label: "Honeypot", sources: ["shodan-internetdb"] });
    // "cdn" alone is infrastructure, not a threat claim.
    expect(
      threatClaim(ipResult([src({ id: "shodan-internetdb", details: { tags: ["cdn"] } })])),
    ).toBeNull();
  });

  it("reads the netblock and compromised-host rungs", () => {
    expect(
      threatClaim(ipResult([src({ id: "spamhaus-drop", categories: ["criminal-netblock"] })])),
    ).toEqual({ label: "Criminal netblock", sources: ["spamhaus-drop"] });
    expect(
      threatClaim(ipResult([src({ id: "et-open", categories: ["compromised", "et-open"] })])),
    ).toEqual({ label: "Compromised host", sources: ["et-open"] });
  });

  it("reads the proxy flag the infra ladder declined", () => {
    expect(threatClaim(ipResult([], { isProxy: true }))).toEqual({
      label: "Anonymizer",
      sources: ["geo flags"],
    });
  });

  it("ignores a source that timed out", () => {
    expect(
      threatClaim(
        ipResult([src({ id: "feodo", status: "timeout", details: { malware: "Dridex" } })]),
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: FAIL, `threatClaim` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/ti/subject-record.ts`:

```ts
import { maliciousTags } from "./sources/shodan-internetdb";

/** Feodo names the malware family, free and with no key. "Dridex C2" places the
 *  host far better than the bare "c2" that survives classifyCategory today. */
const fromFeodo: Resolver = (r) => {
  const hit = ok(r.sources, "feodo");
  if (!hit?.malicious) return null;
  const family = str(hit.details?.malware);
  return { label: family ? `${family} C2` : "Botnet C2", sources: ["feodo"] };
};

const fromTor: Resolver = (r) => {
  const role = str(ok(r.sources, "tor-project")?.details?.role);
  if (!role) return null;
  return {
    label: role === "exit" ? "Tor exit node" : "Tor relay",
    sources: ["tor-project"],
  };
};

const fromScannerId: Resolver = (r) => {
  const operator = str(ok(r.sources, "scanner-id")?.details?.operator);
  return operator
    ? { label: `Research scanner, ${operator}`, sources: ["scanner-id"] }
    : null;
};

/** How Shodan's own malicious-tag set reads as a sentence. The set is malware,
 *  compromised, c2, phishing, botnet, honeypot; nothing else in `tags` is a
 *  claim about the host itself. */
const SHODAN_TAG_LABEL: Record<string, string> = {
  honeypot: "Honeypot",
  c2: "Command and control",
  botnet: "Botnet node",
  compromised: "Compromised host",
  malware: "Malware host",
  phishing: "Phishing host",
};

const fromShodanThreatTags: Resolver = (r) => {
  const tags = strArr(ok(r.sources, "shodan-internetdb")?.details?.tags);
  const first = maliciousTags(tags)[0]?.toLowerCase();
  const label = first ? SHODAN_TAG_LABEL[first] : undefined;
  return label ? { label, sources: ["shodan-internetdb"] } : null;
};

/** A category the adapter emits as its own constant, so matching the string is
 *  matching the adapter, not guessing at a display name. */
function fromCategory(id: string, category: string, label: string): Resolver {
  return (r) => {
    const cats = ok(r.sources, id)?.categories ?? [];
    return cats.includes(category) ? { label, sources: [id] } : null;
  };
}

const fromProxyFlag: Resolver = (r) => {
  const geo = geoOf(r);
  return geo?.isProxy ? { label: "Anonymizer", sources: ["geo flags"] } : null;
};

const THREAT: Resolver[] = [
  fromFeodo,
  fromTor,
  fromScannerId,
  fromShodanThreatTags,
  fromCategory("spamhaus-drop", "criminal-netblock", "Criminal netblock"),
  fromCategory("et-open", "compromised", "Compromised host"),
  fromProxyFlag,
];

/** What the box is, from free, unmetered sources only. */
export function threatClaim(r: AnyResult): Claim | null {
  return firstClaim(THREAT, r);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/ti/subject-record.test.ts && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/subject-record.ts lib/ti/subject-record.test.ts
git commit -m "feat(ti): the threat ladder, and stop throwing away Feodo's malware family"
```

---

### Task 9: Domain and hash rungs

Domain and hash reach the same two ladders. Hash has no infrastructure axis, and it is where the free-source rule bites hardest: 10 of the 14 sources in `hash/registry.ts` are key-gated, so the sprite comes off `metadefender`, `maltiverse`, `cymru-mhr` and `hashlookup`.

**Files:**
- Modify: `lib/ti/subject-record.ts`
- Modify: `lib/ti/subject-record.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6 to 8; `classifyDomainLabel`, `classifyHashLabel` (Task 2).
- Produces: no new exports. `threatClaim` gains rungs, and a `lastResortClaim(r)` is added for Task 10.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/subject-record.test.ts`:

```ts
import { lastResortClaim } from "@/lib/ti/subject-record";
import type { HashCheckResult } from "@/lib/ti/types";

function domainResult(
  sources: SourceResult[],
  context?: DomainCheckResult["context"],
): DomainCheckResult {
  return {
    domain: "example.test",
    checkedAt: "2026-09-03T00:00:00Z",
    riskScore: 0,
    verdict: "unknown",
    context,
    sources,
    stats: stats(sources.length),
  } as DomainCheckResult;
}

function hashResult(
  sources: SourceResult[],
  context?: HashCheckResult["context"],
): HashCheckResult {
  return {
    hash: "a".repeat(64),
    algorithm: "sha256",
    checkedAt: "2026-09-03T00:00:00Z",
    riskScore: 0,
    verdict: "unknown",
    context,
    sources,
    stats: stats(sources.length),
  } as HashCheckResult;
}

describe("threatClaim, domain rungs", () => {
  it("reads OpenPhish, which only ever says one thing", () => {
    expect(threatClaim(domainResult([src({ id: "openphish", categories: ["phishing"] })]))).toEqual(
      { label: "Phishing page", sources: ["openphish"] },
    );
  });

  it("reads the Spamhaus DBL meaning rather than its return code", () => {
    expect(
      threatClaim(
        domainResult([
          src({ id: "spamhaus-dbl", categories: ["botnet C&C domain"], details: { codes: ["127.0.1.6"] } }),
        ]),
      ),
    ).toEqual({ label: "Botnet C&C domain", sources: ["spamhaus-dbl"] });
  });

  it("reads a Quad9 block and a registry hold", () => {
    expect(threatClaim(domainResult([src({ id: "quad9", categories: ["dns-blocked"] })]))).toEqual({
      label: "Blocked by Quad9",
      sources: ["quad9"],
    });
    expect(threatClaim(domainResult([src({ id: "rdap", categories: ["registry-hold"] })]))).toEqual({
      label: "Registry hold",
      sources: ["rdap"],
    });
  });
});

describe("threatClaim, hash rungs", () => {
  it("reads Team Cymru's malware hash registry", () => {
    expect(
      threatClaim(hashResult([src({ id: "cymru-mhr", malicious: true, score: 80 })])),
    ).toEqual({ label: "Known malware, Team Cymru MHR", sources: ["cymru-mhr"] });
  });

  it("names what flagged the file in the known-files database", () => {
    expect(
      threatClaim(
        hashResult([src({ id: "hashlookup", malicious: true, categories: ["Kaspersky"] })]),
      ),
    ).toEqual({ label: "Known malicious, Kaspersky", sources: ["hashlookup"] });
  });

  it("answers the clean side, which no other free source does", () => {
    expect(
      threatClaim(hashResult([src({ id: "hashlookup", score: 0, details: { origin: "NSRL" } })])),
    ).toEqual({ label: "Known legitimate file, NSRL", sources: ["hashlookup"] });
  });
});

describe("lastResortClaim", () => {
  it("vouches for a domain in the Tranco top million", () => {
    expect(
      lastResortClaim(domainResult([src({ id: "tranco", details: { rank: 412, vouched: true } })])),
    ).toEqual({ label: "Popular domain, Tranco rank 412", sources: ["tranco"] });
  });

  it("falls through to the registration-age classifier", () => {
    expect(lastResortClaim(domainResult([], { ageDays: 3, resolvedIps: ["1.2.3.4"] }))).toEqual({
      label: "Newly registered",
      sources: ["registration age"],
    });
  });

  it("falls through to the file classifier", () => {
    expect(lastResortClaim(hashResult([], { fileType: "PDF document" }))).toEqual({
      label: "PDF document",
      sources: ["file metadata"],
    });
  });

  it("falls through to the geo classifier for an IP", () => {
    expect(lastResortClaim(ipResult([], { isMobile: true }))).toEqual({
      label: "Mobile network",
      sources: ["geo flags"],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: FAIL, `lastResortClaim` is not exported and the domain and hash rungs return null.

- [ ] **Step 3: Write the implementation**

In `lib/ti/subject-record.ts`, add the resolvers and extend the `THREAT` list:

```ts
import { classifyDomainLabel, classifyHashLabel } from "./indicator-class";

const isHash = (r: AnyResult): r is HashCheckResult => "hash" in r;

/** Spamhaus DBL puts the human meaning of each return code straight into
 *  `categories`, so the first one is the claim. */
const fromSpamhausDbl: Resolver = (r) => {
  const label = ok(r.sources, "spamhaus-dbl")?.categories?.[0];
  return label ? { label, sources: ["spamhaus-dbl"] } : null;
};

const fromCymruMhr: Resolver = (r) => {
  const hit = ok(r.sources, "cymru-mhr");
  return hit?.malicious
    ? { label: "Known malware, Team Cymru MHR", sources: ["cymru-mhr"] }
    : null;
};

/** CIRCL hashlookup answers both sides: which vendor flagged the file, and,
 *  uniquely among the free hash sources, that a file is known good. */
const fromHashlookup: Resolver = (r) => {
  const hit = ok(r.sources, "hashlookup");
  if (!hit) return null;
  if (hit.malicious) {
    const by = hit.categories?.[0];
    return {
      label: by ? `Known malicious, ${by}` : "Known malicious",
      sources: ["hashlookup"],
    };
  }
  if (hit.score === 0) {
    const origin = str(hit.details?.origin);
    return {
      label: origin ? `Known legitimate file, ${origin}` : "Known legitimate file",
      sources: ["hashlookup"],
    };
  }
  return null;
};

const THREAT: Resolver[] = [
  fromFeodo,
  fromTor,
  fromScannerId,
  fromShodanThreatTags,
  fromCategory("spamhaus-drop", "criminal-netblock", "Criminal netblock"),
  fromCategory("et-open", "compromised", "Compromised host"),
  fromCategory("openphish", "phishing", "Phishing page"),
  fromSpamhausDbl,
  fromCategory("quad9", "dns-blocked", "Blocked by Quad9"),
  fromCategory("rdap", "registry-hold", "Registry hold"),
  fromCymruMhr,
  fromHashlookup,
  fromProxyFlag,
];

/** Tranco is a positive identification for the overwhelmingly common case: a
 *  domain that nothing has anything against. */
const fromTranco: Resolver = (r) => {
  const d = ok(r.sources, "tranco")?.details;
  const rank = typeof d?.rank === "number" ? d.rank : undefined;
  return d?.vouched === true && rank !== undefined
    ? { label: `Popular domain, Tranco rank ${rank}`, sources: ["tranco"] }
    : null;
};

/**
 * What to say when no rung identified anything. Never empty: for these three
 * the absence of a finding is itself the classification.
 */
export function lastResortClaim(r: AnyResult): Claim {
  const tranco = fromTranco(r);
  if (tranco) return tranco;
  if (isDomain(r)) {
    const resolves =
      (r.context?.resolvedIps?.length ?? 0) > 0 || (r.context?.ipv6?.length ?? 0) > 0;
    return {
      label: classifyDomainLabel(r.context, resolves).label,
      sources: ["registration age"],
    };
  }
  if (isHash(r)) {
    const hasData = r.sources.some((s) => s.status === "ok" && s.score !== undefined);
    return { label: classifyHashLabel(r.context, hasData).label, sources: ["file metadata"] };
  }
  return { label: classifyIpLabel(geoOf(r)).label, sources: ["geo flags"] };
}
```

Move the `const THREAT` declaration from Task 8 rather than declaring it twice; the block above is the final list.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/ti/subject-record.test.ts && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/subject-record.ts lib/ti/subject-record.test.ts
git commit -m "feat(ti): domain and hash rungs, including the only free source that vouches for a file"
```

---

### Task 10: `buildSubjectRecord`, the behaviour axis, and the sprite

The behaviour axis is `threatTypeOf` with the identification sources filtered out. `threat-type.ts` already names them, so the split #59 asks for needs no adapter change.

**Files:**
- Modify: `lib/ti/threat-type.ts:158` (export `IDENTIFIERS`)
- Modify: `lib/ti/subject-record.ts`
- Modify: `lib/ti/subject-record.test.ts`

**Interfaces:**
- Consumes: `infraClaim`, `threatClaim`, `lastResortClaim`, `seenRange` (Tasks 6 to 9); `SpriteSpec`, `BodyKey`, `MarkKey` (Task 3).
- Produces: `buildSubjectRecord(r: AnyResult): SubjectRecord`. Task 12 renders it.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/subject-record.test.ts`:

```ts
import { buildSubjectRecord } from "@/lib/ti/subject-record";

describe("buildSubjectRecord", () => {
  it("surfaces both axes for the case that motivated the split", () => {
    // 71.6.146.185, a Shodan census host. The people it scanned filed abuse
    // reports, so today the scanner identification and the brute-force tally
    // tie and one true fact loses. Split, both survive.
    const rec = buildSubjectRecord(
      ipResult(
        [
          src({
            id: "abuseipdb",
            score: 100,
            malicious: true,
            requiresKey: true,
            categories: ["Brute-Force", "Port Scan", "Data Center/Web Hosting/Transit"],
          }),
          src({ id: "otx", score: 100, requiresKey: true, categories: ["Brute-Force"] }),
          src({ id: "greynoise", score: 0, requiresKey: true, categories: ["internet-scanner", "benign"] }),
          src({ id: "scanner-id", score: 0, weight: 0, details: { operator: "Shodan.io" } }),
        ],
        { isHosting: true },
      ),
    );
    expect(rec.class).toEqual({
      label: "Research scanner, Shodan.io",
      sources: ["scanner-id"],
    });
    expect(rec.reportedFor?.label).toBe("brute force");
    expect(rec.reportedFor?.sources).toEqual(expect.arrayContaining(["abuseipdb", "otx"]));
  });

  it("keeps the threat identity in class and the provider in hostedOn", () => {
    const rec = buildSubjectRecord(
      ipResult(
        [
          src({ id: "feodo", malicious: true, details: { malware: "Dridex" } }),
          src({
            id: "cloud-range",
            details: { provider: "Amazon Web Services", region: "eu-west-1" },
          }),
        ],
        { asn: "AS16509", asnOrg: "AMAZON-02" },
      ),
    );
    expect(rec.class.label).toBe("Dridex C2");
    expect(rec.hostedOn?.label).toBe("Amazon Web Services, eu-west-1");
    // Infra first for the picture: something physically an EC2 instance is more
    // truly an AWS box than a C2, and the C2 is the line beside it.
    expect(rec.sprite).toEqual({ body: "hosting", mark: "aws", flagged: false });
  });

  it("never renders the same fact on two rows", () => {
    const rec = buildSubjectRecord(
      ipResult([], { asn: "AS8075", asnOrg: "MICROSOFT-CORP" }),
    );
    expect(rec.class.label).toBe("Microsoft Azure");
    expect(rec.hostedOn).toBeUndefined();
  });

  it("puts horns on a flagged verdict and nothing on a clean one", () => {
    const flagged = ipResult([src({ id: "feodo", malicious: true })]);
    flagged.verdict = "malicious";
    expect(buildSubjectRecord(flagged).sprite).toEqual({ body: "c2", flagged: true });

    const clean = ipResult([]);
    clean.verdict = "clean";
    expect(buildSubjectRecord(clean).sprite.flagged).toBe(false);
  });

  it("falls back to the type's own body when nothing identified it", () => {
    expect(buildSubjectRecord(ipResult([])).sprite.body).toBe("hosting");
    expect(buildSubjectRecord(domainResult([])).sprite.body).toBe("site");
    expect(buildSubjectRecord(hashResult([])).sprite.body).toBe("file");
  });

  it("does not change the picture when every key-gated source fails", () => {
    // The rule the sprite set is built on: an icon may not change shape because
    // of how much the tool was used earlier that day (#37).
    const sources = [
      src({ id: "cloud-range", details: { provider: "Amazon Web Services" } }),
      src({ id: "scanner-id", details: { operator: "Censys" } }),
    ];
    const withKeys = [
      ...sources,
      src({ id: "greynoise", requiresKey: true, categories: ["internet-scanner"] }),
      src({ id: "virustotal", requiresKey: true, score: 60 }),
    ];
    const withoutKeys = [
      ...sources,
      src({ id: "greynoise", requiresKey: true, status: "rate_limited" }),
      src({ id: "virustotal", requiresKey: true, status: "error" }),
    ];
    expect(buildSubjectRecord(ipResult(withoutKeys)).sprite).toEqual(
      buildSubjectRecord(ipResult(withKeys)).sprite,
    );
    expect(buildSubjectRecord(ipResult(withoutKeys)).class).toEqual(
      buildSubjectRecord(ipResult(withKeys)).class,
    );
  });

  it("says so rather than leaving a gap", () => {
    const rec = buildSubjectRecord(ipResult([]));
    expect(rec.class.label).toBe("Unknown type");
    expect(rec.reportedFor).toBeUndefined();
    expect(rec.subject).toBe("185.220.101.42");
  });

  it("carries the algorithm as the hash qualifier", () => {
    expect(buildSubjectRecord(hashResult([])).qualifier).toBe("SHA-256");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: FAIL, `buildSubjectRecord` is not exported.

- [ ] **Step 3: Export `IDENTIFIERS`**

In `lib/ti/threat-type.ts`, change the declaration at line 158 and extend its comment:

```ts
/**
 * ... (keep the existing comment) ...
 *
 * Exported because the subject record needs the complement: filtering these out
 * leaves the sources that report what an indicator *did*, which is the other
 * axis. `threatTypeOf` itself is unchanged and `verdict.tsx` still calls it
 * unfiltered, so the withheld-label guard above still protects the headline.
 */
export const IDENTIFIERS = new Set(["greynoise", "scanner-id", "tor-project"]);
```

- [ ] **Step 4: Write `buildSubjectRecord`**

Append to `lib/ti/subject-record.ts`:

```ts
import { IDENTIFIERS, threatTypeOf } from "./threat-type";
import { HASH_ALGO_LABEL } from "../hash";
import type { BodyKey, MarkKey, SpriteSpec } from "./sprite";

/** Which drawn mark, if any, a provider name maps to. Anything undrawn falls
 *  through to the plain hosting body, which is the correct generic. */
const PROVIDER_MARK: Record<string, MarkKey> = {
  "Amazon Web Services": "aws",
  "Microsoft Azure": "azure",
  "Google Cloud": "gcp",
  Cloudflare: "cloudflare",
};

/** Which drawn body a threat claim maps to. Behaviour has no sprites in this
 *  set on purpose: it would only be reached when nothing identified the
 *  indicator, and drawing a guess is worse than drawing the type's own body and
 *  letting the reported-for line speak. */
const THREAT_BODY: [RegExp, BodyKey][] = [
  [/scanner/i, "scanner"],
  [/c2|command and control|botnet/i, "c2"],
  [/tor |anonymizer|proxy|vpn/i, "anonymizer"],
];

const typeBody = (r: AnyResult): BodyKey =>
  isDomain(r) ? "site" : isHash(r) ? "file" : "hosting";

function spriteFor(
  r: AnyResult,
  infra: Claim | null,
  threat: Claim | null,
  flagged: boolean,
): SpriteSpec {
  if (infra) {
    const provider = Object.keys(PROVIDER_MARK).find((p) => infra.label.includes(p));
    return {
      body: "hosting",
      mark: provider ? PROVIDER_MARK[provider] : undefined,
      flagged,
    };
  }
  const body = threat
    ? THREAT_BODY.find(([re]) => re.test(threat.label))?.[1]
    : undefined;
  return { body: body ?? typeBody(r), flagged };
}

const subjectOf = (r: AnyResult): string =>
  isDomain(r) ? r.domain : isHash(r) ? r.hash : r.ip;

/**
 * The record behind the card.
 *
 * `class` prefers the threat identity, because "Dridex C2" tells an analyst
 * more than "AWS". The sprite orders the two the other way round, because it
 * answers "what is this thing" and an EC2 instance is more truly an AWS box
 * than a C2. Nothing is lost either way: whichever one the class did not take
 * is the `hostedOn` line beside it.
 */
export function buildSubjectRecord(r: AnyResult): SubjectRecord {
  const infra = infraClaim(r);
  const threat = threatClaim(r);
  const klass = threat ?? infra ?? lastResortClaim(r);
  const hostedOn = infra && infra !== klass ? infra : undefined;

  // The behaviour axis. Identification sources are filtered out so a source
  // answering "this is a scanner" cannot win the ballot about what it did.
  const behaviour = threatTypeOf(
    r.sources.filter((s) => !IDENTIFIERS.has(s.source.id)),
    { verdict: r.verdict, benignOverride: r.scoreBreakdown?.benignOverride },
  );

  const flagged = r.verdict === "malicious" || r.verdict === "suspicious";
  const responded = r.sources.filter((s) => s.status === "ok").length;

  return {
    subject: subjectOf(r),
    qualifier: isHash(r) ? HASH_ALGO_LABEL[r.algorithm] : undefined,
    class: klass,
    hostedOn,
    reportedFor: behaviour
      ? { label: behaviour.type, sources: behaviour.sources, also: behaviour.also }
      : undefined,
    seen: seenRange(r.sources, isHash(r) ? r.context : undefined),
    sprite: spriteFor(r, infra, threat, flagged),
    footer: `Enriched from ${responded} source${responded === 1 ? "" : "s"}, checked ${new Date(
      r.checkedAt,
    ).toLocaleString()}`,
  };
}
```

`HASH_ALGO_LABEL` is at `lib/hash.ts:45` and maps `sha256` to `"SHA-256"`, which is what the test above expects.

- [ ] **Step 5: Run the full suite**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS, including `lib/ti/threat-type.test.ts` unchanged, since `threatTypeOf` itself was not modified.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/subject-record.ts lib/ti/subject-record.test.ts lib/ti/threat-type.ts
git commit -m "feat(ti): build the subject record, splitting what an indicator is from what it did"
```

---

### Task 11: The sprite component

**Files:**
- Create: `components/CheckResults/sprite.tsx`

**Interfaces:**
- Consumes: `spriteRects`, `SPRITE_SIZE`, `SpriteSpec` (Task 3).
- Produces: `<Sprite spec={SpriteSpec} px={number} className?={string} title?={string} />`. Task 12 uses it.

- [ ] **Step 1: Write the component**

```tsx
import { memo } from "react";
import { SPRITE_SIZE, spriteRects, type SpriteSpec } from "@/lib/ti/sprite";
import { cn } from "@/lib/utils";

/**
 * A 1-bit sprite as inline SVG, filled with `currentColor` so it takes the
 * verdict's colour from whatever wraps it. No image asset and no extra request;
 * crisp at any DPI because it is 30-odd rectangles on a 16 unit grid.
 *
 * Colour never carries the meaning on its own: the flagged state adds horns,
 * which is a shape difference and survives both greyscale and colour blindness.
 */
export const Sprite = memo(function Sprite({
    spec,
    px,
    className,
    title,
}: Readonly<{
    spec: SpriteSpec;
    px: number;
    className?: string;
    title?: string;
}>) {
    return (
        <svg
            width={px}
            height={px}
            viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
            shapeRendering="crispEdges"
            fill="currentColor"
            role="img"
            aria-label={title ?? "Indicator sprite"}
            className={cn("shrink-0", className)}
        >
            {title && <title>{title}</title>}
            {spriteRects(spec).map((r) => (
                <rect key={`${r.y}-${r.x}`} x={r.x} y={r.y} width={r.w} height={1} />
            ))}
        </svg>
    );
});
```

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/CheckResults/sprite.tsx
git commit -m "feat(ui): render a sprite as inline SVG in the verdict's colour"
```

---

### Task 12: The record masthead

**Files:**
- Create: `components/CheckResults/record.tsx`

**Interfaces:**
- Consumes: `SubjectRecord` (Task 10), `Sprite` (Task 11), `VERDICT_STYLE` from `components/CheckResults/verdict.tsx:60`.
- Produces:
  - `<SubjectMasthead record={SubjectRecord} verdict={Verdict} />`
  - `<SubjectMastheadSkeleton />`

  Tasks 13 and 14 mount both.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import type { ReactNode } from "react";
import { memo } from "react";
import type { SubjectRecord } from "@/lib/ti/subject-record";
import type { Verdict } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Sprite } from "./sprite";
import { VERDICT_STYLE } from "./verdict";

/** One labelled row, with the sources that backed it underneath. The provenance
 *  line is what stops this card repeating VerdictHero: the hero says how bad,
 *  this says what, and who said so. */
function Row({
    label,
    sources,
    children,
}: Readonly<{ label: string; sources?: string[]; children: ReactNode }>) {
    return (
        <div className="flex flex-wrap items-baseline gap-x-3 py-1.5 sm:flex-nowrap">
            <dt className="w-32 shrink-0 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {label}
            </dt>
            <dd className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{children}</div>
                {sources?.length ? (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {sources.join(", ")}
                    </div>
                ) : null}
            </dd>
        </div>
    );
}

function seenText(seen: SubjectRecord["seen"]): string | null {
    if (!seen) return null;
    if (seen.first && seen.last) return `${seen.first} to ${seen.last}`;
    if (seen.last) return `Last seen ${seen.last}`;
    if (seen.first) return `First seen ${seen.first}`;
    return null;
}

export const SubjectMasthead = memo(function SubjectMasthead({
    record,
    verdict,
}: Readonly<{ record: SubjectRecord; verdict: Verdict }>) {
    const seen = seenText(record.seen);
    const reported = record.reportedFor;
    const alsoText = reported?.also.length
        ? `, also described as ${reported.also.join(", ")}`
        : "";

    return (
        <div className="flex items-start justify-between gap-4">
            <dl className="min-w-0 flex-1">
                <Row label="Subject">
                    <span className="font-mono break-all">{record.subject}</span>
                    {record.qualifier && (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {record.qualifier}
                        </span>
                    )}
                </Row>
                <Row label="Class" sources={record.class.sources}>
                    {record.class.label}
                </Row>
                {record.hostedOn && (
                    <Row label="Hosted on" sources={record.hostedOn.sources}>
                        {record.hostedOn.label}
                    </Row>
                )}
                <Row label="Reported for" sources={reported?.sources}>
                    {reported ? (
                        <span className="capitalize">
                            {reported.label}
                            <span className="text-muted-foreground normal-case">{alsoText}</span>
                        </span>
                    ) : (
                        <span className="text-muted-foreground">Nothing on file</span>
                    )}
                </Row>
                {seen && <Row label="Seen">{seen}</Row>}
            </dl>

            <div
                className={cn(
                    "flex size-16 shrink-0 items-center justify-center rounded-md border border-foreground/20 bg-background sm:size-20",
                    VERDICT_STYLE[verdict].text,
                )}
            >
                <Sprite
                    spec={record.sprite}
                    px={48}
                    title={record.class.label}
                    className="sm:hidden"
                />
                <Sprite
                    spec={record.sprite}
                    px={64}
                    title={record.class.label}
                    className="hidden sm:block"
                />
            </div>
        </div>
    );
});

/** Matches the row rhythm above, so the card does not jump when the result
 *  lands. Mirrors the skeleton already in IpDossierCard. */
export function SubjectMastheadSkeleton() {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-3">
                {["w-48", "w-36", "w-44", "w-40"].map((w) => (
                    <div key={w} className="flex items-baseline gap-3">
                        <span className="sweep h-3 w-24 shrink-0 rounded" />
                        <span className={cn("sweep h-3 rounded", w)} />
                    </div>
                ))}
            </div>
            <span className="sweep size-16 shrink-0 rounded-md sm:size-20" />
        </div>
    );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS. If `VERDICT_STYLE` is not exported, export it at `components/CheckResults/verdict.tsx:60`; it already is at the time of writing, so no change should be needed.

- [ ] **Step 3: Commit**

```bash
git add components/CheckResults/record.tsx
git commit -m "feat(ui): the subject record masthead, with a mugshot and a provenance line per row"
```

---

### Task 13: Mount it on the IP card

**Files:**
- Modify: `components/CheckResults/dossier.tsx`

**Interfaces:**
- Consumes: `buildSubjectRecord` (Task 10), `SubjectMasthead` and `SubjectMastheadSkeleton` (Task 12).
- Produces: nothing new.

- [ ] **Step 1: Rewrite the card head**

In `components/CheckResults/dossier.tsx`:

1. Import `buildSubjectRecord`, `SubjectMasthead`, `SubjectMastheadSkeleton`, and swap the `Fingerprint` icon for `FileUser` from lucide (a record, not a print). Keep `Fingerprint` if `FileUser` is not in the installed lucide version; check with `grep -c "FileUser" node_modules/lucide-react/dist/lucide-react.d.ts`.
2. Change both `SectionHeading` children from `IP dossier` to `Subject record`.
3. In the streaming branch, replace the flag-and-label sweep block with `<SubjectMastheadSkeleton />`.
4. In the loaded branch, memoize the record next to the existing dossier memo and render the masthead where the identity line is now. Delete the geo identity line: `CLASS` and `HOSTED ON` supersede it and the flag still renders on the Origin card.

```tsx
const record = useMemo(() => buildSubjectRecord(result), [result]);
```

```tsx
<SectionHeading icon={FileUser}>Subject record</SectionHeading>
<SubjectMasthead record={record} verdict={result.verdict} />
{dossier.groups.map((g) => ( /* unchanged */ ))}
```

`useMemo` must stay above the early return, matching the existing `dossier` memo, or the hook order changes between renders.

- [ ] **Step 2: Typecheck, lint, test**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: PASS. Delete `flagUrl` / `joinPlace` imports if the identity line was their only user; lint will name them.

- [ ] **Step 3: Look at it**

Run `bun run dev`, then follow `~/.claude/projects/.../memory/ui-screenshots-behind-auth.md` to mint a session cookie, and screenshot `/check/185.220.101.42` (a Tor exit) and `/check/8.8.8.8` (clean, recognised service). Confirm the sprite reads at 64px, the mugshot sits in the top right, and the provenance lines are legible against the muted foreground.

If you cannot drive a browser, say so explicitly in the commit body rather than claiming it was checked.

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/dossier.tsx
git commit -m "feat(ui): the IP card becomes the subject record"
```

---

### Task 14: Mount it on domain and hash, and delete what it supersedes

`IdentityHeader` and the hash family header are the same idea as `CLASS`, in three shapes that do not agree. That disagreement is what this card exists to fix, so they go rather than sitting above it.

**Files:**
- Modify: `components/CheckResults/profile.tsx:62-105` (delete `IdentityHeader`), `:277-350` (`DomainProfileCard`), `:809-950` (`HashProfileCard`, `hashKind`, `HASH_KIND_TONE`)

**Interfaces:**
- Consumes: everything from Tasks 10 and 12.
- Produces: nothing new.

- [ ] **Step 1: Domain card**

1. `SectionHeading` children: `Registration & DNS` becomes `Subject record`. Keep the `action` chip showing `result.domain`? No: `SUBJECT` now carries it. Delete the `action` prop from both the skeleton and the loaded branch.
2. Replace `<IdentityHeader label={type.label} desc={type.desc} tone={tone} />` with `<SubjectMasthead record={record} verdict={result.verdict} />`.
3. Replace the skeleton's icon-and-label sweep pair with `<SubjectMastheadSkeleton />`.
4. Delete the now-unused `classifyDomain`, `domainTone`, `type` and `tone` locals.

- [ ] **Step 2: Hash card**

1. `SectionHeading` children: `File identity` becomes `Subject record`. Delete the `action` chip: `qualifier` renders the algorithm beside `SUBJECT`.
2. Replace the `StatusDot` / family / categories header block with `<SubjectMasthead record={record} verdict={result.verdict} />`.
3. Replace the skeleton's dot-and-label block with `<SubjectMastheadSkeleton />`.
4. Delete `hashKind`, `HASH_KIND_TONE`, and `classifyHash` / `hashTone` calls left with no reader. Keep `StatusDot` only if something else still uses it; `grep -rn "StatusDot" components/ app/` will say.

- [ ] **Step 3: Delete `IdentityHeader`**

Remove the function at `components/CheckResults/profile.tsx:62-105` and any lucide import that was only its.

- [ ] **Step 4: Typecheck, lint, test**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: PASS. Lint names every now-unused import and local; delete each rather than suppressing it.

- [ ] **Step 5: Look at all three**

Screenshot `/check/example.com` (established domain), `/check/<a known-bad domain>`, and a data-rich hash. Confirm the three cards now share one masthead rhythm, and that a hash with a known family reads `CLASS <family>` rather than a bare `File`.

- [ ] **Step 6: Commit**

```bash
git add components/CheckResults/profile.tsx
git commit -m "feat(ui): domain and hash join the subject record, and the three old identity headers go"
```

---

### Task 15: The stale comment, and the verification pass

**Files:**
- Modify: `lib/ti/ip-dossier.ts:218-226`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Check the claim**

`ip-dossier.ts:225` says spamhaus-drop's "source is not registered in `lib/ti/registry.ts`, so it never contributes a finding". Verify:

Run: `grep -n "spamhausDropSource" lib/ti/registry.ts`
Expected: two hits, an import around line 16 and an array entry around line 48. The comment is stale.

- [ ] **Step 2: Confirm the finding actually arrives**

`spamhaus-drop` is rung 5 of the threat ladder, so this matters beyond tidiness. Run a real lookup against an address on a DROP-listed netblock and check the source row:

Run: `bun run dev`, then in another shell `curl -s localhost:3000/api/check/<ip> | jq '.sources[] | select(.source.id=="spamhaus-drop")'`

If the route is behind the proxy, follow `probe-route-past-the-proxy.md` in the memory directory. If the finding does not arrive, keep rung 5 (it costs nothing when the source is silent) and record what you found in the commit body.

- [ ] **Step 3: Fix the comment**

Rewrite the block at `lib/ti/ip-dossier.ts:218-226` to keep the true half and drop the false half:

```ts
/**
 * Blocklist listings, keyed off each source's raw listing evidence rather than
 * its `malicious` flag: dnsbl/blocklist-de/ipsum all gate `malicious` behind a
 * consensus threshold (>=3 zones, >=5 attacks, >=3 feeds), so a sub-threshold
 * listing (e.g. 2 DNSBL zones) previously produced no row at all even though
 * the source did report a listing. spamhaus-drop is intentionally excluded
 * here: it never sets `malicious` by design, because a DROP listing is a
 * statement about the netblock rather than the address. It is registered and
 * does return findings; lib/ti/subject-record.ts reads its
 * "criminal-netblock" category as an identity claim.
 */
```

- [ ] **Step 4: Full verification**

Run each and read the output before claiming anything passed:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
bun run coverage
node scripts/new-coverage.mjs   # if it takes a base ref, pass origin/main
```

Expected: all green, and coverage on the changed `lib/` lines at or above 80%, which is what Sonar's `new_coverage` gate measures. If `lib/ti/subject-record.ts` is short of it, the gap is almost certainly an unhit resolver; add the case rather than lowering the bar.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/ip-dossier.ts
git commit -m "docs(ti): spamhaus-drop is registered, the comment saying otherwise was stale"
```

- [ ] **Step 6: Open the PR**

Do not open it unprompted. Ask first, per the standing preference to propose and wait. When asked, the branch is a batch of fifteen commits and the body should lead with the two findings worth a reviewer's attention: the identity/behaviour split needs no adapter change because `threat-type.ts` already names the identification sources, and the sprite may not depend on a metered source because #37 is exactly the complaint that a metered source changes the answer with the day's usage.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: the free-source rule to Tasks 7 to 9 and the regression test in Task 10; identity.infra to Task 7; identity.threat to Tasks 8 and 9; per-type to Task 9; the module and its timestamps to Tasks 6 and 10; the sprite set, storage, composition and contact sheet to Tasks 3 to 5; resolution order to Task 10; layout to Tasks 11 to 14; testing to the test steps throughout plus Task 15; the stale-comment note to Task 15.

**Two deliberate refinements to the spec**, both narrowing rather than widening:

1. The spec's flat `SpriteKey` union becomes `BodyKey` plus `MarkKey` (Task 3), which turns "marks are never standalone" from a caveat into a type error.
2. The spec says the last-resort rung calls `classifyDomain` / `classifyHash`. Those live in `components/CheckResults/classify.ts` and import lucide, so `lib/` cannot reach them. Task 2 moves the labels into `lib/ti/indicator-class.ts` and leaves the icons behind, rather than writing a second copy. This also brings the labels inside the coverage scope, which `vitest.config.ts` limits to `lib/`.

**Type consistency.** `Claim`, `SubjectRecord`, `Resolver`, `AnyResult`, `SpriteSpec`, `BodyKey`, `MarkKey` and `Rect` are each defined once and referenced by the same name everywhere after. `ok()`, `firstClaim()`, `infraClaim()`, `threatClaim()`, `lastResortClaim()` and `buildSubjectRecord()` keep their signatures from the task that introduces them.

**Fixture shapes checked against the types.** `CheckStats` requires `total`, `queried`, `flagged`, `skipped`, `errored` and `rateLimited`, which is what the `stats()` helper in Task 6 returns. `HASH_ALGO_LABEL` (`lib/hash.ts:45`) maps `sha256` to `"SHA-256"`, which is what Task 10 asserts.
