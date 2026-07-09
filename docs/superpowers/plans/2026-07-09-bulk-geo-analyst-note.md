# Bulk Geo Analyst Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the copy-friendly column block with an analyst note: one prose paragraph per address saying where it is, what network it announces from, and how well corroborated each claim is.

**Architecture:** A new pure module `lib/ti/geo/note.ts` builds one paragraph per `GeoRow` from six clause builders, each hedged by its own reconciled confidence. `analystNote` joins the paragraphs; the component renders one `<p>` per paragraph, so copied text and rendered text are the same strings. `copyBlock` and its helpers are deleted from `summary.ts`.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Vitest, Tailwind.

Spec: `docs/superpowers/specs/2026-07-09-bulk-geo-analyst-note-design.md`

## Global Constraints

- **User-facing copy uses commas, never em/en dashes or " - " separators.**
- Tests are Vitest, colocated as `lib/**/*.test.ts`, pure, no network.
- `npm test` and `npm run lint` must both pass before a task is done.
- Each fact is hedged by **its own** reconciled confidence, never by the weakest fact in its sentence.
- `geo.org` is never printed: it never went through reconciliation.
- Every row in the batch produces exactly one paragraph. `analystNotes(rows).length === rows.length`.
- No new providers, no coverage change to `bulkGeolocate`, no reconciliation or weight changes.
- Relevant types (`lib/ti/types.ts`): `Confidence = "high" | "medium" | "low"`; `ResolvedField<T> = { value, confidence, score, agreement, sources, alternatives? }`; `GeoFlags = { isHosting, isProxy, isMobile, sources: Record<string, string[]> }`.

---

### Task 1: Paragraph skeleton, location, dissent, unlocated rows

**Files:**
- Create: `lib/ti/geo/note.ts`
- Test: `lib/ti/geo/note.test.ts`

**Interfaces:**
- Consumes: `providerLabel`, `countryCodeOf` from `lib/ti/geo/summary.ts`; `GeoRow` from `lib/ti/geo.ts`.
- Produces: `analystNotes(rows: GeoRow[]): string[]`, `analystNote(rows: GeoRow[]): string`

- [ ] **Step 1: Write the failing tests**

Create `lib/ti/geo/note.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import type { Confidence, GeoResolution } from "../types";
import { analystNote, analystNotes } from "./note";

const noFlags = { isHosting: false, isProxy: false, isMobile: false, sources: {} };

/** An ok row whose resolution is spread over the given fields. */
function okRow(ip: string, res: Partial<GeoResolution>): GeoRow {
  return {
    ip,
    version: 4,
    status: "ok",
    geo: {},
    resolution: { flags: noFlags, providerCount: 2, ...res },
  };
}

function country(
  value: string,
  confidence: Confidence,
  sources: string[],
  alternatives?: { value: string; sources: string[] }[],
) {
  return { value, confidence, score: 1, agreement: 1, sources, ...(alternatives ? { alternatives } : {}) };
}

function field(value: string, confidence: Confidence, sources = ["ip-api"]) {
  return { value, confidence, score: 1, agreement: 1, sources };
}

describe("analystNotes location clause", () => {
  it("asserts a high-confidence country and names its providers", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api", "ipinfo"]),
        countryCode: "US",
      }),
    ];
    expect(analystNotes(rows)[0]).toBe(
      "8.8.8.8 resolves to United States (US), per ip-api.com and IPinfo.",
    );
  });

  it("hedges the verb below high confidence", () => {
    const rows = [
      okRow("1.1.1.1", { country: country("Australia", "medium", ["ip-api"]), countryCode: "AU" }),
    ];
    expect(analystNotes(rows)[0]).toBe("1.1.1.1 is reported as Australia (AU), per ip-api.com.");
  });

  it("includes a corroborated city with its region", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        city: field("Ashburn", "medium"),
        region: field("Virginia", "medium"),
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("resolves to Ashburn, Virginia, United States (US)");
  });

  it("drops a low-confidence city, so it cannot borrow the country's authority", () => {
    const rows = [
      okRow("1.1.1.1", {
        country: country("Australia", "high", ["ip-api"]),
        countryCode: "AU",
        city: field("Sydney", "low"),
        region: field("New South Wales", "low"),
      }),
    ];
    const note = analystNotes(rows)[0];
    expect(note).not.toContain("Sydney");
    expect(note).toContain("resolves to Australia (AU)");
  });

  it("drops a region that has no city", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        region: field("Virginia", "high"),
      }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("Virginia");
  });
});

describe("analystNotes dissent clause", () => {
  it("names the dissenting provider and its value", () => {
    const rows = [
      okRow("1.1.1.1", {
        country: country("Australia", "medium", ["ip-api"], [
          { value: "United States", sources: ["ipinfo"] },
        ]),
        countryCode: "AU",
      }),
    ];
    expect(analystNotes(rows)[0]).toBe(
      "1.1.1.1 is reported as Australia (AU), per ip-api.com. " +
        "IPinfo places it in United States instead.",
    );
  });

  it("omits the clause when providers agreed", () => {
    const rows = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("instead");
  });
});

describe("analystNotes unlocated rows", () => {
  it("states the lookup error", () => {
    const rows: GeoRow[] = [
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ];
    expect(analystNotes(rows)[0]).toBe("203.0.113.7 could not be geolocated: Lookup failed.");
  });

  it("defaults the reason when the row carries no error", () => {
    const rows: GeoRow[] = [{ ip: "203.0.113.7", version: 4, status: "error" }];
    expect(analystNotes(rows)[0]).toBe("203.0.113.7 could not be geolocated: Lookup failed.");
  });

  it("says so when an ok row resolved no country", () => {
    const rows = [okRow("203.0.113.7", {})];
    expect(analystNotes(rows)[0]).toBe("203.0.113.7 returned no country data.");
  });
});

describe("analystNote", () => {
  it("emits one paragraph per row, blank-line joined", () => {
    const rows: GeoRow[] = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ];
    expect(analystNotes(rows)).toHaveLength(2);
    expect(analystNote(rows)).toBe(
      "8.8.8.8 resolves to United States (US), per ip-api.com.\n\n" +
        "203.0.113.7 could not be geolocated: Lookup failed.",
    );
  });

  it("returns nothing for an empty batch", () => {
    expect(analystNotes([])).toEqual([]);
    expect(analystNote([])).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ti/geo/note.test.ts`
Expected: FAIL, cannot resolve module `./note`.

- [ ] **Step 3: Implement**

Create `lib/ti/geo/note.ts`:

```ts
/**
 * The analyst note: one prose paragraph per address in a bulk geolocation
 * batch, saying where it is, what network it announces from, and how well
 * corroborated each claim is.
 *
 * Sibling of `summary.ts`, which answers "what is true of this whole batch".
 * Same rule applies: never describe something the data doesn't support. Each
 * fact is hedged by its OWN reconciled confidence, never by the weakest fact
 * sharing its sentence.
 */
import type { GeoRow } from "../geo";
import { countryCodeOf, providerLabel } from "./summary";

/** Join with commas and a trailing "and": `a, b and c` (or `a and b`). */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function labelled(ids: string[]): string {
  return joinAnd(ids.map(providerLabel));
}

/**
 * `{ip} resolves to Ashburn, Virginia, United States (US), per ip-api.com.`
 *
 * The verb hedges on the country's confidence alone. A low-confidence city is
 * one provider's guess, so it is dropped rather than allowed to sit beside a
 * country we trust. A region never appears without a city.
 */
function locationClause(row: GeoRow): string | undefined {
  const res = row.resolution;
  const code = countryCodeOf(row);
  if (!res?.country || !code) return undefined;

  const verb = res.country.confidence === "high" ? "resolves to" : "is reported as";
  const parts: string[] = [];
  if (res.city && res.city.confidence !== "low") {
    parts.push(res.city.value);
    if (res.region) parts.push(res.region.value);
  }
  parts.push(`${res.country.value} (${code})`);
  return `${row.ip} ${verb} ${parts.join(", ")}, per ${labelled(res.country.sources)}.`;
}

/** `IPinfo places it in United States instead.` */
function dissentClause(row: GeoRow): string | undefined {
  const alternatives = row.resolution?.country?.alternatives;
  if (!alternatives?.length) return undefined;
  const first = alternatives[0];
  return `${labelled(first.sources)} places it in ${first.value} instead.`;
}

/** One paragraph per address, in row order. */
export function analystNotes(rows: GeoRow[]): string[] {
  return rows.map((row) => {
    if (row.status === "error") {
      return `${row.ip} could not be geolocated: ${row.error ?? "Lookup failed"}.`;
    }
    const location = locationClause(row);
    if (!location) return `${row.ip} returned no country data.`;
    return [location, dissentClause(row)].filter(Boolean).join(" ");
  });
}

/** The full note, paragraphs joined by a blank line. What the Copy button sends. */
export function analystNote(rows: GeoRow[]): string {
  return analystNotes(rows).join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/note.test.ts`
Expected: PASS, all 11 cases.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/note.ts lib/ti/geo/note.test.ts
git commit -m "feat(geo): analyst note location and dissent clauses"
```

---

### Task 2: Network, PTR, coordinates, and flags clauses

**Files:**
- Modify: `lib/ti/geo/note.ts`
- Test: `lib/ti/geo/note.test.ts` (append)

**Interfaces:**
- Consumes: `canonicalAsn` from `lib/ti/geo/geokit.ts`; `analystNotes` from Task 1.
- Produces: no new exports. `analystNotes` paragraphs gain up to four more sentences.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ti/geo/note.test.ts`:

```ts
describe("analystNotes network clause", () => {
  it("canonicalizes the AS number, so the org appears exactly once", () => {
    const rows = [
      okRow("1.1.1.1", {
        country: country("Australia", "high", ["ip-api"]),
        countryCode: "AU",
        asn: field("AS13335 Cloudflare, Inc.", "high"),
        asnOrg: field("Cloudflare, Inc.", "high"),
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Announced by AS13335 (Cloudflare, Inc.).");
    expect(analystNotes(rows)[0]).not.toContain("AS13335 Cloudflare, Inc. (");
  });

  it("falls back from asnOrg to isp", () => {
    const rows = [
      okRow("9.9.9.9", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        asn: field("AS19281", "high"),
        isp: field("Quad9", "high"),
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Announced by AS19281 (Quad9).");
  });

  it("never prints the unreconciled org field", () => {
    const row: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "ok",
      geo: { org: "Some Org" },
      resolution: {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        asn: field("AS13335", "high"),
        flags: noFlags,
        providerCount: 1,
      },
    };
    expect(analystNotes([row])[0]).not.toContain("Some Org");
  });

  it("marks a single-sourced ASN", () => {
    const rows = [
      okRow("9.9.9.9", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        asn: field("AS19281", "low"),
        isp: field("Quad9", "high"),
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Announced by AS19281 (Quad9), single-sourced.");
  });

  it("omits the clause with no ASN", () => {
    const rows = [
      okRow("9.9.9.9", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("Announced by");
  });
});

describe("analystNotes PTR clause", () => {
  it("always attributes the PTR, because it never went through a vote", () => {
    const row: GeoRow = {
      ip: "8.8.8.8",
      version: 4,
      status: "ok",
      geo: { reverse: "dns.google" },
      resolution: {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        flags: noFlags,
        providerCount: 1,
      },
    };
    expect(analystNotes([row])[0]).toContain("PTR is dns.google, per ip-api.com.");
  });

  it("omits the clause when there is no PTR", () => {
    const rows = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("PTR");
  });
});

describe("analystNotes coordinates clause", () => {
  it("rounds to two decimals and hedges the verb", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        coordinates: {
          value: { lat: 39.0438, lon: -77.4874 },
          confidence: "high",
          score: 1,
          agreement: 1,
          sources: ["ip-api"],
        },
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Providers place it near 39.04, -77.49.");
  });

  it("omits the clause at low confidence, where the centroid is meaningless", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        coordinates: {
          value: { lat: 39.0438, lon: -77.4874 },
          confidence: "low",
          score: 0.2,
          agreement: 0.2,
          sources: ["ip-api", "ipinfo"],
        },
      }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("place it near");
  });

  it("omits the clause for a non-finite centroid", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        coordinates: {
          value: { lat: Number.NaN, lon: 0 },
          confidence: "high",
          score: 1,
          agreement: 1,
          sources: ["ip-api"],
        },
      }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("place it near");
  });
});

describe("analystNotes flags clause", () => {
  it("names one flag", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        flags: { isHosting: true, isProxy: false, isMobile: false, sources: {} },
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Flagged as hosting infrastructure.");
  });

  it("joins three flags with commas and a trailing and", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        flags: { isHosting: true, isProxy: true, isMobile: true, sources: {} },
      }),
    ];
    expect(analystNotes(rows)[0]).toContain(
      "Flagged as hosting infrastructure, a proxy or VPN exit and a mobile network.",
    );
  });

  it("omits the clause when no flag is set", () => {
    const rows = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("Flagged");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ti/geo/note.test.ts -t "network clause"`
Expected: FAIL, the paragraph has no `Announced by` sentence.

- [ ] **Step 3: Implement**

In `lib/ti/geo/note.ts`, add the `canonicalAsn` import:

```ts
import { canonicalAsn } from "./geokit";
```

Add the four clause builders after `dissentClause`:

```ts
/** `Announced by AS13335 (Cloudflare, Inc.).`
 *
 *  `tally` groups ASN votes by canonicalAsn but stores the raw winning string,
 *  which carries an org tail. Strip it: the org has its own parenthetical.
 *  `geo.org` is never used, it never went through reconciliation. */
function networkClause(row: GeoRow): string | undefined {
  const res = row.resolution;
  if (!res?.asn) return undefined;
  const number = canonicalAsn(res.asn.value) || res.asn.value;
  const org = res.asnOrg?.value ?? res.isp?.value;
  const named = org ? `${number} (${org})` : number;
  const hedge = res.asn.confidence === "low" ? ", single-sourced" : "";
  return `Announced by ${named}${hedge}.`;
}

/** `PTR is dns.google, per ip-api.com.` Attributed, never asserted: `geo.reverse`
 *  comes from ip-api alone and never went through a vote. */
function ptrClause(row: GeoRow): string | undefined {
  const reverse = row.geo?.reverse;
  if (!reverse) return undefined;
  return `PTR is ${reverse}, per ${providerLabel("ip-api")}.`;
}

/** `Providers place it near 39.04, -77.49.`
 *
 *  Two decimals (~1.1 km): the centroid averages city-level guesses, so more
 *  precision would assert knowledge we don't have. Omitted at low confidence,
 *  where the provider points were over COORD_MEDIUM_KM apart. */
function coordinatesClause(row: GeoRow): string | undefined {
  const coords = row.resolution?.coordinates;
  if (!coords || coords.confidence === "low") return undefined;
  const { lat, lon } = coords.value;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return `Providers place it near ${lat.toFixed(2)}, ${lon.toFixed(2)}.`;
}

const FLAG_LABEL: [keyof Pick<GeoFlags, "isHosting" | "isProxy" | "isMobile">, string][] = [
  ["isHosting", "hosting infrastructure"],
  ["isProxy", "a proxy or VPN exit"],
  ["isMobile", "a mobile network"],
];

/** `Flagged as hosting infrastructure, a proxy or VPN exit, and a mobile network.` */
function flagsClause(row: GeoRow): string | undefined {
  const flags = row.resolution?.flags;
  if (!flags) return undefined;
  const set = FLAG_LABEL.filter(([key]) => flags[key]).map(([, label]) => label);
  if (!set.length) return undefined;
  return `Flagged as ${joinAnd(set)}.`;
}
```

Add the `GeoFlags` type import:

```ts
import type { GeoFlags } from "../types";
```

Then extend the paragraph assembly in `analystNotes`, replacing its final `return`:

```ts
    return [
      location,
      dissentClause(row),
      networkClause(row),
      ptrClause(row),
      coordinatesClause(row),
      flagsClause(row),
    ]
      .filter(Boolean)
      .join(" ");
```

`flagsClause` reuses `joinAnd` from Task 1, which produces `a, b and c` with no Oxford comma, matching how the provider list reads in the location clause. The three-flag test expects exactly that.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/note.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/note.ts lib/ti/geo/note.test.ts
git commit -m "feat(geo): analyst note network, PTR, coordinates, flags"
```

---

### Task 3: Delete copyBlock, wire the component, verify in the browser

**Files:**
- Modify: `lib/ti/geo/summary.ts` (delete `copyBlock`, `marked`, `countryCell`, `asnCell`, `ispCell`, and the `canonicalAsn` + `ResolvedField` imports)
- Modify: `lib/ti/geo/summary.test.ts` (delete the `copyBlock` suite and the `netRow` helper, and the now-unused `Confidence` type import)
- Modify: `components/BulkGeoResults.tsx`

**Interfaces:**
- Consumes: `analystNote`, `analystNotes` from Tasks 1 and 2.
- Produces: no exported change. `BulkGeoResults({ rows }: { rows: GeoRow[] })`.

- [ ] **Step 1: Delete copyBlock and its helpers**

Remove from `lib/ti/geo/summary.ts` everything from the `/** A resolved value, suffixed with "?" ... */` comment through the end of `copyBlock`. Then narrow the type import back to:

```ts
import type { Confidence } from "../types";
```

and delete the `import { canonicalAsn } from "./geokit";` line. `summary.ts` keeps `providerLabel`, `countryCodeOf`, `CountrySummary`, `summarizeCountries`, `SameCountryText`, `sameCountryText`, `sameCountrySentence`.

- [ ] **Step 2: Delete the copyBlock tests**

Remove from `lib/ti/geo/summary.test.ts` the entire `describe("copyBlock", ...)` block, the `netRow` helper above it, and `copyBlock` from the `./summary` import, plus the now-unused `import type { Confidence } from "../types";`.

- [ ] **Step 3: Run the suite to confirm nothing else depended on copyBlock**

Run: `npx vitest run lib/ti/geo/`
Expected: PASS. If `BulkGeoResults.tsx` still imports `copyBlock`, typecheck fails in Step 6; that is expected until Step 4.

- [ ] **Step 4: Rewrite the component's copy panel**

In `components/BulkGeoResults.tsx`, change the summary import to:

```ts
import { sameCountrySentence, sameCountryText, summarizeCountries } from "@/lib/ti/geo/summary";
import { analystNote, analystNotes } from "@/lib/ti/geo/note";
```

Replace the whole `CopyableList` function with:

```tsx
/** A selectable analyst note, one paragraph per address, with a copy button.
 *  The paragraphs rendered here and the text copied are the same strings. */
function AnalystNote({ rows }: { rows: GeoRow[] }) {
  const paragraphs = analystNotes(rows);
  const [copied, copy] = useCopied();
  if (!paragraphs.length) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-hand text-sm font-semibold text-muted-foreground">
          Analyst note
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Copy analyst note"
          className="font-hand -mr-1.5 gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => copy(analystNote(rows))}
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <div className="max-h-64 space-y-2 overflow-auto rounded-md border-2 border-foreground/20 bg-background/60 px-3 py-2 select-all">
        {paragraphs.map((text, i) => (
          <p
            key={rows[i].ip}
            className="font-sans text-sm leading-relaxed text-foreground/90"
          >
            {text}
          </p>
        ))}
      </div>
    </div>
  );
}
```

Then update the call site inside `BulkGeoResults`, replacing `<CopyableList rows={rows} />` with:

```tsx
        <AnalystNote rows={rows} />
```

The `key={rows[i].ip}` is safe: `analystNotes` returns exactly one paragraph per row in row order, and the caller (`extractIps`) dedupes.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors outside the pre-existing ones in `ds-bundle/`.

- [ ] **Step 7: Verify in the browser**

The user already runs `next dev` on port 3000 behind ngrok. **Do not kill it**, reuse it. Paste a batch mixing a clean address, a contested one, and a hosting-flagged one, for example `8.8.8.8, 1.1.1.1, 45.33.32.156`. Confirm:

- one paragraph per address, in the order typed,
- the contested address (1.1.1.1, whose country providers disagree on) carries both the hedged verb and the dissent sentence,
- ASN appears once, with the org in parentheses, and no `AS13335 Cloudflare, Inc. (Cloudflare, Inc.)`,
- clicking Copy yields exactly the paragraphs shown, blank-line separated.

Read the result critically. Tests cannot prove that up to six sentences per address across a large batch is readable rather than a wall of text. **If it reads as a wall, say so plainly rather than declaring success.**

- [ ] **Step 8: Commit**

```bash
git add lib/ti/geo/summary.ts lib/ti/geo/summary.test.ts components/BulkGeoResults.tsx
git commit -m "feat(ui): replace bulk geo copy block with an analyst note"
```

---

## Self-Review

**Spec coverage.** Module and exports, Task 1. Grammar: location/city/region/attribution/dissent in Task 1; network, PTR, coordinates, flags in Task 2; unlocated rows in Task 1. Component, Task 3. Deletions of `copyBlock` and its tests, Task 3. Error handling maps to Task 1's error/no-country branches and Task 2's `Number.isFinite` guard. Non-goals restated as Global Constraints.

**Type consistency.** `analystNotes(rows: GeoRow[]): string[]` and `analystNote(rows: GeoRow[]): string` are defined in Task 1 and consumed unchanged in Task 3. `joinAnd` and `labelled` are defined once, in Task 1, and reused by Task 2's `flagsClause`. `GeoFlags` matches `lib/ti/types.ts:185`. `providerLabel` and `countryCodeOf` keep the signatures they were given in the previous plan.

**Comma style.** `joinAnd` produces `a, b and c` with no Oxford comma, and every list in the note (providers, flags) goes through it, so the two never diverge. The spec's flags example is corrected to match.
