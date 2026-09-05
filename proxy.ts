// The gate on every route. Auth.js's `auth` doubles as the proxy handler: with
// no session it redirects to `pages.signIn`, and with one it passes through.
//
// This is proxy.ts, not middleware.ts: Next 16 deprecated the middleware file
// convention and renamed it to proxy.
//
// Next's guidance is that a proxy check is optimistic and should not be the
// only authorization. Reading a signed JWT cookie is a real cryptographic
// check rather than a guess, so it holds here, but the API routes are the ones
// that spend third-party quota, so they check again server-side
// (lib/require-session.ts).
// Re-export syntax (`export { auth as default } from`) does not satisfy Next's
// check that this file exports a function, so the import and the export are
// separate statements.
import { auth } from "@/auth";

// ponytail: dev-only bypass, no per-route/per-env-var toggle. Remove if this
// needs to be conditional on anything besides local `next dev`.
export default process.env.NODE_ENV === "development"
  ? () => undefined
  : auth;

export const config = {
  // Everything except: Auth.js's own endpoints (guarding them would leave no
  // way to sign in), the two pages a signed-out visitor is *sent* to (guarding
  // them would redirect the sign-in page to itself), Next's build output, and
  // static files served from public/.
  matcher: [
    "/((?!api/auth|sign-in|auth-error|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|webmanifest)$).*)",
  ],
};
