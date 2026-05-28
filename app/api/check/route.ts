import { parseIPv4 } from "@/lib/ip";
import { checkIp } from "@/lib/ti/check";
import { sources } from "@/lib/ti/registry";
import { getCachedResult, setCachedResult } from "@/lib/ti/cache";
import { makeIndicatorRoute, type Validated } from "@/lib/ti/route-handler";
import type { CheckResult } from "@/lib/ti/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Validate the IP up front, returning the clean IP or an error Response. */
function validateIp(raw: string | null): Validated<string> {
  if (!raw) {
    return {
      error: Response.json({ error: "Missing 'ip' parameter" }, { status: 400 }),
    };
  }
  const parsed = parseIPv4(raw);
  if (!parsed) {
    return {
      error: Response.json({ error: "Invalid IPv4 address" }, { status: 400 }),
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

export const { GET, POST } = makeIndicatorRoute<string, CheckResult>({
  paramName: "ip",
  label: "ip",
  sources,
  validate: validateIp,
  getCached: (ip) => getCachedResult(ip),
  setCached: (ip, result) => setCachedResult(ip, result),
  run: (ip, onSettled) => checkIp(ip, onSettled),
});
