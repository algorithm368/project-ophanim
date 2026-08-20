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
