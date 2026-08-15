# URL as a first-class indicator — design

**Date:** 2026-08-15
**Status:** Approved (design); implementation plan pending
**Closes:** the "URL indicator type" P0 item in `docs/ROADMAP.md`

## Overview

Make a URL a checkable indicator alongside IP, domain, and hash. Pasting
`https://evil.com/login.php?id=abc` runs a **passive** three-layer check
(URL, then its host, then the host's IP) and can, on an explicit click, run an
**active** scan that submits the URL to a third-party scanner.

Today a pasted URL is not rejected, it is silently downgraded: `parseDomain`
(`lib/domain.ts:56`) accepts URL-shaped input and strips the scheme, path, and
query, so `detectIOC` returns `"domain"` and the verdict is delivered on
`evil.com`. The path and query are where a phishing verdict actually lives, so
that downgrade loses the finding without saying so.

Two constraints shape everything below. Free sources only, so nothing here
requires a paid tier. And the tool is used by one analyst on their own machine,
not shared, so shareable-permalink concerns do not drive the design.

## Goals

- `detectIOC` recognizes `url` and the unified `/check/[ioc]` page handles it.
- `POST /api/check-url` returns a layered result: a verdict for the URL, one for
  the host, one for the host's IP, plus one headline that names the layer it
  came from.
- Offline URL heuristics contribute a scored signal with no network call.
- An active scan exists, runs only on an explicit confirmed click, submits
  unlisted, and never rewrites the passive score.
- The domain and IP layers reuse the existing per-type caches instead of
  re-querying, so checking many URLs on one host costs one host lookup.

## Non-goals

- **No self-hosted scanning engine.** Driving Playwright against attacker
  infrastructure needs SSRF containment and an IP whose reputation we are
  willing to spend. Deferred to its own design.
- **No change to `aggregate.ts`.** Layers each call the existing `aggregateRisk`
  unchanged; the layering happens above it.
- No URL support in bulk mode, no STIX/MISP export, no self-hosted screenshots.
- No new indicator relationships beyond the three layers (no crawling the page's
  links into further checks).

## Surface: one page, two lanes, a consent gate

The result page stays one page at one path. The passive lanes stream in on load.
The active lane is a collapsed panel that does nothing until clicked, and the
click opens a confirmation card before anything leaves the machine.

This follows the pattern already in the codebase: `lib/ti/research/` is a second
lane that is slower, sits off the scoring path by design (`research/types.ts:5`),
carries a roomier 10s timeout, and streams into the same page concurrently with
the main fan-out (`components/CheckResults/use-research.ts`). The "slow work
must not block fast work" problem is already solved by streaming, so it is not a
reason to split pages.

**Rejected: two pages** (`/check/<url>` passive, `/scan/<url>` active). Its main
advantage is a distinct permalink per scan, which a single-user tool does not
need, and it forces the OPSEC decision *before* any evidence is on screen, which
is backwards. Deciding whether to touch attacker infrastructure is exactly the
decision that should be made after reading the passive result.

**Rejected: auto-run active when passive is inconclusive.** Fastest to an
answer, but it removes the consent gate and makes quota burn unpredictable.

## Detection and canonicalization

A new `lib/url.ts` does parsing and canonicalization only, with no network access.

`detectIOC` must try URL **before** domain, because `parseDomain` would otherwise
consume URL-shaped input first. The discriminator is structure, not the scheme:

| Input | Type | Why |
| --- | --- | --- |
| `evil.com` | domain | bare hostname, unchanged behaviour |
| `evil.com/login` | url | has a path |
| `evil.com?a=1` | url | has a query |
| `https://evil.com` | url | has a scheme |
| `hxxps://evil[.]com/a` | url | `refangIOC` runs first, then the rule above |

Canonicalization, which also produces the cache key:

- Missing scheme gets `https://`. Any scheme other than http/https is rejected.
- The fragment is dropped. Browsers never send it to the server, so it cannot
  affect any lookup, and keeping it would fragment the cache.
- Scheme and host are lowercased; **the path and query are left as-is**, because
  path comparison is case-sensitive on most servers.
- A default port for the scheme is removed. A non-default port is kept.
- The host is stored punycode-encoded, so one name has one key.
- `userinfo` (`user:pass@`) is stripped from the canonical form but retained on
  the parsed object, because the heuristic layer needs to see it (see below).

## The three passive layers

`lib/ti/url/check.ts` composes three checks, each of which produces its own
`sources[]`, score, and verdict through the **existing** `aggregateRisk`:

1. **URL layer** — the new URL registry, on the full canonical URL.
2. **Host layer** — the existing domain registry on the host. If the host is an
   IP literal, this layer is skipped as not applicable, not as failed.
3. **IP layer** — the existing IP registry on the address the host resolves to.

A host can resolve to many addresses. Running the IP pipeline once per address
would multiply an already wide fan-out, so **one address is checked**: the first
A record, or the first AAAA when there is no A. The remaining addresses are
listed as context on the layer, with a note that they were not checked, so a
multi-homed host does not read as if all of its addresses were cleared.

The envelope is cached under a `ti:url:v1:` prefix and holds the URL layer plus
the composition; the host and IP layers are stored in their own per-type caches
as described below. For `makeIndicatorRoute`, `UrlCheckResult` satisfies
`IndicatorResult` by exposing every layer's rows concatenated as `sources`, with
`layers` alongside carrying the per-layer split, so streaming progress and
history need no change.

### Headline rule

The headline is the layer with the highest score. Ties break toward the more
specific layer (url > domain > ip). The headline always carries the name of the
layer it came from, so "malicious" never appears without saying whether the URL
itself is listed or merely its neighbourhood is.

A layer that could not run is `unavailable` and is rendered as such. **An absent
layer must never read as a clean layer.** This is the same distinction
`verdictFor` already draws with its `hasData` argument, lifted up one level.

### Layer caching, and why it matters

The host and IP layers read and write the **existing** `ti:domain:` and `ti:ip:`
cache entries (`lib/ti/cache.ts`) rather than a URL-private copy. Checking
twenty URLs on one host therefore performs one host lookup and nineteen cache
reads.

This is not only a speed optimization, it is the quota fix. `reverse-ip.ts`
queries HackerTarget, which allows roughly 50 requests per day and is already
handled as `rate_limited` rather than an error (`lib/ti/sources/reverse-ip.ts:30`).
Without layer cache reuse, a URL-heavy triage session would exhaust that budget
before noon while asking about the same IP repeatedly.

The cost is staleness: a layer can be up to the 1-week TTL old. Each layer
therefore displays its own age ("IP layer, cached 3 days ago") with a
per-layer refresh control. This also satisfies the cache-age half of the
"Source health / quota visibility" cross-cutting item in the roadmap.

### Co-tenancy on shared infrastructure

An earlier draft of this section said `reverse-ip` would not be queried at all
on a CDN address. Reading the code showed that is not achievable, and the
weaker, correct version is specified here instead.

The shared-infrastructure signal is `cloudProvider(asn, org)`
(`lib/ti/cloud.ts:44`), an **ASN** lookup. The ASN arrives from the geo sources
inside the same parallel fan-out that runs `reverse-ip`, so there is no moment
at which the provider is known and the query has not already been dispatched.
Pre-emptive suppression would require serializing the IP layer into two stages,
which costs every IP check latency to save a query on a minority of them.

That is an acceptable loss because the two problems separate cleanly:

- **Quota** is solved by layer cache reuse above. The IP layer runs once per
  address rather than once per URL, which is what kept the HackerTarget budget
  from draining; suppression was never the mechanism that mattered.
- **Interpretation** is solved by relabelling. `reverse-ip` already carries
  `weight: 0` (`lib/ti/sources/reverse-ip.ts:41`) so it never moved the score,
  and its list is already capped at `MAX_DOMAINS = 40` with the true
  `domainCount` retained. What misleads is the wording: "40 domains share this
  IP" reads as evidence on an address Cloudflare shares with millions. When the
  ASN resolves to a known provider, the row is rewritten to name the provider
  and say that co-tenancy is not evidence about this URL.

### Progress accounting

The stream's `start` event needs a source total before DNS has resolved, so the
total is the optimistic sum of the three registries and any source that ends up
not running reports `skipped`. This is the pattern already established for
address-family gating in `fc0af2f`.

## URL-layer sources

Verified by probe on 2026-08-15 rather than assumed from documentation.

| Source | Key | Evidence |
| --- | --- | --- |
| URLhaus `/v1/url/` | yes, existing `THREATFOX_API_KEY` | `POST` without a key returns **401**, same as the `/v1/host/` endpoint already in use (`domain/sources/urlhaus.ts:70`), so the URL-level sibling exists under the same abuse.ch Auth-Key |
| Safe Browsing | yes, existing `GOOGLE_SAFE_BROWSING_API_KEY` | already URL-native; today it is fed a bare domain (`domain/sources/safebrowsing.ts:49`), so this is a change of input, not a new integration |
| OpenPhish | no | the feed is a list of **full URLs**; today `loadFeed` calls `hostOf(line)` and discards the path (`domain/sources/openphish.ts:37`). Keeping the whole line enables exact-URL matching, a strictly stronger signal than the host match it does now |
| Heuristics | no | offline, see below |

**Honest consequence:** with no keys configured the URL layer has exactly one
network source (OpenPhish) plus heuristics. That is a thin panel, and the UI must
show it as thin rather than let a quiet "nothing found" read as "clean". The
existing key-gated source UX already communicates this. On the current install
both keys are present, so the layer runs at full width; the thin case still has
to render honestly for a fresh clone.

### Active-lane providers, verified

Both active providers were probed against the configured credentials on
2026-08-15, read-only, with no scan submitted and no submission quota spent.

| Provider | Env | Evidence |
| --- | --- | --- |
| urlscan.io | `URLSCAN_API_KEY` | `GET /user/quotas/` returns the submission limits quoted below |
| Cloudflare Radar URL Scanner | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | `GET /accounts/<id>/urlscanner/v2/search?limit=1` returns 200 with results. Note the path: `v2/search` is correct, `v2/scans` is 404 |

The two are kept as separate engines rather than one, because they render and
classify independently, so a disagreement between them is itself a signal. No
new credentials are required for either.

## Offline heuristics

`lib/ti/url/heuristics.ts` scores the URL string itself with no network call.

| Rule | Signal |
| --- | --- |
| punycode / mixed-script host | homograph attack |
| brand lookalike (edit distance against a small embedded brand list) | typosquat |
| host is a raw IP literal | no domain to defend |
| `user:pass@` in the URL | classic credential-phish shape |
| open-redirect parameter names (`url=`, `next=`, `redirect=`, `r=`) | redirect abuse |
| base64 or long hex blob in path or query | staged payload / tracking token |
| executable or double extension in the path (`.exe`, `.scr`, `.hta`) | direct-download lure |
| known URL shortener | destination unknown, flagged not scored |
| non-standard port | evasion |

**Hard rule: a heuristic never sets `malicious: true`.** `computeFloor` pins the
score to 75 the moment any weighted source declares `malicious`
(`lib/ti/aggregate.ts:16`), so letting a guess reach that gate would undo the
false-positive work. Heuristics carry a low weight (0.3) and contribute score
only. A test asserts this as a property over every rule, not per-rule.

## The active lane

The active scan is a **fourth layer that exists only when it has been run**. It
lives at `POST /api/scan-url` under its own `ti:urlscan:v1:` cache prefix, and it
does not modify the three passive layers' scores. A cached result and a history entry that silently change
meaning after the fact would be worse than a second, clearly labelled verdict.

### Where it can be triggered

An earlier draft put the button on URL results only. It belongs on all three,
because the question "what does this actually serve right now" is asked just as
often of a bare domain or address as of a full URL, and the passive layers
cannot answer it for any of them.

| Result page | What gets submitted |
| --- | --- |
| URL | the canonical URL itself |
| Domain | `https://<domain>/` |
| IP | `http://<ip>/` **and** `https://<ip>/`, as two scans |

The IP case submits both because a bare address has no scheme to infer one
from, and the two ports routinely serve different things: a redirect stub on 80
and the real application on 443, or a default vhost on 443 while 80 hosts the
payload. Submitting only one would report half the host and look complete.

Each submission still spends quota, so the two IP scans are one confirmation and
two entries, not two prompts.

Consent and OPSEC:

- The confirmation card shows the exact string that will be sent, **including
  the full query string**, before anything is transmitted. Phishing URLs
  routinely carry a victim-identifying token in the query; the analyst has to be
  able to see what they are about to hand a third party.
- Submissions are **private by default, falling back to unlisted** when the
  private quota is spent, and never public. A public submission is searchable by
  anyone, including whoever sent the phish; unlisted is unindexed but readable by
  anyone holding the link; private is visible only to the submitting account.
  The confirmation card names which visibility this submission will use.

  Probed on the configured account, 2026-08-15: private allows 50/day (5/min),
  unlisted 1000/day (60/min), public 5000/day. Fifty private scans a day is
  ample for one analyst, so private is the default rather than an option.
- `userinfo` is stripped before the URL is handed to any external service. It is
  a heuristic signal, not something to forward to a third party.

Timing and failure:

- urlscan submission returns a UUID immediately and the scan completes in roughly
  30 seconds, so the flow is submit, then poll.
- **A poll timeout is not a failure.** The scan is still running and the quota is
  already spent. The panel keeps the UUID, shows "still scanning", and offers a
  retry that resumes polling rather than re-submitting.
- With no API key the panel names the missing environment variable, matching the
  existing key-gated source behaviour.

## Errors and validation

Validation happens at the route boundary, as the other routes do. `validateUrl`
returns 422 for a non-http(s) scheme, a host that is a private or reserved IP,
a reserved TLD (reusing `parseDomain`'s `isReserved`), or a URL longer than 2048
characters. A URL carrying credentials is **not** rejected, since that is a
finding.

Per-source failures keep the existing uniform handling from `runSource`. Per
layer, a failed layer is `unavailable`, is surfaced as such, and is **not**
written to cache, so the next check retries it instead of serving a week-old
hole.

### DNS is not perfectly passive

Resolving the host to run the IP layer sends a query that reaches the target's
authoritative nameserver whenever no resolver has it cached. The project already
resolves over DoH through public resolvers (`lib/ti/dns/doh.ts`), so what the
operator observes is Cloudflare's or Quad9's address rather than ours. That is
an acceptable residual, recorded here so "passive" is not read as "emits no
packets".

## Testing

Vitest, colocated, no network, `@/` alias, per the existing convention.

- `lib/url.test.ts` — canonicalization table (scheme defaulting, fragment
  removal, host lowercased while path is preserved, default-port removal,
  punycode, userinfo stripping) and the rejection cases.
- `lib/ioc.test.ts` — the detection ordering table above, including the defanged
  input.
- `lib/ti/url/heuristics.test.ts` — one case per rule, plus a property test that
  iterates every rule's output and asserts none sets `malicious: true`.
- `lib/ti/url/check.test.ts` — layer composition against stub registries: the
  headline picks the worst layer, a tie goes to the more specific layer, an
  `unavailable` layer never reads as clean, an IP-literal host skips the host
  layer as not-applicable, and reverse-IP is suppressed on an allowlisted IP.

`aggregate.ts` is untouched, so its existing tests remain the regression net for
scoring.

## Sequencing

This is one design but two implementation plans, in order:

1. **Passive.** Detection, `lib/url.ts`, the URL registry, heuristics, layer
   composition and caching, the route, and the layered result UI. Shippable and
   useful on its own, and it needs no new credentials beyond the abuse.ch and
   Safe Browsing keys the project already recognizes.
2. **Active.** The consent card, the submission and polling route, and the
   fourth-layer panel. Both providers and both sets of credentials are verified,
   so this phase is unblocked; it is sequenced second only because the passive
   result is what the consent decision is made against.

## Follow-ups, deliberately out of this design

- Self-hosted scanning with Playwright behind a sandbox.
- Reusing the URL layer for the URLs that other sources already return
  (sandbox network IOCs, OpenPhish neighbours), which would turn the layers into
  a pivot graph rather than a fixed three.
