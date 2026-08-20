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
    // Who may sign in at all. Returning false sends the visitor to
    // `pages.error`, which is the page that explains the refusal in words.
    signIn({ profile }) {
      return isAllowedProfile(profile, process.env.ALLOWED_GOOGLE_HD);
    },

    // What the proxy enforces on every request. This callback is what makes
    // proxy.ts a gate: Auth.js defaults `authorized` to true, so exporting
    // `auth` as the proxy without this would read the session, authorize
    // everyone, and protect nothing.
    authorized({ request, auth: session }) {
      if (session?.user) return true;

      // A caller of /api wants a status it can branch on, not a login page in
      // its JSON parser. Everything else gets the redirect, which carries a
      // callbackUrl back to where the visitor was headed.
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return false;
    },
  },
});
