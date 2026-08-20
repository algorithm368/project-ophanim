# Google OAuth Login Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate every page and API route behind Google sign-in, restricted to a single Google Workspace domain.

**Architecture:** Auth.js v5 with a single Google provider and JWT sessions (no database). A pure `isAllowedProfile` helper in `lib/` decides the domain check and is the only unit-tested piece; `auth.ts` wires it into the `signIn` callback. `proxy.ts` gates all routes, and API routes get a second server-side session check.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `next-auth@5.0.0-beta.32`, Vitest, Bun.

## Global Constraints

- **Package manager is Bun.** Install with `bun add`, run scripts with `bun run <script>`. Never `bun test` (that is Bun's own runner) — always `bun run test`.
- **Next 16 renamed `middleware.ts` to `proxy.ts`.** The file is `proxy.ts` at the repo root with a default export. Do not create `middleware.ts`.
- **`next-auth` must be the `beta` tag** (`5.0.0-beta.32` or later); v4 (`latest`) has a different API and does not support Next 16.
- **Tests are pure/unit, no network**, live under `lib/**/*.test.ts`, and use the `@/` alias. Vitest `include` is `lib/**/*.test.ts` — a test placed anywhere else will not run.
- **User-facing copy uses commas, not dashes** (no em-dash, en-dash, or " - " separators).
- **UI is monochrome/minimal**: grayscale, system fonts, flat, color reserved for verdicts. Reuse `components/ui/button`, do not introduce new color.
- **Never commit secrets.** `.env*` is gitignored; add new variable *names* to docs only.
- **Verification before done:** `bun run test`, `bun run lint`, and `bun run typecheck` must all pass.

---

### Task 1: The domain-check helper

The only piece of auth logic that is pure and therefore unit-testable. Everything later depends on it, so it comes first.

**Files:**
- Create: `lib/auth-domain.ts`
- Test: `lib/auth-domain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isAllowedProfile(profile: unknown, allowedHd: string | undefined): boolean` — used by `auth.ts` in Task 3. `profile` is `unknown` rather than a shape on purpose: it takes whatever Auth.js hands the callback without this file depending on Auth.js's `Profile` type, and it sidesteps TypeScript's weak-type check, which rejects assigning a type with no overlapping properties to an all-optional one.

- [ ] **Step 1: Write the failing test**

Create `lib/auth-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedProfile } from "@/lib/auth-domain";

describe("isAllowedProfile", () => {
  it("admits a Workspace account in the allowed domain", () => {
    expect(isAllowedProfile({ hd: "example.com" }, "example.com")).toBe(true);
  });

  it("refuses a Workspace account in another domain", () => {
    expect(isAllowedProfile({ hd: "evil.com" }, "example.com")).toBe(false);
  });

  it("refuses a personal account, which carries no hd claim", () => {
    expect(isAllowedProfile({}, "example.com")).toBe(false);
    expect(isAllowedProfile({ hd: undefined }, "example.com")).toBe(false);
  });

  it("refuses a missing profile", () => {
    expect(isAllowedProfile(null, "example.com")).toBe(false);
    expect(isAllowedProfile(undefined, "example.com")).toBe(false);
  });

  // A misconfigured deployment must lock everyone out rather than let
  // everyone in: an empty allowlist is not an empty gate.
  it("refuses everyone when no domain is configured", () => {
    expect(isAllowedProfile({ hd: "example.com" }, undefined)).toBe(false);
    expect(isAllowedProfile({ hd: "example.com" }, "")).toBe(false);
    expect(isAllowedProfile({ hd: "example.com" }, "   ")).toBe(false);
  });

  it("compares domains case-insensitively, ignoring surrounding space", () => {
    expect(isAllowedProfile({ hd: "Example.COM" }, " example.com ")).toBe(true);
  });

  it("refuses a non-string hd claim", () => {
    expect(isAllowedProfile({ hd: 42 }, "example.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/auth-domain.test.ts`
Expected: FAIL, cannot resolve `@/lib/auth-domain`.

- [ ] **Step 3: Write the implementation**

Create `lib/auth-domain.ts`:

```ts
/**
 * Whether a Google profile belongs to the one Workspace domain allowed in.
 *
 * The check is on Google's `hd` ("hosted domain") claim rather than on the
 * email's suffix. `hd` is set by Google only for Workspace accounts and states
 * which domain the account is administered by, so it answers "is this one of
 * ours" directly. An email suffix is a string that merely looks like an answer.
 *
 * Fails closed on every uncertainty: no profile, no claim, a claim that is not
 * a string, or no configured domain all return false. A deployment that forgot
 * to set ALLOWED_GOOGLE_HD locks everyone out, which is visible in a way that
 * silently admitting the whole internet is not.
 */
export function isAllowedProfile(
  profile: unknown,
  allowedHd: string | undefined,
): boolean {
  const allowed = allowedHd?.trim().toLowerCase();
  if (!allowed) return false;

  if (typeof profile !== "object" || profile === null) return false;
  const hd = (profile as { hd?: unknown }).hd;
  if (typeof hd !== "string") return false;

  return hd.trim().toLowerCase() === allowed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test lib/auth-domain.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add lib/auth-domain.ts lib/auth-domain.test.ts
git commit -m "feat(auth): decide domain admission from Google's hd claim"
```

---

### Task 2: Install Auth.js and document the environment

Dependency and configuration groundwork. Separated from Task 3 so a reviewer can reject the dependency choice without unwinding the config code.

**Files:**
- Modify: `package.json` (via `bun add`)
- Modify: `CLAUDE.md` (env section)
- Modify: `README.md` (setup section)
- Create: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: the `next-auth` dependency and the four env var names Task 3 reads.

- [ ] **Step 1: Install the dependency**

```bash
bun add next-auth@beta
```

Expected: `package.json` gains `"next-auth": "^5.0.0-beta.32"` (or later beta).

- [ ] **Step 2: Verify the installed version is v5, not v4**

Run: `cat node_modules/next-auth/package.json | grep '"version"'`
Expected: a `5.0.0-beta.*` version. If it shows `4.x`, the `@beta` tag was dropped, so re-run Step 1 exactly as written.

- [ ] **Step 3: Generate a session secret and write `.env.local`**

```bash
bunx auth secret
```

This writes `AUTH_SECRET` into `.env.local`. Then add the remaining three by hand to `.env.local` (this file is gitignored, never commit it):

```
AUTH_GOOGLE_ID=<client id from Google Cloud Console>
AUTH_GOOGLE_SECRET=<client secret from Google Cloud Console>
ALLOWED_GOOGLE_HD=<the Workspace domain, e.g. example.com>
```

The Google credentials come from Google Cloud Console, **APIs & Services → Credentials → Create OAuth client ID → Web application**, with these Authorized redirect URIs:
- `http://localhost:3000/api/auth/callback/google`
- `https://<production-domain>/api/auth/callback/google`

**This step needs the user's Google account.** If you are an agent and cannot reach the console, stop and ask the user to create the client and supply the two values, then continue.

- [ ] **Step 4: Create `.env.example`**

Create `.env.example` (names only, no values, safe to commit):

```
# Auth.js session signing key. Generate with: bunx auth secret
AUTH_SECRET=

# Google OAuth client, from Google Cloud Console > APIs & Services >
# Credentials > OAuth client ID > Web application. Authorized redirect URI:
#   http://localhost:3000/api/auth/callback/google
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# The single Google Workspace domain allowed to sign in, e.g. example.com.
# Unset means nobody gets in, not everybody.
ALLOWED_GOOGLE_HD=
```

- [ ] **Step 5: Confirm `.env.local` is not tracked**

Run: `git status --porcelain .env.local`
Expected: **no output** (gitignored). If it prints anything, stop and fix `.gitignore` before committing.

- [ ] **Step 6: Document the variables in `CLAUDE.md`**

In `CLAUDE.md`, in the **Conventions** section, immediately after the existing `**Env / secrets**` bullet, add:

```markdown
- **Auth**: the whole app is behind Google sign-in, limited to one Workspace
  domain. `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and
  `ALLOWED_GOOGLE_HD` are required; see `.env.example`. Unlike the cache, auth
  does not degrade gracefully: with `ALLOWED_GOOGLE_HD` unset nobody can sign
  in, which is deliberate (a misconfigured allowlist must fail closed).
```

- [ ] **Step 7: Document setup in `README.md`**

In `README.md`, find the section covering local setup or environment variables and add a subsection:

```markdown
### Sign-in

The app requires a Google sign-in from one Google Workspace domain. Copy
`.env.example` to `.env.local` and fill in all four values: run
`bunx auth secret` for `AUTH_SECRET`, create an OAuth client in Google Cloud
Console for `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, and set
`ALLOWED_GOOGLE_HD` to your domain. With `ALLOWED_GOOGLE_HD` unset, sign-in is
refused for everyone.
```

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock .env.example CLAUDE.md README.md
git commit -m "chore(auth): add Auth.js, and say which variables it needs"
```

---

### Task 3: Auth.js configuration and route handler

Wires the Task 1 helper into a real Auth.js instance and mounts its routes.

**Files:**
- Create: `auth.ts` (repo root)
- Create: `app/api/auth/[...nextauth]/route.ts`

**Interfaces:**
- Consumes: `isAllowedProfile` from `@/lib/auth-domain` (Task 1); the env vars from Task 2.
- Produces: from `@/auth`, the exports `handlers` (`{ GET, POST }`), `auth`, `signIn`, `signOut`. `auth` is used as the proxy default export in Task 4, as a server-side session reader in Task 5, and `signIn`/`signOut` as server actions in Tasks 6 and 7.

- [ ] **Step 1: Write the Auth.js config**

Create `auth.ts` at the repo root:

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedProfile } from "@/lib/auth-domain";

/**
 * One provider, one domain, no database.
 *
 * Sessions are JWTs in a signed cookie: with fewer than twenty people and no
 * per-user state to keep, a session table would be a database to run for the
 * sake of a row nobody reads.
 *
 * AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are picked up from the environment by
 * name, which is why the provider takes no arguments here.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    error: "/auth-error",
  },
  callbacks: {
    // The gate. Returning false sends the visitor to `pages.error`, which is
    // the page that explains the refusal in words.
    signIn({ profile }) {
      return isAllowedProfile(profile, process.env.ALLOWED_GOOGLE_HD);
    },
  },
});
```

- [ ] **Step 2: Mount the Auth.js routes**

Create `app/api/auth/[...nextauth]/route.ts`:

```ts
// Auth.js's own endpoints (sign-in, callback, sign-out, session). The proxy in
// proxy.ts deliberately does not guard this path: gating the door behind
// itself would leave no way to knock.
export { GET, POST } from "@/auth";
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: clean. A "cannot find module 'next-auth'" error means Task 2 Step 1 did not complete.

- [ ] **Step 4: Verify the tests still pass**

Run: `bun run test`
Expected: PASS, including the Task 1 suite.

- [ ] **Step 5: Lint**

Run: `bun run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add auth.ts app/api/auth
git commit -m "feat(auth): configure Google sign-in behind the domain check"
```

---

### Task 4: The proxy that gates every route

**Files:**
- Create: `proxy.ts` (repo root)

**Interfaces:**
- Consumes: `auth` from `@/auth` (Task 3).
- Produces: nothing importable; it is a Next file convention.

- [ ] **Step 1: Write the proxy**

Create `proxy.ts` at the repo root. **Not `middleware.ts`** — Next 16 deprecated that name and renamed the convention to `proxy`.

```ts
// The gate on every route. Auth.js's `auth` doubles as the proxy handler: with
// no session it redirects to `pages.signIn`, and with one it passes through.
//
// Next's guidance is that a proxy check is optimistic and should not be the
// only authorization. Reading a signed JWT cookie is a real cryptographic
// check rather than a guess, so it holds here, but the API routes are the ones
// that spend third-party quota, so they check again server-side
// (lib/require-session.ts).
export { auth as default } from "@/auth";

export const config = {
  // Everything except: Auth.js's own endpoints (guarding them would leave no
  // way to sign in), the two pages a signed-out visitor is *sent* to (guarding
  // them would redirect the sign-in page to itself), Next's build output, and
  // static files served from public/.
  matcher: [
    "/((?!api/auth|sign-in|auth-error|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|webmanifest)$).*)",
  ],
};
```

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both clean.

- [ ] **Step 3: Verify the gate redirects**

Start the dev server in one terminal:

```bash
bun run dev
```

In another terminal, with no session cookie:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/
```

Expected: a `307` (or `302`) whose redirect URL points at `/sign-in`. A `200` means the matcher is not covering `/`, so re-check Step 1.

- [ ] **Step 4: Verify the sign-in path is NOT gated**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/auth/providers
```

Expected: `200` with a JSON body listing `google`. A redirect here means the matcher is wrongly catching `/api/auth`, which would make signing in impossible.

- [ ] **Step 5: Commit**

```bash
git add proxy.ts
git commit -m "feat(auth): gate every route on a session, except the door itself"
```

---

### Task 5: A second check on the API routes

Defense in depth for the routes that actually spend third-party quota, per Next's "proxy checks are optimistic" guidance.

**Files:**
- Create: `lib/require-session.ts`
- Modify: `app/api/check/route.ts`, `app/api/check-domain/route.ts`, `app/api/check-hash/route.ts`, `app/api/scan-url/route.ts`

**Interfaces:**
- Consumes: `auth` from `@/auth` (Task 3).
- Produces: `requireSession(): Promise<Response | null>` — resolves to a 401 `Response` when there is no session, or `null` when there is one. Callers return the response if it is non-null and otherwise continue.

- [ ] **Step 1: Write the helper**

Create `lib/require-session.ts`:

```ts
import { auth } from "@/auth";

/**
 * The API-side half of the gate.
 *
 * Returns a 401 to send back, or null to carry on. The shape is "null means
 * go" rather than a boolean so a caller cannot use it and forget to return
 * the refusal: the only thing you can do with a Response here is return it.
 *
 * proxy.ts already turns anonymous requests away. This is the second lock, on
 * the routes that call out to third parties and spend quota, because Next
 * treats a proxy check as optimistic and a route that costs something should
 * not depend on an optimistic check alone.
 */
export async function requireSession(): Promise<Response | null> {
  const session = await auth();
  if (session?.user) return null;

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
```

- [ ] **Step 2: Guard the three indicator routes**

These three files each end with a destructured export from `makeIndicatorRoute`. In `app/api/check/route.ts` the line is:

```ts
export const { GET, POST } = makeIndicatorRoute<string, CheckResult>({
  paramName: "ip",
  // ...
});
```

Change it to bind the handlers to a local instead, then export guarded wrappers:

```ts
const route = makeIndicatorRoute<string, CheckResult>({
  paramName: "ip",
  // ...everything inside the object stays exactly as it was...
});

export async function GET(...args: Parameters<typeof route.GET>) {
  return (await requireSession()) ?? route.GET(...args);
}

export async function POST(...args: Parameters<typeof route.POST>) {
  return (await requireSession()) ?? route.POST(...args);
}
```

and add the import at the top of the file:

```ts
import { requireSession } from "@/lib/require-session";
```

Do the same in `app/api/check-domain/route.ts` and `app/api/check-hash/route.ts`. Their type arguments and options objects differ, so keep each file's own `makeIndicatorRoute<...>({...})` call byte-for-byte as it is and change only `export const { GET, POST } =` into `const route =`, then append the two wrappers above. Leave the existing `runtime`, `dynamic`, and `validate` exports untouched.

- [ ] **Step 3: Guard the scan route**

`app/api/scan-url/route.ts` is shaped differently: it declares its handlers directly, at `app/api/scan-url/route.ts:70` and `:148`:

```ts
export async function POST(request: NextRequest): Promise<Response> {
export async function GET(request: NextRequest): Promise<Response> {
```

Rename both to unexported implementations and export guarded wrappers in their place. Change the two declarations to:

```ts
async function submitScan(request: NextRequest): Promise<Response> {
```

```ts
async function pollScan(request: NextRequest): Promise<Response> {
```

leaving each body untouched, then add at the end of the file:

```ts
export async function POST(request: NextRequest): Promise<Response> {
  return (await requireSession()) ?? submitScan(request);
}

export async function GET(request: NextRequest): Promise<Response> {
  return (await requireSession()) ?? pollScan(request);
}
```

and the import at the top:

```ts
import { requireSession } from "@/lib/require-session";
```

If either body calls the other handler by its old name, update that call to the new name; `bun run typecheck` in the next step will name any such site.

- [ ] **Step 4: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both clean. `Parameters<typeof route.GET>` keeps the wrappers' signatures identical to the originals, so a type error here means an options object or type argument was altered while moving the call, so diff the file against `HEAD` and restore it.

- [ ] **Step 5: Verify a guarded route refuses an anonymous request**

The proxy already redirects, so to test the second lock specifically, check that the route itself refuses. With `bun run dev` running:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/check?ip=8.8.8.8
```

Expected: `307`/`302` (redirected by the proxy) or `401` (refused by the route). Either proves anonymous access is closed; a `200` with a result body is a failure.

- [ ] **Step 6: Run the full test suite**

Run: `bun run test`
Expected: PASS. These are `lib/` unit tests and do not exercise routes, so nothing should change, but a failure here means an import was broken.

- [ ] **Step 7: Commit**

```bash
git add lib/require-session.ts app/api/check app/api/check-domain app/api/check-hash app/api/scan-url
git commit -m "feat(auth): make the quota-spending routes check the session too"
```

---

### Task 6: The sign-in and refusal pages

**Files:**
- Create: `app/sign-in/page.tsx`
- Create: `app/auth-error/page.tsx`

**Interfaces:**
- Consumes: `signIn` from `@/auth` (Task 3); `Button` from `@/components/ui/button`.
- Produces: the two routes named in `auth.ts`'s `pages` config and excluded in `proxy.ts`'s matcher.

- [ ] **Step 1: Write the sign-in page**

Create `app/sign-in/page.tsx`. It is a server component using a server action, so no `"use client"`:

```tsx
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Sign in · Project Ophanim",
};

/**
 * One provider, so one button and no list to choose from.
 *
 * A server action rather than a client handler: the whole page is static
 * except the submit, so there is nothing for a client bundle to do here.
 */
export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm border border-border bg-background p-8">
        <h1 className="font-mono text-sm font-medium tracking-[0.14em] uppercase">
          Sign in
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This tool is limited to accounts on the organisation&apos;s Google
          Workspace domain.
        </p>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <Button type="submit" className="w-full">
            Continue with Google
          </Button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Write the refusal page**

Create `app/auth-error/page.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Not authorized · Project Ophanim",
};

/**
 * Where a refused sign-in lands. It names the reason, because an account that
 * is simply the wrong one is a five second fix once you know that is what
 * happened, and an unexplained bounce back to the sign-in button is not.
 */
export default function AuthErrorPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm border border-border bg-background p-8">
        <h1 className="font-mono text-sm font-medium tracking-[0.14em] uppercase">
          Not authorized
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          That Google account is not on the organisation&apos;s Workspace
          domain, so it cannot sign in here. Try again with your work account.
        </p>
        <Button variant="outline" className="mt-6 w-full" render={<Link href="/sign-in" />}>
          Back to sign in
        </Button>
      </div>
    </main>
  );
}
```

Note the `render` prop: `components/ui/button` wraps `@base-ui/react/button`, which composes via `render` (it accepts a `ReactElement`, per `node_modules/@base-ui/react/internals/types.d.ts:33`) rather than shadcn's `asChild`. Using `asChild` here will not typecheck.

- [ ] **Step 3: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both clean.

- [ ] **Step 4: Look at both pages**

With `bun run dev` running, open `http://localhost:3000/sign-in` and `http://localhost:3000/auth-error` in a browser. Confirm both render, are monochrome, and are readable in light and dark (toggle with the banner control). If you cannot open a browser, say so explicitly rather than claiming the pages look right.

- [ ] **Step 5: Commit**

```bash
git add app/sign-in app/auth-error
git commit -m "feat(auth): add the sign-in page, and one that explains a refusal"
```

---

### Task 7: The sign-out control in the banner

**Files:**
- Create: `components/SignOutButton.tsx`
- Modify: `components/Banner.tsx`

**Interfaces:**
- Consumes: `auth` and `signOut` from `@/auth` (Task 3); `Button` from `@/components/ui/button`.
- Produces: `<SignOutButton />`, an async server component rendering nothing when signed out.

- [ ] **Step 1: Write the component**

Create `components/SignOutButton.tsx`:

```tsx
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";

/**
 * A way out, beside the controls for how the page is shown.
 *
 * An async server component, so it renders nothing at all when signed out
 * rather than flashing a control that would not work. It is icon-only at this
 * size for the same reason the mode switch hides its words on a phone; the
 * accessible name is stated outright instead of left to a tooltip.
 */
export async function SignOutButton() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/sign-in" });
      }}
    >
      <Button type="submit" variant="outline" size="icon" aria-label="Sign out">
        <LogOut />
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Place it in the banner**

`components/Banner.tsx` is a client component (`"use client"`), and a client component cannot render an async server component directly, but it **can** render one passed to it as a prop or child from a server component. `Banner` is rendered by `app/layout.tsx`, which is a server component, so pass it through as a child.

In `components/Banner.tsx`, change the signature and the control cluster:

```tsx
/** Full-width brand banner shown at the top of every page. */
export function Banner({ signOut }: { signOut?: React.ReactNode }) {
```

and in the control cluster, after `<ThemeToggle />`:

```tsx
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Which reading is on screen, next to how the page is shown. Absent
              on the home page, where there is no indicator to read either way. */}
          <ModeSwitch />
          <ThemeToggle />
          {/* Rendered by the layout, which is a server component and can await
              the session; this file cannot. Absent when signed out. */}
          {signOut}
        </div>
```

- [ ] **Step 3: Pass it in from the layout**

In `app/layout.tsx`, add the import:

```tsx
import { SignOutButton } from "@/components/SignOutButton";
```

and change the `<Banner />` usage to:

```tsx
          <Banner signOut={<SignOutButton />} />
```

- [ ] **Step 4: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both clean.

- [ ] **Step 5: Verify signed-out pages do not show it**

With `bun run dev` running, open `http://localhost:3000/sign-in`. The banner must show no sign-out control, because there is no session. Confirm the page renders without an error overlay, which is what an async-component-in-a-client-component mistake would produce.

- [ ] **Step 6: Commit**

```bash
git add components/SignOutButton.tsx components/Banner.tsx app/layout.tsx
git commit -m "feat(auth): offer a way out, beside the way the page is shown"
```

---

### Task 8: End-to-end verification

No new code. This task exists because every check before it was partial, and the thing being built is a lock, where "probably works" is not a result.

**Files:** none.

**Interfaces:**
- Consumes: everything from Tasks 1 to 7.
- Produces: nothing.

- [ ] **Step 1: Run the full verification suite**

```bash
bun run typecheck && bun run lint && bun run test && bun run build
```

Expected: all four pass. This is the same order CI uses in `.github/workflows/ci.yml`.

- [ ] **Step 2: Sign in with an in-domain account**

With `bun run dev` running, in a browser:
1. Open `http://localhost:3000/` and confirm you are redirected to `/sign-in`.
2. Click "Continue with Google" and complete sign-in with an account **on** `ALLOWED_GOOGLE_HD`.
3. Confirm you land back on `/` and the app works as before.
4. Confirm the sign-out control is now visible in the banner.

- [ ] **Step 3: Verify a real lookup still works while signed in**

Check a known indicator (for example `8.8.8.8`) through the UI and confirm results stream in. This proves Task 5's API guards pass a genuine session through rather than 401-ing it.

- [ ] **Step 4: Sign out**

Click the sign-out control. Confirm you land on `/sign-in` and that opening `http://localhost:3000/` redirects back to `/sign-in`.

- [ ] **Step 5: Verify an out-of-domain account is refused**

Sign in again, this time choosing a personal Gmail account or one on another domain. Confirm you land on `/auth-error` with the explanatory message, and that you are **not** signed in afterwards (opening `/` still redirects to `/sign-in`).

- [ ] **Step 6: Verify a missing allowlist fails closed**

Temporarily comment out `ALLOWED_GOOGLE_HD` in `.env.local`, restart `bun run dev`, and attempt sign-in with the in-domain account. Expected: refused, landing on `/auth-error`. **Restore the variable and restart** before finishing.

- [ ] **Step 7: Confirm no secret is staged**

```bash
git status --porcelain
```

Expected: no `.env.local`, no `.env`. If either appears, do not commit; fix `.gitignore` first.

- [ ] **Step 8: Report the outcome**

State plainly which of Steps 1 to 7 passed and which did not. If a browser was unavailable for Steps 2 to 6, say that those steps were not run rather than implying they passed.

---

## Deployment note (not a task)

Before the production deploy works, two things must be true outside this repo:

1. The Google OAuth client has `https://<production-domain>/api/auth/callback/google` in its Authorized redirect URIs.
2. All four variables (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_GOOGLE_HD`) exist in the Vercel project, for the Production environment. Add them with `vercel env add <NAME> production`, then redeploy, because environment changes do not apply to an existing deployment.
