/**
 * The API-side half of the gate.
 *
 * Returns a 401 to send back, or null to carry on. The shape is "null means
 * go" rather than a boolean so a caller cannot use it and forget to return the
 * refusal: the only thing you can do with a Response here is return it.
 *
 * proxy.ts already turns anonymous requests away with this same 401. This is
 * the second lock, because Next treats a proxy check as optimistic and these
 * are the routes that call out to third parties and spend quota. If the proxy
 * is ever misconfigured (a matcher edited, a path added that it does not
 * cover), this is what still refuses.
 *
 * `auth` is imported inside the function rather than at the top of the file so
 * that importing a route module does not pull the whole Auth.js graph with it.
 * The unit tests import route modules for their pure `validate` functions
 * (see lib/ti/route-validate.test.ts), and next-auth's `next/server` import
 * does not resolve under Vitest's node environment. The import is cached after
 * the first call, so this costs one module lookup, not one per request.
 */
export async function requireSession(): Promise<Response | null> {
  if (process.env.NODE_ENV === "development") return null;

  const { auth } = await import("@/auth");
  const session = await auth();
  if (session?.user) return null;

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/** Under next dev every caller is this one owner, since the proxy waves
 *  everything through there and nobody can sign in to say who they are. */
export const DEV_OWNER = "dev@localhost";

/** Like requireSession, but hands back who is asking, for routes that keep
 *  per-user records (bulk runs). Same next dev bypass, under the same
 *  condition, so production stays fail-closed. */
export async function requireSessionUser(): Promise<{ email: string } | Response> {
  if (process.env.NODE_ENV === "development") return { email: DEV_OWNER };

  const { auth } = await import("@/auth");
  const session = await auth();
  const email = session?.user?.email;
  if (email) return { email };
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
