# Loading UX

A lookup takes as long as it takes. What the app controls is what an analyst
sees while it happens, and today the answer is: not much, then everything at
once.

Four moments were named as annoying in practice, and they turn out to be three
different failures wearing the same coat.

## The four moments

**Clicking a permalink does nothing for a while.** `app/check/[ioc]/page.tsx`
and `app/scan/[indicator]/page.tsx` are async server components that `await` a
Redis read before returning any HTML. There is no `loading.tsx` and no
`Suspense` anywhere in the app, so the router holds the old page on screen until
the entire server render finishes, cold start included. Nothing says a
navigation is even in progress.

**The result arrives in one lump.** `components/Checker.tsx:1011` gates the
whole result behind `!loading && result`. Every source settles individually and
the client already holds each one, but none of it renders. When the last source
lands, the progress card is thrown away and a full page of results replaces it.

**The active scan looks frozen.** This one was misdiagnosed at first. The scan
page already renders each target as it finishes (`merged.map`) and already says
a scan takes about thirty seconds. The real problem is `POLL_MS = 6000`: a
target that finished at second 1 is not shown until second 6. On a thirty second
job that is up to a fifth of the wait spent looking at a screen that has already
gone stale.

**Sub-cards land at different times.** A consequence of the second failure
rather than a separate one, and it is what makes the lump-arrival feel worse
than a plain wait would.

## What this is not

No optimistic score. No change to `aggregateRisk()`, `verdictFor()`, the API
response shape, or the cache schema. No attempt to make the sources themselves
faster; the fan-out is bounded by the slowest external service and that is not
ours to fix. The prefetch-on-hover work already landed separately.

## The rule that governs everything

One line decides what may appear before a lookup is complete:

> **What a single source observed on its own may show immediately.**
> **What requires every source to be counted must wait.**

Shown while streaming: geolocation, ASN, the listings that came back, categories,
the per-source rows, and the answered/adverse/clean counts.

Withheld until complete: the score, the verdict word, confidence, the rationale,
the threat type, and the borderline flag. Everything, in other words, that comes
out of `aggregateRisk()`.

### The denominator problem

The counts sit on the permissive side of that line and they carry a real risk.
Five of twenty-two sources in, three of them adverse, reads as "3 adverse" to
anyone glancing at it. That looks alarming. The same three out of a finished
twenty-two is mild. The numerator is what the eye takes first.

So a count shown mid-stream is never allowed to appear alone. It reads
`3 / 5 answered, 17 still out`, with the outstanding figure carried at the same
weight as the count. When the lookup completes the phrasing collapses back to
the normal strip.

## Layer 1: first paint never waits on Redis

Two mechanisms, because they cover different windows.

| Mechanism | Covers | Can show the indicator |
| --- | --- | --- |
| `loading.tsx` | From the click until the server responds; it is prefetched | No |
| `<Suspense>` in `page.tsx` | While the server reads Redis | Yes |

`loading.js` is documented as accepting no parameters
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`),
which is why it cannot name the indicator and why the in-page boundary is worth
having as well.

`page.tsx` awaits `params` only, which is cheap, and returns the shell
immediately. The `await fetchCached` moves into an async child wrapped in
`Suspense`.

**The fallback must not be another `<Checker>`.** A `Checker` given an
`initialQuery` and no `initialResult` starts a live lookup on mount. Used as a
fallback it would fire a request that is then discarded the moment the cached
result arrives, turning one navigation into two lookups. The fallback is an
inert shell that only looks like the real thing.

Both mechanisms render the same skeleton component, differing only in whether an
indicator is passed. Two hand-maintained skeletons would drift, and a skeleton
that no longer matches the page it stands in for is worse than none.

`generateMetadata` is not a factor. Streaming metadata is on by default, so it
does not block the initial UI for ordinary browsers; only HTML-limited bots wait
on it.

## Layer 2: evidence flows, the score does not

The result shell renders from the moment a lookup starts. `VerdictHero` is born
in a pending state, and the progress bar and source counter occupy the slot the
score will later fill. This is the whole point: the progress readout is not a
separate card that gets discarded, it is the score's placeholder. When the
lookup completes the number lands in the space that was being held for it.

### What the mockup settled

A working mockup of the hero, played against a simulated source timeline, fixed
three things the prose had left open.

**The risk meter and the progress bar are the same element.** `VerdictHero`
already draws a `h-1.5 rounded-full` meter whose fill is the score. Streaming
fills it by progress instead, and completion fills it by score. There is no
second bar and no swap, which is a stronger version of the intent than the two
elements the design first assumed.

**The threat-type slot is reserved from the first frame.** The verdict word
itself is not the thing that jumps; the words vary in length anyway
(`CLEAN` against `SUSPICIOUS`) so no fixed width would help. What actually
reflows the row is `· TOR EXIT` appearing beside the verdict at the end. A
held slot of fixed minimum width, carrying a skeleton while streaming, removes
the reflow at its real cause.

**A single-line dot strip lives under the meter, permanently.** Which sources
have answered is the most wanted thing on screen while waiting, and
`SourceBreakdown` sits at the bottom of the page where it cannot serve that.
Moving it up during streaming and back down at the end would violate the rule
against shifting content. One row of small dots, one per source, directly under
the meter resolves the conflict: it is present in both phases, so nothing moves,
and it does not duplicate `SourceBreakdown`, which carries per-source scores and
summaries rather than liveness. Each dot names its source on hover.

Two new units:

**`lib/ti/partial.ts`** builds a partial result from the settled sources, using
the existing `mergeFields` and `computeStats`. All three are pure, so this runs
in the browser and is testable without a network. It also owns the withholding
rule: in the streaming phase it must not emit a score or a verdict at all, so
the rule is enforced by the type rather than by every call site remembering.

**`components/CheckResults/pending.tsx`** is the pending hero.

`Checker.tsx:1011` stops gating on completion and passes a `phase` instead.

### Empty states lie while streaming

This is the real cost of the approach and it was missed on the first pass. The
cards already say things like:

- `research.tsx:451`, "Nothing found"
- `sources.tsx:94`, "No data"
- `profile.tsx:316`, "No registration or DNS context was returned for this domain."

Every one of those is correct when a lookup is finished and false while it is
running. The truth mid-stream is "not asked yet", and for a threat-intel tool
the difference matters: "not found in passive DNS" is a finding an analyst acts
on. Rendering it before the question has been asked is worse than rendering
nothing.

The fix is narrow because the cards already tolerate missing data. A source that
errors or lacks a key produces the same shape as a source that has not answered
yet, so a partial result is shape-identical to a complete one with many sources
down. Only the empty-state branch needs to know the difference: given
`streaming`, it renders a skeleton instead of its "nothing here" copy. That is
roughly ten small edits, not a rewrite of `CheckResults/`, which is 5,146 lines
across 21 files.

## Layer 3: the remaining two

**Adaptive polling on the scan page.** The interval widens with the age of the
scan, not with the number of polls taken: about 1.5s for the first ten seconds,
then stepping out toward the present 6s as the job passes the thirty seconds it
usually needs. Most targets finish early, so a tight interval late is paid for
and wasted. The scan page also borrows the progress affordance `SearchProgress`
already has: a bar, a countdown, and a dot per target. `ScanStatus` is
`running | done | error`, which is exactly enough to color a dot.

**Reserved space for sections.** The section list per IOC type is already known
ahead of time (`IP_SECTIONS`, `DOMAIN_SECTIONS`, `URL_SECTIONS`), so the page
can hold the right number of slots from the start and not shift under a cursor.
Space is reserved for sections, which are known, and not for rows inside a card,
which are not; reserving everything would open on a full screen of skeleton that
reads as a broken app.

## Testing

`lib/ti/partial.ts` is pure and carries the load: what context a half-answered
panel produces, whether the counts are right, and above all that no score or
verdict escapes during the streaming phase. It lives in `lib/`, so it is inside
the vitest coverage scope and answers the Sonar new-code gate.

The visual claims, that the skeleton does not jump and the transition has no
seam, cannot be tested automatically. They need a browser and the Playwright
helpers in `scripts/`. If that check does not happen, the work says so rather
than implying it was verified.

## Summary

| Layer | Fixes | Main files |
| --- | --- | --- |
| 1 | Permalink shows nothing | `loading.tsx` ×2, `page.tsx` ×2, one shared skeleton |
| 2 | Result arrives in a lump | `lib/ti/partial.ts` (new), `pending.tsx` (new), `Checker.tsx`, ~10 empty-state branches |
| 3 | Stale scan polling, uneven cards | `ScanReport/index.tsx`, `CheckResults/index.tsx` |

Each layer ships on its own. Layer 1 is worth having even if the others never
happen.
