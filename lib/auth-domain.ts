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
 *
 * `profile` is `unknown` rather than a shape so this file does not depend on
 * Auth.js's `Profile` type, and so the call site is not caught by TypeScript's
 * weak-type check.
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
