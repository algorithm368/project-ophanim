# Google OAuth login gate — design

**Date:** 2026-08-20
**Status:** Approved (design); implementation plan pending

## Overview

Gate the entire app behind Google sign-in, restricted to a single Google
Workspace domain. Fewer than 20 people need access; there is no need for a
managed identity platform, a user database, or per-user roles — just a door
that only opens for `@yourdomain.com` accounts.

## Goals

- Every route in the app (pages and API routes alike) requires a signed-in
  session, except the sign-in flow itself.
- Only Google accounts whose Workspace domain matches an allowlisted domain
  can complete sign-in.
- A user outside the allowed domain gets a short, clear rejection page, not a
  silent failure or a generic OAuth error.
- A small sign-out affordance exists somewhere in the UI once signed in.
- No new persistent storage requirement: sessions are self-contained.

## Non-goals

- No user database, no per-user roles/permissions, no admin UI.
- No multi-provider login (Google only).
- No account allowlist by individual email — domain-level only.
- No change to the existing Upstash Redis cache/history, which remains
  optional and orthogonal to auth.

## Approach

**Auth.js v5** (`next-auth@beta`), Google provider, JWT session strategy (no
database adapter — sessions live entirely in a signed cookie, which fits
"fewer than 20 users, nothing to persist").

Considered alternatives:

- **Clerk** (Vercel Marketplace native) — faster initial setup and a
  dashboard, but adds a vendor account, a hosted user store, and a free-tier
  MAU ceiling for a need that is just "check one claim on one OAuth token."
  Rejected as more than the problem calls for.
- **Roll a custom OAuth handshake by hand** — avoids a dependency entirely,
  but reimplements token exchange, CSRF state, and cookie signing that
  Auth.js already does correctly. Rejected: not worth the risk for a login
  gate.

### Domain restriction

Google sets `hd` ("hosted domain") on the ID token / profile for Workspace
accounts — the verified claim for "which Workspace domain this account
belongs to," set by Google itself rather than derived by parsing the email
string. The `signIn` callback in `auth.ts` rejects sign-in unless
`profile.hd === process.env.ALLOWED_GOOGLE_HD`.

The check is extracted into a pure function, `lib/auth-domain.ts`:

```ts
export function isAllowedProfile(profile: unknown, allowedHd: string | undefined): boolean
```

so it is unit-testable per the project's "no network in tests" convention;
`auth.ts` itself is a thin wrapper that isn't (and can't usefully be) unit
tested.

### Route protection

**Next 16 renamed `middleware.ts` to `proxy.ts`** (the old name is deprecated;
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/middleware.md`).
So the file is `proxy.ts` at the repo root, exporting Auth.js's `auth` as the
default export, with a `config.matcher` that excludes `/api/auth/*` (the
Auth.js routes themselves), `/sign-in` and `/auth-error` (or the proxy would
redirect the sign-in page to itself), `/_next/*`, and static assets.
Everything else — every other page and every `/api/*` route — requires a
session. This is a deliberate change from the project's current stance (a
passive tool anyone can query); it is accepted here because the whole point
of this feature is to close that off.

Next's own guidance is that proxy checks are *optimistic* and should not be
the only authorization layer. Reading a signed JWT session cookie is a
cryptographic check rather than a guess, so it is sound here, but the API
routes are the ones that actually do work and cost quota, so they get a
second `auth()` check server-side. That check is a shared helper rather than
repeated per route.

### Pages

- `app/sign-in/page.tsx` — one button, "Sign in with Google," styled with the
  existing monochrome/military-grade design system (reuses
  `components/ui/Button`). No provider list, since there is exactly one
  provider.
- `app/auth-error/page.tsx` — shown when `signIn` returns `false` (wrong
  domain). Short message ("this Google account isn't authorized"), link back
  to `/sign-in`. Configured as Auth.js's `pages.error`.
- A small "Sign out" control is added near `ModeSwitch` in the banner,
  rendered only when a session exists.

### Environment

New variables, documented in `CLAUDE.md`/README, not committed:

- `AUTH_SECRET` — Auth.js session signing key
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — Google OAuth client (Auth.js v5's
  convention: picked up automatically by provider name, no explicit
  `clientId`/`clientSecret` wiring needed)
- `ALLOWED_GOOGLE_HD` — the single allowed Workspace domain

## Data flow

1. Unauthenticated request to any protected route → middleware redirects to
   `/sign-in`.
2. User clicks "Sign in with Google" → Google OAuth consent → Google redirects
   back with a profile including `hd`.
3. `signIn` callback: `isAllowedProfile(profile, process.env.ALLOWED_GOOGLE_HD)`
   - `true` → session cookie set, user lands back on the page they originally
     requested.
   - `false` → redirect to `/auth-error`.
4. Signed-in user sees the app as before, plus a "Sign out" control in the
   banner.

## Testing

- `lib/auth-domain.test.ts` covers `isAllowedProfile`: matching domain,
  mismatched domain, missing `hd` claim (personal Gmail accounts have none),
  and an unset/empty `ALLOWED_GOOGLE_HD` (which must deny rather than allow
  everyone — a misconfiguration should fail closed).
- `auth.ts`, `proxy.ts`, and the sign-in/error pages are not
  network-testable under Vitest's no-network convention; verified manually via
  `bun run dev` with a real Google OAuth app (one in-domain account, one
  out-of-domain account).

## Open follow-ups (explicitly deferred, not blocking this design)

- If the user set ever needs per-account allowlisting instead of a whole
  domain, that's a one-line change to `isAllowedProfile`'s signature — not
  designed for here since it isn't needed yet.
