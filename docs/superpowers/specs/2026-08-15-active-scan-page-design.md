# The active-scan page — design

**Date:** 2026-08-15
**Status:** Approved (design); implementation plan pending
**Tracks:** [issue #20](https://github.com/algorithm368/project-ophanim/issues/20)
**Builds on:** `2026-08-15-url-indicator-design.md` (the active lane it extends)

## Overview

A page at `/scan/<indicator>` whose subject is the active scan. An indicator is
submitted to two scanners, they visit it, and what comes back is presented as
the answer to a case question rather than as a data dump.

## Why it exists, in the owner's words

The design interview changed this feature twice, so the reasoning is recorded
before the design rather than after.

**When it gets opened.** A case has flagged an IOC. The analyst wants to know
what a phishing link *looks like*, what the detected site actually is, where an
IP ends up, and **what the page can do**.

**What gets taken away.** A verdict and an analyst note, used to close a case or
open one. The page's output is therefore not a screen, it is **a paragraph the
analyst pastes into a ticket**.

**The actual pain point.**

> ขก ไปเว็บอื่นหลายๆเว็บ, และอยากให้ ui ดูง่ายกว่าอันหลัก

Not "I want more data". "Data complete" means **complete enough not to open
another tab**, and the page must read **more easily than `/check`**. Those pull
in opposite directions, and the resolution is the whole design: the page is
complete but ordered, so the answer is at the top and the evidence is beneath it.

**Anything that makes the page harder to read is wrong, however complete it is.**
That sentence overrides everything below it.

## Goals

- One page carries the scan, the passive TI reading, and the capability
  analysis, so no second tab is needed for ordinary case work.
- The top half of the page is a copyable paragraph plus the screenshot, and many
  cases end there.
- Two scanners, merged into one reading, with disagreement stated in words.
- Every absent thing is named. An empty section never passes for an observation.

## Non-goals

- **No wireframe loading animation in this pass.** Requested and deferred by the
  owner ("wireframe เดี๋ยวค่อยทำ ทำอันที่จำเป็นก่อน"). A plain per-section
  "waiting" state ships instead. When the animation is built it must be
  announced to assistive tech, matching the `role="progressbar"` and `aria-live`
  work already done for `SearchProgress` in `Checker.tsx`.
- No replacement of `/check/<ioc>`. Triage stays there; this is the teardown.
- No removal of the inline `ActiveScanCard`. It is the entry point.
- No evidence archive. Only the latest scan is stored in full.

## The page

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ACTIVE SCAN   login-ms.xyz                                                  │
│  2 URLs sent · urlscan + Cloudflare · 15 Aug 2026, 18:42 · private           │
│  Scanned once before: 12 Aug 2026 → malicious ↗                  [ Rescan ]  │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────┐   ┌────────────────────────────────┐   │
│  │ This URL redirects once, to      │   │                                │   │
│  │ secure-login.ms-verify.top,      │   │        [ screenshot ]          │   │
│  │ which serves a page carrying a   │   │                                │   │
│  │ password field. The form posts   │   │                                │   │
│  │ to collect.ru, a different       │   │                                │   │
│  │ domain from the one shown. …     │   │                                │   │
│  │ ⧉ Copy for case note             │   │   screenshot · urlscan ↗       │   │
│  └──────────────────────────────────┘   └────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────────┤
│  Ends up at    https://secure-login.ms-verify.top/auth/o365   1 redirect ▾   │
│  Impersonates  Microsoft                                      urlscan        │
│  Asks for      password → posts to collect.ru (different domain)             │
│  Domain age    registered today, 15 Aug 2026 11:32            Cloudflare     │
│  Certificate   2 days old · Let's Encrypt · valid 89 d                       │
├──────────────────────────────────────────────────────────────────────────────┤
│  WHO SAYS WHAT                                                               │
│  urlscan       MALICIOUS   score 90 · phishing · brand: Microsoft            │
│  Cloudflare    RISK        Newly Seen Domains, Security Risks                │
│  Passive TI    SUSPICIOUS  3 of 22 sources flagged it     full breakdown ↗   │
│                                                                              │
│  ⚠ The engines disagree on what was served: urlscan got 200, Cloudflare 403. │
├──────────────────────────────────────────────────────────────────────────────┤
│  EVIDENCE                                                                    │
│  ▸ Redirect chain (1 hop)                                                    │
│  ▸ Network · 3 IPs, 2 ASNs, 2 countries, 1 server                            │
│  ▸ Page content · 7 cookies, 41 link domains, 3 console messages             │
│  ▸ Certificates (1)                                                          │
│  ▸ DNS and WHOIS · 3 records, DNSSEC unsigned, Dynadot Inc                   │
│  ▸ Sibling domains from robots.txt (1)                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│  NOT COLLECTED                                                               │
│  No page links reported by Cloudflare. No community votes on urlscan.        │
│  Not observed, which is not the same as observed to be absent.               │
│                                                                              │
│  Full TI breakdown ↗  ·  urlscan report ↗  ·  Cloudflare report ↗            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Section by section, and why each is where it is:

1. **Header.** Indicator, how many URLs were sent (an IP sends two), when,
   which engines, at what visibility, and links to earlier scans.
2. **The answer and the picture.** The generated paragraph with a copy button,
   the screenshot beside it. This is the deliverable; everything below is
   support.
3. **The decisive strip.** Five rows, each answering one question the owner
   named: where it ends up, who it impersonates, what it asks for, how old the
   domain is, how old the certificate is. Each row carries **the engine it came
   from on the right**, so a claim can be attributed when it is argued in a
   ticket. A row with no data says so rather than disappearing.
4. **Who says what.** The two engines and the passive TI summary on adjacent
   lines, so agreement or disagreement is visible without comparing by eye.
   Disagreement is written as a sentence, not left as two numbers.
5. **Evidence.** Collapsed, with counts in the headers, so a closed section
   still tells the truth about what it holds.
6. **Not collected.** Named explicitly.
7. **Exits.** To `/check` for the full TI table, and to each engine's report.

## Two engines

Verified 2026-08-15 against a real result from each. They are not redundant.

| Only urlscan has | Only Cloudflare has |
| --- | --- |
| three verdict lanes (overall / engines / community) | WHOIS with the real registration timestamp |
| `brands`, naming the impersonated brand | own risk categories, e.g. `Newly Seen Domains`, `Security Risks` |
| redirect chain as `{from, to, status}` | dedicated `phishing` / `phishing_v2` processors |
| cookies with Secure / HttpOnly flags | DNS records with DNSSEC status |
| `domainAgeDays`, `umbrellaRank` | `radarRank` bucket, `domStructHash`, `robotsTxt` |

`robotsTxt` earns its place: on the live sample its sitemap line pointed at a
sibling domain under a different name, which is a free pivot.

Cloudflare expresses redirects as `page.history` rather than `data.redirects`,
so the distiller needs a per-engine adapter feeding one shared shape.

**Merge rules.** Data only one engine has is merged in directly. Data both agree
on is shown once. **Data they disagree on is shown side by side with each engine
named**, because the disagreement is itself a finding: one engine seeing 200
while the other sees 403 means the site answers differently depending on the
visitor, which is what a kit dodging scanners does.

**The cost, stated on the confirmation card:** two engines means the target is
visited twice, by two third parties.

## The paragraph

`buildScanNarrative`, added to the existing `lib/ti/narrative.ts` beside the
IP / domain / hash builders, following the same pattern.

It emits only sentences the data supports. No template slots filled with
"unknown", no clause that survives when its input is missing. This is the one
place in the feature where a bug becomes an analyst pasting a false claim into a
case, so the test for it is a property test as much as a set of examples.

## Capability: what the page can do

`task.domURL` returns the rendered DOM from the scanner, so reading it costs one
request to the scanner and none to the target. Three things are extracted:

- an `<input type="password">`, meaning the page harvests credentials
- the `<form action>` target, and **whether it is a different domain** from the
  page shown, which is the strongest cheap evidence of credential phishing
- links to executable downloads

**Limits, which the UI must state rather than imply.** The DOM is post-render,
which is good, but a kit can build its form only after a click, or serve a
harmless page when it recognises a scanner. When nothing is found the row reads
"no password form in the page that loaded", never "no password form".

## Where each piece is computed

Left implicit in the first draft, and it is the kind of thing that gets guessed
differently by whoever implements it.

| Piece | Where | When |
| --- | --- | --- |
| submission to both engines | `POST /api/scan-url` | on confirmation |
| polling both engines | `GET /api/scan-url` | while anything is `running` |
| distillation, per engine | inside the poll, before storing | on completion |
| capability from the DOM | inside the poll, once, after the DOM exists | on completion |
| the merged reading | server, when assembling the response | every read |
| the paragraph | pure function, called by the page | render |
| passive TI summary | the page requests it separately | in parallel with the scan |

The capability analysis runs **once, server-side, at completion**, and its
result is stored on the scan. It is not re-fetched on every page view: the DOM
does not change after the scan, and re-fetching would turn one page load into an
extra round trip to the scanner for no new information.

The passive TI summary is a **separate request the page makes in parallel**,
against the existing per-kind route (`/api/check`, `/api/check-domain`, or
`/api/check-url`), so a slow TI fan-out never delays the scan result and a
failing one never blocks the page.

The route is `/scan/<indicator>`, with the indicator percent-encoded exactly as
`/check/[ioc]` already does it, so a URL indicator survives the path.

## Sequencing

Two implementation plans, in order, because the first is useful alone:

1. **The second engine.** Cloudflare submit and poll mirroring
   `lib/ti/url/active/urlscan.ts`, a per-engine adapter into the shared
   `ScanDetail`, and the merge with its disagreement reporting. Ends with both
   engines visible in the existing inline card.
2. **The page.** The route, the layout, `buildScanNarrative`, the DOM capability
   analysis, the passive TI summary, and the history model.

## Rescan and history

The latest scan is stored in full. Earlier scans are kept as uuid, timestamp and
verdict only, rendered as links. That answers "was this scanned before, and what
did it say then" without keeping an archive. `ActiveScanBatch` gains
`previous[]`.

A phishing site changes fast, so the timestamp on the stored scan is load-bearing
and shown in the header rather than buried.

## Errors

One rule covers every case: **the page is never blank and never silent. Anything
missing is named.**

- One engine fails, the other renders. The failed engine is named; the page does
  not wait for both.
- Both fail: say so with a retry, rather than an empty page that reads as clean.
- Still scanning: the page is usable, arrived sections render, pending sections
  say they are waiting.
- Missing key: name the environment variable, run the other engine.
- DOM fetch fails: "form analysis unavailable", never "no password field".
- Passive TI fails: say the lookup failed. Never show 0 flagged, which reads as
  clean.

## Testing

Vitest, colocated, no network, `@/` alias, per the existing convention.

- `lib/ti/narrative.test.ts` — `buildScanNarrative` says only what the data
  supports, plus a property test feeding an empty detail and asserting the
  output makes no claims at all.
- The merge: one-sided data merges, agreeing data collapses to one line,
  disagreeing data surfaces both with engine names.
- The "not collected" derivation: an absent block is named, not silently
  dropped.
- The decisive strip: every row falls back to an explicit unknown rather than
  vanishing.

Browser verification at 1280px light, 1280px dark, and 390px, as for the
previous UI work, with console errors treated as failures.

## Deferred

- The wireframe loading animation, with its assistive-tech announcement.
- Cloudflare submission itself is not yet implemented; only its result shape has
  been verified. The plan's first task is the submit and poll pair, mirroring
  `lib/ti/url/active/urlscan.ts`.
