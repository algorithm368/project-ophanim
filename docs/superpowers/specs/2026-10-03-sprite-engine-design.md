# Sprite engine v2: a 32×32 toned, part-composed, seeded bestiary

Status: 2026-10-03. Design agreed in conversation; open calls were delegated
("plan and do like a pro") and are resolved here, marked **[decided]**.

Related: `2026-09-13-bestiary-panel-design.md` (the sprite is the panel's focal
point at 128px), memories on the sprite body redesign (head-dominant,
symbol-must-dominate, verify on real PNGs).

## Why

`lib/ti/sprite.ts` draws one hand-made 1-bit 16×16 grid per class (nine of
them) plus a horns overlay. Three things it cannot do:

1. **Expressiveness.** At 16×16 a body's interior is about 10×6 pixels: two
   eyes and nothing else. One tone means no depth.
2. **Composition.** Every variant is a whole hand drawing, so the parked
   malware-type bodies and anything beyond horns cost a full redraw each.
3. **Identity.** Two different hosting IPs draw identically.

And the roster is lopsided: an IP picks from seven bodies, a domain and a hash
from one each, though both have many kinds.

## Decisions from the conversation

- Variation model: **siblings.** The silhouette is fixed per class; the seed
  varies only the interior (eyes, mouth, marking). You recognise the class
  instantly and tell two of a class apart on a second look.
- Canvas: **32×32**, rendered at 128px in the panel (4px per pixel), with a
  **16px silhouette test** so the class still reads small.
- Body precedence for a malicious file or domain: **threat wins**, same as
  IPs today (option a). **[decided]** Consistency across the three IOC types
  beats a second encoding; the format still shows in the record text.

## The #37 rule still governs

`subject-record.test.ts` pins that the sprite must not change shape because an
API key was or wasn't set that day. **[decided]** Every new body is selected only
from free-backed evidence. Consequences:

- Domain identity bodies are all reachable: Tranco, RDAP age, DNS (NXDOMAIN,
  MX/A) are free.
- File format comes almost entirely from key-gated sources (VirusTotal,
  MalwareBazaar, Hybrid Analysis, Kaspersky). Only Maltiverse (free) reports
  `fileType`, plus a file-name extension from a free source (hashlookup's NSRL
  record, Maltiverse's name). When neither answers, the hash draws the generic
  `file` body. Coverage of the format bodies will therefore be partial, and that
  is the honest price of the rule.
- Threat bodies come only from threat claims backed by a free source, same
  guard style as `backedByFreeSource`.

## Roster: 23 bodies **[decided]**

| Group | Body | Selected when | Signature token (must dominate the silhouette) |
|---|---|---|---|
| IP identity | `hosting` | datacentre / named cloud | flat-top golem |
| | `residential` | ISP, corporate egress | steep roof, door notch in the base |
| | `mobile` | carrier network | wide bat ears, tapers to a point |
| | `unknown` | type unresolved | scalloped, ill-defined hem |
| Domain identity | `site` | domain default | map pin, the only body that narrows to a point at the base |
| | `landmark` | Tranco vouched (popular) | tower / monolith, tallest silhouette in the set |
| | `hatchling` | registered < 30 days | cracked eggshell lower half |
| | `husk` | NXDOMAIN | hollow, broken outline, mostly void |
| | `courier` | MX but no A/AAAA (mail only) | envelope flap folded into the head |
| File identity | `file` | hash default | jar: lid, pinched neck, wide body (the only waist) |
| | `exe` | PE / Windows executable | armoured, square shoulders, window-pane plating |
| | `elf` | ELF / Linux binary | pointed ears (a literal elf) |
| | `apk` | Android package | rounded dome with two antennae, bold enough to read |
| | `doc` | PDF / Office | scroll: curled top and bottom edges |
| | `script` | PS1 / JS / VBS / shell | serpent, coiled S body |
| | `archive` | ZIP / RAR / 7z | crate with a strap band across it |
| Threat | `scanner` | scanner | one huge nested aperture eye |
| | `c2` | C2 / botnet | walker on braced legs, ears |
| | `anonymizer` | VPN / proxy | chibi Fawkes mask: brimmed hat, goatee chin, pinned curled moustache that follows the mood |
| | `tor` | Tor relay or exit, from the Tor project's list | the onion: sprouting tuft, round bulb with layer arcs down each flank, root fringe |
| | `phishing` | phishing | anglerfish lure arcing over the head |
| | `spam` | spam | many-mouthed, swarm of small bodies |
| | `malware` | malware / trojan / stealer | horse-head silhouette (trojan) |
| | `ransomware` | ransomware | padlock shackle as the crown |

The tokens are starting concepts for the art pass, not locked art: each must
pass the real-PNG checks below, and any token that fails gets redesigned rather
than shipped.

Precedence in `spriteFor`, unchanged in shape: named provider (IP only) >
threat body > identity body > the type's default.

## House style (added 2026-10-03, after the first art pass)

The first pass was drawn by three workers with no shared rules, and the set did
not read as one family: some bodies were detailed at 1px, others flat blocks;
some dark, some mid-tone, one outline-only; shading in different directions;
different heights and eye lines. The user picked **the anonymizer** as the
reference style. Its rules, each enforced by a test in `sprite.test.ts`
("house style"):

1. **Round silhouette** (revised 2026-10-04, replacing "chunky"). Bodies are
   soft, rounded shapes, so the outline may step at 1px; a curve needs that to
   read as a curve at 32. No edge pixel may hang off the body on a single
   neighbour. Faces are minimal: no seeded mark (every body pins `mark: null`
   except the scanner, whose plate has nothing else to vary), and a pair of
   `=` blush cells under the eyes.
2. **Dark body.** Every ink pixel touching the outside is `#`, and at least 55%
   of the body's ink is `#`. Secondary token detail on the body uses `=`.
3. **Face plate.** One light plate of `-` (with an optional `=` rim) holds the
   face, at least 60 pixels. Every eye, mouth and mark placement paints only on
   plate cells (`-` or `=`), never on the dark body, which is what makes the
   seeded faces readable.
4. **Shared footing.** The lowest ink row is 29 for every body, the top within
   rows 0 to 6, and the eye line between rows 11 and 15, so creatures stand on
   one floor and look out at one height in the bestiary.
5. **Detail budget.** One signature token plus at most one secondary detail. No
   texture, dither, or pattern fill.

## Engine

### Grid format
ASCII stays (reviewable diffs). 32 rows of 32 characters:

| Char | Meaning |
|---|---|
| `.` | transparent |
| `#` | ink, 100% of `currentColor` |
| `=` | mid tone, 55% |
| `-` | low tone, 25% |
| `o` | knockout: clears whatever is below (parts only, for cut-in eyes) |

All tones are opacity steps of `currentColor`, so the monochrome skin holds and
the verdict still owns the hue.

### Body definition
```ts
type BodyDef = {
  grid: string[];            // 32×32, no `o`
  anchors: { eyes: Pt; mouth?: Pt; mark?: Pt };
  fixed?: Partial<Record<Slot, PartKey>>; // a slot the token owns, e.g. scanner's eye
};
```

### Parts (the sibling slots)
`eyes` (≥ 6 variants), `mouth` (≥ 5 plus none), `mark` (≥ 5 plus none). A part
is a small grid drawn centred on its anchor; eyes are drawn as a mirrored pair.
Parts may only paint inside the body's existing ink (they recolour or knock out
pixels and never grow the silhouette), which is what keeps them siblings.

### Seed
`seed = fnv1a32(normalized indicator)`, where the indicator is lowercased and
refanged. Slot indices come from distinct bit ranges of the seed. The function
is pure and stable across deploys, because the part lists are append-only.
Reordering a part list re-rolls every creature, and a test pins a few known
seeds to catch it.

### Composition
body → mark → mouth → eyes → horns (if flagged). Horns move to the 32 grid and
stay additive, painted only in the reserved horn zone (top four rows, outer
eight columns each side).

### Render
`toRects` becomes per-tone horizontal runs. The SVG gets one `<g>` per tone with
`fill-opacity`, plus `shape-rendering="crispEdges"`. The SVG still inlines and
still uses no assets.

### API
```ts
type SpriteSpec = { body: BodyKey; flagged: boolean; seed: number };
```
`spriteRects` becomes `spriteLayers(spec): { opacity: number; rects: Rect[] }[]`.

## Tests (lib/ti/sprite.test.ts and subject-record.test.ts)

- Every body is 32×32 with valid chars; the horn zone is clear.
- Parts never paint outside the body's ink. Fuzzed over 500 seeds × every body.
- **16px silhouette test:** downsample each body 2×2 (a cell counts as ink if
  any of its pixels is ink) and require a pairwise Hamming distance of at least
  12 between every two bodies, so no two classes collapse together at icon size.
- Determinism: the same seed gives the same layers; pinned golden seeds.
- Variety: 64 seeds produce at least 16 distinct interiors per body (except
  slots a body fixes).
- Selection: one test per new body route, plus the existing #37 test extended
  to domain and hash (strip key-gated sources and get the same body).

## Verification

`scripts/sprites.mjs` renders a contact sheet: every body × 4 seeds × flagged,
at 128 / 64 / 32 / 16px, in both themes. Every art iteration is judged on that
PNG, not on the ASCII. The panel is checked on `/check` with a production build
(see CLAUDE.md "Verifying changes").

## Execution

1. Engine core, part libraries skeleton, the old nine bodies upscaled 2× as
   placeholders, tests, contact sheet. (coordinator)
2. In parallel, each worker owning its own files: IP + network-threat art,
   domain art, file art, the parts library, selection logic.
3. Integration, review, full verification, contact sheet to the user.

## Out of scope

`frontdoor` (needs an infra-ladder change, not art); animation; a `/bestiary`
index; a small-size render mode (the 16px test guards the silhouette, and no
small render exists yet).
