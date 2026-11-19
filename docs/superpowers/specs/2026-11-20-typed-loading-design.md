# Typed loading: the real page, written in as the sources answer

Status: 2026-11-20. Option A of four animated mocks (teletype, wires, write
head, decode), chosen in conversation. Scope is `/check` for all three IOC
types; `/scan` keeps its own shell for now.

Related: `2026-09-13-bestiary-panel-design.md` (the frame and its tiles),
commit `6ac54ff` (the roll call this replaces).

## Why

The pending state has been two different things. First it was the finished
page painted grey, every tile at its final span, which held the layout still at
the cost of fifteen seconds of placeholder bars with every real answer kept off
screen until the end. `6ac54ff` replaced it with a roll call: one list of every
source, what it said, how long it took. That is honest, but it is a different
page, so the whole screen is swapped out when the last source lands.

The ask now is a loading page that is not much different from the real one,
with motion that reads as something writing the data in. Both earlier problems
go away if the pending page *is* the real page: the same frame and tiles,
rendered from what has actually arrived, with each value typed into its slot
when its source answers.

## What makes it possible

`lib/ti/assemble.ts` is already pure and already documented as safe to run on
the client over a partial set of sources. The page can therefore render its
real tiles from `assemble*Result(indicator, settledSoFar, startedAt)` on every
streamed answer. Nothing about the server, the stream contract, or the cache
changes.

## Rules

1. **One tree, first frame to last.** The pending page and the finished page
   are the same components. A slot that is empty now and filled later is the
   same element, which is what lets its value be typed rather than swapped in.
2. **Withheld until the panel is complete** (the line `PartialLookup` already
   draws: a count is honest while incomplete, a score is not):
   - the hero's class mark and caption, and the summary paragraph,
   - the verdict colour on the rail picture,
   - every confidence level (score, location, resolution) and the score
     skyline,
   - the timeline strip.
   While withheld, the class mark is a blinking block caret and the rest are
   dotted rules.
3. **Pending is not absent.** While sources are out, a field with no value yet
   is a dotted rule, never `none published` or `unranked`. Those words are
   facts about the subject and are only true once everyone has answered, so
   they are typed in at the end like any other value.
4. **Per-source facts arrive live.** Location, network, reverse name, record
   rows, each detector's score and track, each source row's verdict and finding:
   these are one source's own observation and are shown the moment it lands.
5. **Typing only when something was actually fetched.** A value is typed when
   it appears during a lookup that streamed. A cache hit, a server-rendered
   permalink, a Back/Forward restore, and `prefers-reduced-motion` all render
   the finished page at once. The page never pretends to be loading.

## The typing

- A value types in left to right behind a solid block caret, which disappears
  when the value is complete. Every value finishes inside about a second
  however long it is: up to 40 steps of 24 ms, several characters per step for
  long text.
- A value that changes while on screen keeps the prefix it shares with the
  new value and types only the rest.
- Screen readers get the whole value at once; only the visible copy is typed.
- Tracks draw their mark from zero to the score; the timeline strip draws in
  left to right; skyline bars grow from the baseline. CSS only, and off under
  reduced motion.

## Where rows go while sources are out

- **Evidence:** every detector in the panel, in registry order, in the compact
  two column layout. A detector's score and track are typed in when it answers.
  When the panel completes the tile takes its final shape once (loud rows on
  top, the rest under "Nothing found"). That single reorder is the only
  movement on the page at the end, and it is inside one tile.
- **Source breakdown:** every source in the panel, detectors then context, in
  registry order, so the table is the roll call the old pending page was. A
  row's verdict word and finding are typed in when its source lands; rows still
  out show dotted rules. On completion the rows sort by relevance. Rows are
  keyed by source id, so React moves them rather than remounting them, and
  nothing is typed twice.
- **Provenance rail:** `Checked` shows the countdown and `n of N answered`
  until the end, then types `just now` and the timestamp. The re-check button
  is disabled while the lookup runs.

## The inert shell

`loading.tsx` and the page's Suspense fallback (`components/result-skeleton.tsx`)
render the same `CheckResults` with no result and no progress, so the shell is
the first frame of the live page: every tile at its real span, every slot a
dotted rule, the class mark a blinking caret. Nothing in it fetches. `/scan`
keeps its current shell.

## Files

- `lib/typewriter.ts`: the pace (`typingPace`) and the shared prefix
  (`sharedPrefix`), pure and tested.
- `lib/ti/panel-rows.ts`: the panel joined to whoever has answered, in
  registry order, split into detectors and context, pure and tested.
- `components/CheckResults/live.tsx`: `LiveContext` (`pending`, `typing`,
  `partial`) and the `Typed` leaf, which renders a caret, a dotted rule, or the
  value typed in.
- `components/CheckResults/index.tsx`: builds the provisional result and wraps
  the frame in `LiveContext`. The separate pending branch goes away.
- Tiles (`panel.tsx`, `readout.tsx`, `identity.tsx`, `timeline.tsx`,
  `sources.tsx`, `rail-map.tsx`): values go through `Typed`; withheld parts
  read `pending`.
- `components/Checker/index.tsx`: tracks whether this lookup streamed
  (`start` arrived) to set `typing`.
- `components/result-skeleton.tsx`: renders the live page's first frame.
- Removed: `FrameSkeleton`, the roll call, and `SourceCells`, which only the
  roll call used.

## Verification

- `bun run test`, `bun run lint`, `bun run typecheck`.
- A live lookup on a production build, screenshotted mid-stream and at the
  end, IP and domain, light and dark, at 1280.
- `scripts/verify-loading.mjs` for the shell: request count and layout shift
  across a navigation.
