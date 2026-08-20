import { parseIP } from "@/lib/ip";
import { checkIp } from "@/lib/ti/check";
import { sources } from "@/lib/ti/registry";
import { getCachedResult, setCachedResult } from "@/lib/ti/cache";
import { makeIndicatorRoute, type Validated } from "@/lib/ti/route-handler";
import { requireSession } from "@/lib/require-session";
import type { CheckResult } from "@/lib/ti/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Validate the IP up front, returning the clean IP or an error Response.
 *  Accepts either family; the returned value is canonical (RFC 5952 for v6)
 *  so one address cannot key the cache under two spellings. */
export function validateIp(raw: string | null): Validated<string> {
  if (!raw) {
    return {
      error: Response.json({ error: "Missing 'ip' parameter" }, { status: 400 }),
    };
  }
  const parsed = parseIP(raw);
  if (!parsed) {
    return {
      error: Response.json({ error: "Invalid IP address" }, { status: 400 }),
    };
  }
  if (parsed.isPrivate || parsed.isReserved) {
    return {
      error: Response.json(
        {
          error: `Cannot check non-routable address: ${parsed.scopeNote}`,
          scope: parsed.scopeNote,
        },
        { status: 422 },
      ),
    };
  }
  return { value: parsed.ip };
}

const route = makeIndicatorRoute<string, CheckResult>({
  paramName: "ip",
  label: "ip",
  sources,
  validate: validateIp,
  getCached: (ip) => getCachedResult(ip),
  setCached: (ip, result) => setCachedResult(ip, result),
  run: (ip, onSettled) => checkIp(ip, onSettled),
});

// The second lock. proxy.ts already refuses anonymous callers; this is what
// still refuses if the proxy's matcher is ever edited out from under us.
export async function GET(...args: Parameters<typeof route.GET>) {
  return (await requireSession()) ?? route.GET(...args);
}

export async function POST(...args: Parameters<typeof route.POST>) {
  return (await requireSession()) ?? route.POST(...args);
}
