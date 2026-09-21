# The bestiary entry: reading /check as a monster manual page

Status: 2026-09-13. Sections 1 to 5 are settled against rendered mocks and are
now **built** on `active-scan-subject-record`, uncommitted:

- `lib/ti/panel.ts` + test, the five stats and their rungs.
- `lib/ti/caveats.ts` + test, the lines that qualify a verdict.
- `components/CheckResults/panel.tsx`, the panel, the summary row and the score
  section as one card.
- `components/CheckResults/verdict.tsx` keeps `VERDICT_STYLE` and `SourceDots`;
  the hero and its helpers are deleted, about 480 lines.

The detail stack below the panel (Record, DNS, Related, Research, Scan as one
ruled document rather than five cards) is designed and rendered but **not**
written up here and not built. Open decisions are listed at the end.

Related: `2026-06-10-monochrome-formal-redesign-design.md` (the skin this does
not override), `2026-09-11-score-semantics-design.md` (the tier ladder this
borrows a vocabulary from), `2026-09-05-subject-record-rap-sheet-design.md`
(the record rows this sits above).

## The ask

Make `/check/<ioc>` understood by looking. Text becomes supporting detail rather
than the lead. The chosen frame is a **bestiary entry**, a monster manual page
for one indicator, which was picked over a battle HUD, a status sheet and a
trading card because it is the only one of the four that is a reference document
rather than a live readout, and a threat lookup is a reference document.

The sprite in `lib/ti/sprite.ts` already does this for identity. This extends the
same reasoning to the rest of the page.

## What the frame does and does not change

Settled in interview, eleven decisions:

1. The archetype is a bestiary entry.
2. It becomes a **real book**. A new `/bestiary` index lists every indicator
   ever checked, sprites in a grid, click through to an entry. No collecting,
   no rarity, no "new species" gamification.
3. The skin stays **monochrome minimal**. No palette, no pixel font, no added
   chrome. The game feel comes from layout and encoding only.
4. Five stat bars, a full RPG panel.
5. Slots 1 to 4 are shared across IOC types, slot 5 varies by type (IP:
   Exposure, domain: Tenure, hash: Detection). An absent reading is reserved for
   a genuine measurement miss and never means "not applicable to this type".
6. The panel replaces the hero. Sources becomes a picture. The other seven cards
   are untouched.
7. The sprite is the focal point. The verdict word drops to a tag beneath it.
8. Bars are **named rungs**, not a 0 to 100 scale.
9. Motion only while streaming. No idle animation, which would need a second
   frame drawn for all nine bodies.
10. Build this without waiting on score semantics. Evidence uses
    `scoreConfidence` as a stand-in and swaps to `AssertionTier` when stage 2 of
    that spec lands.
11. The book is one shared volume for the whole Workspace, matching how
    `ti:hist:` and the cache are already keyed.

**The bars have four rungs, not five.** `aggregate.ts` freezes four verdict
bands and the adverse half of the assertion ladder is also four (`observed`,
`reported`, `attributed`, `confirmed`). The other three tiers (`none`,
`no-record`, `vouched`) are different in kind and cannot be stacked on that
ladder. Five would have meant inventing a rung.

## 1. The panel

- **Rail portrait.** The left column runs full bleed to the panel edges with one
  divider, so both columns share a top and bottom line. The bracket frame stays,
  because it reads as an evidence crop rather than an illustration.
- **Ladders.** Rank is a 12px vertical ladder to the left of each stat, lit from
  the bottom. Unlit rungs are outlined rather than greyed, so the reader can see
  that a higher rung exists, which matters because the rungs are named. 4px was
  tried and is unreadable. 8px is the floor.
- **An absence draws hatched.** No-record fills every rung with a diagonal
  hatch. A measured zero draws as plain outlined rungs. These must never look
  alike, which is the panel's load-bearing constraint.
- Colour appears on the sprite, the verdict tag, and the Threat row only.

## 2. The verdict

**The verdict leaves the stat grid.** It was being stated twice in two
vocabularies: once as the tag under the sprite, once as slot 1 (`Threat /
High`). Those are the same four bands, since `RISK_LEVEL` in `verdict.tsx` is a
rename of what `verdictFor` already decided. One claim said twice, worded
differently each time, is worse than saying it twice the same way.

A verdict is also not a stat. It is what the stats add up to, and listing a total
beside its own addends is a category error. A monster manual puts the danger
rating in the header and the attributes in the table underneath.

So: the tag under the sprite is the only statement of the verdict, and it carries
the word plus a flat four rung ladder so it speaks the stats' language. **Slot 1
is therefore free**, which is open question 1 below.

### The three caveats have to be drawn

`aggregateRisk` records `borderline`, `uncorroborated` and `allowlistSuppressed`
and the page shows none of them except behind the details toggle.

A `CLEAN` that is clean because nobody listed it, and a `CLEAN` that survived a
real authoritative listing because two sources vouched over the top of it, are
not the same animal. They render identically today. Likewise a score that
reached the malicious band but was held one band down because only one source
flagged it.

Placement is open question 2. The head bar is the candidate, because a tag can
appear and vanish there without reflowing anything.

### Mid-scan

While sources are still answering there is no verdict, so the rail must not imply
one. The sprite stays neutral grey and uses the `unknown` body until a class is
actually known, and the tag reads as a hold rather than a judgement. Mid-scan and
no-record both draw hatched and are separated by motion alone, per decision 9.
That separation needs confirming before implementation.

## 3. The summary row

The narrative paragraph, its copy button, and the meta row travel together and
lost their home when the hero went away.

**Placement:** a third full width row inside the panel, under both columns. Prose
on the left, a provenance corner on the right.

Lifting the meta into the head bar was considered and rejected, because it costs
`Entry №044`, which becomes a real coordinate once `/bestiary` exists.

### The right corner leads with freshness

The corner holds four facts and used to hold three actions. It is now:

- **`6h ago` set at 22px** under a `CHECKED` label, then `from cache, expires in
  18m`, then a rule, then `Signals` and `Priors` as small pairs.
- The timestamp leads because it is the only fact in this corner that decays.
  Signals and Priors both have a card of their own elsewhere, so they belong in
  a footnote rather than in a column of four equal rows.
- `expires in 18m` is new. It is the fact that actually answers the question the
  corner exists to answer, which is whether to press fetch fresh.

### The details link is gone

The corner used to carry `details, 24 signals`. The disclosure card below the
panel has its own header, so the link was a second control for one thing. Losing
it also leaves the corner with exactly two actions, which is what made the rest
of this section possible.

### The paragraph is the copy button

The whole summary box is the click target, not just a glyph.

- The box **fills the cell in both directions**, so the click target is the
  entire left half and the two halves share a bottom edge. The measure widens
  from about 62 to about 77 characters, which is past the comfortable range for
  long reading and fine for a paragraph this short.
- A **corner mark in the bottom left** carries the icon, the word on hover, and
  the tick once copied. Bottom left rather than bottom right because the corner
  nearest the divider puts `COPY` about 250px from `FETCH FRESH` on the same
  line, and bottom left puts the width of the cell between them.
- The paragraph **reserves a 26px band** for the mark. Without it the mark lands
  on the last line the moment the box is only as tall as its text, which is
  every phone, since there the corner block sits below and nothing stretches the
  box. This band is the standing cost of a corner mark.

Four states, and each one is load bearing:

| state | what it does |
| --- | --- |
| rest | plain paragraph, muted mark in the corner |
| hover | whole box tints, mark gains the word `COPY` |
| copied | icon becomes a tick, reads `COPIED`, tint held about 1.5s |
| selecting | no tint, no word, text cursor: dragging must never copy |

Three rules the interaction forced:

1. **A drag that ends inside the box is a selection, not a press.** If it copied,
   the summary would stop being readable text.
2. **A mouse click must not leave a focus ring.** The box hooks
   `:has(.cp:focus-visible)`, not `:focus-within`.
3. **The mark stays a real `<button>`** with a label, owning focus and Enter. The
   box click is a convenience on top of it, never a replacement, because a `div`
   with a click handler does not exist for a keyboard or a screen reader.

### Fetch fresh is the other half of the split

Copy and fetch must not be neighbours: copy is free, fetch re-runs the whole fan
out. They are separated two ways, because distance alone still lets a stray click
land.

- **By position:** copy in the bottom left of the prose, fetch pinned to the foot
  of the freshness column, directly under `expires in 18m`.
- **By weight:** fetch is a bordered button, copy is borderless text. The
  consequential one is the one with an edge.

## 4. The details disclosure

This section was designed twice, and the first attempt is worth recording
because it failed for a reason that generalises.

**Five ledger layouts were drawn and all five were wrong.** They showed the
values of the arithmetic and never the mechanism. `strongest 100 ×60%` means
something only to a reader who already knows the formula, which is the opposite
of the brief. The second attempt asks what picture answers the question instead.

**Body:** every detector as a row, two columns, name plus a mark on a shared
0 to 100 track plus its score, sorted loudest first. No prose at all, one mono
voice throughout. Reading down the column of marks shows the outlier structure
directly: on a floor-pinned address one mark sits hard right and the rest are
bunched left, and that gap is the whole story of the score. A source that did not
answer keeps the hatched track, so a gap in the evidence cannot read as evidence.

**Foot:** coverage and agreement on the left as label, value and flat ladder,
with confidence pushed to the right edge and set large. The asymmetry makes the
foot read as a summary rather than a third slab of equal weight facts.

### Confidence stops being one word

`scoreConfidence` returns `coverage` and `agreement` as deliberately independent
axes, and the UI collapses both into a tier plus a tooltip.

Wide coverage with low agreement means everyone looked and they disagree. Narrow
coverage with high agreement means the two sources that answered happened to
concur. Both render `medium` today, and telling those apart is the entire reason
the function exists, as its own header comment argues from 103.83.237.2 against
WannaCry.

Both axes now get a named four rung ladder.

**Open detail:** the chosen foot carries no detail line, so `11 of 12 answered`
and `one at 100, rest under 40` live on hover only. The detector table above
does show both if read. If that turns out to be too thin, the fix is one mono
line under the two ladders, which does not disturb the anchoring.

**Naming caveat:** the rung names used in the mocks (`Most`, `Split`) are
placeholders. The real bands must come from the cutoffs already in
`confidence.ts`, which are three for agreement and not four, so the mapping needs
resolving rather than assuming.

## 5. Changes after the page was assembled

Drawing the whole page moved several things that reading the sections alone had
left in place.

- **The head bar is down to `№044`.** The caveat tag that lived at its right is
  gone. An alternative with no bar at all, the number riding the right end of the
  subject line, is drawn and open.
- **The rail runs sprite first, verdict under it**, ruled off and flush with the
  bottom edge of the panel body. The verdict led the rail briefly and was moved
  back: the picture is the focal point, and the word is what the picture resolves
  to.
- **The score section joined the panel.** It is no longer a card floating 16px
  below with its own border and shadow. The working belongs to the entry it
  explains, and a separate card implied it was optional.
- **The score section is no longer collapsible.** No toggle, no chevron, always
  open. A disclosure implied the reader had to ask for the reasoning, which is
  backwards for a page whose whole argument is that the score must be legible.
- **Headings are one word.** `SCORE` replaced both `How this score was reached`
  and `Every detector, loudest first`, since the table immediately under the
  heading already says what it is. `SCORE` and `SOURCES` share one size and
  weight so they read as sibling sections rather than card and sub-card.
- **The Sources picture is parked.** Removed from the page for now, and the flat
  against grouped comparison is parked with it, since that decision only existed
  to settle that card. Both rendered versions and the argument stay in this spec.

### Open, from this pass

- **The three caveats have no home.** They left the head bar with the tag. The
  candidate is directly under the verdict in the rail, where a caveat sits
  beneath the claim it qualifies.
- **`Signals 24` against twelve detector rows.** The corner counts every source,
  the score table lists only the twelve that carry weight, and the card that
  explained the difference is the one we just parked. Either the corner says 12,
  or the gap needs to be stated somewhere.
- **Head bar or no head bar.**

## Rejected, with reasons

Do not re-propose these without new information.

- **A continuous fill bar, and the label inside the bar.** A filled width reads
  as a quantity and reintroduces the false precision that removing the 0 to 100
  number was meant to kill.
- **Rungs stretched to a column's full width.** The same failure in a milder
  form, hit twice: once in the details ladders and again in a foot variant that
  reused the detector table's track column. Four rungs that wide stop reading as
  four rungs and become a meter. Ladders are capped at about 172px.
- **A radar chart.** Looked the most game-like and carried the least
  information.
- **The score joined to a two column table.** Nothing can share an axis with two
  columns at once, so the score's mark did not line up with the detectors' marks,
  which was the only reason to put it there.
- **A caveat column beside the prose.** The best use of that space when a caveat
  exists, but most results have none, so the column collapses and the layout has
  to be designed twice.
- **Prose inside the detector table.** Two paragraphs of sans-serif landing on
  a mono, aligned readout. Everything the prose said now lives in the marks, in
  one mono caption, or on hover.
- **A bare dotted line for an absence** (reads as a render failure), **dashed
  rungs** (too close to solid at 12px), **a strike-through** (too faint at 1px,
  too loud at any weight that shows).
- **The copy mark in the top right of the paragraph.** It lands on the first
  line. Positioning a mark over a paragraph only works where the text is not.
- **The mark floated into the text.** Collision proof, but it notches the first
  two lines into a ragged edge.
- **The box full width with the text held at 62ch.** Buys the ideal line length
  and pays with a band of empty tinted space holding a stranded mark, which is
  the original dead space wearing a tint.
- **Fetch fresh as a dotted link on the expiry line.** Quietest, and the easiest
  thing on the page to press by accident. An action that re-runs the fan out
  needs an edge.
- **Both actions stacked together in the corner.** What the row had. One press
  is free and the other is not, and neighbours invite the wrong one.

## Still open

1. **What fills freed stat slot 1.** Reach was the candidate and the full page
   render argues against it, see finding 1 below. The live options are `Priors`
   and dropping to four bars, which contradicts decision 4 but invents nothing
   and makes the phone layout a clean 2 by 2.
2. **How the panel draws a tier that is not on the adverse ladder**, meaning
   `none`, `no-record` and `vouched`. See finding 2 below.
3. **Where the three caveats render.** The head bar held a caveat tag through
   the full page render without disturbing anything, so this is close to
   settled.
4. **The Sources grid: flat or grouped.** One flat run of 24 marks sorted
   flagged first, against grouping by the five categories that already exist in
   the code. Flat gives one count and the strongest glance. Grouped loses the
   single count and gains the ability to see that five flags came from
   blocklists rather than from context sources, which is a much stronger claim.
   Both were rendered in the full page pass, and grouped carries the heavier
   sentence, since `Blocklist, 3 of 4 flagged` says far more than `5 flagged`
   across everything.

After those, two sections of this design remain unwritten: the `/bestiary` index
itself (a new Redis sorted set, the route, ordering, retention) and the file and
test plan, including the Sonar new code coverage gate at 80% on changed lines.

## Verification so far

Every layout above was rendered as real HTML at 1080px in both themes and read
as a PNG before it was chosen, rather than reasoned about in the abstract. That
process is what caught the full width rung ladders, the colliding plot layers,
and the two-column alignment failure, none of which were visible in the markup.

The whole page has since been assembled from these parts and rendered at 1080px
and 390px, in both themes, for a malicious IP and for a clean domain. That pass
found four things no single section could:

1. **Reach is Coverage under another name.** The candidate for the freed slot
   says `11 sources hold a record`, Consensus two cells away says `5 of 11
   flagged`, and the details foot says Coverage. Three elements, one fact.
   Alternatives drawn: `Priors`, the only axis that is about the indicator over
   time rather than about the sources, and four bars.
2. **The adverse ladder cannot say `vouched`.** A clean domain reads
   `Evidence / Vouched` above a four rung adverse ladder, so lighting one rung
   says slightly malicious. Drawing zero rungs is a patch. The three tiers that
   are different in kind need their own mark.
3. **`0 of 6 flagged` is a lie about context sources.** They carry weight 0 and
   cannot flag anything. That group reads `6 answered, no verdict`.
4. **Two narrow width failures**, both fixed: the verdict ladder stretched to
   350px and became a meter again, and the caveat tags right aligned into a
   ragged staircase.

The summary row in section 3 was rendered at both widths through every state,
which is what caught the corner mark landing on the last line of the paragraph
on a phone.
