import type { LookupType } from "@/lib/ioc";

/**
 * Where each kind of indicator is checked, and what its query parameter is
 * called.
 *
 * There were two of these: one in the checker, which only ever needed the path
 * because it POSTs a body, and one on the scan page, which needed the parameter
 * name too because it GETs. Two maps of the same four routes is one map that
 * can disagree with itself, and the disagreement would be a lookup silently
 * sent to the wrong route.
 *
 * The parameter names match what each route's `validate` reads, so a GET built
 * from this map is one the route accepts.
 */
export const ENDPOINTS: Record<LookupType, { path: string; param: string }> = {
  ip: { path: "/api/check", param: "ip" },
  domain: { path: "/api/check-domain", param: "domain" },
  hash: { path: "/api/check-hash", param: "hash" },
};

/** The GET URL that returns one indicator's normalized result. */
export function checkUrlFor(kind: LookupType, indicator: string): string {
  const { path, param } = ENDPOINTS[kind];
  return `${path}?${param}=${encodeURIComponent(indicator)}`;
}
