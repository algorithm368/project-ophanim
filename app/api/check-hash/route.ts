import { parseHash } from "@/lib/hash";
import type { HashAlgorithm } from "@/lib/hash";
import { checkHash } from "@/lib/ti/hash/check";
import { hashSources } from "@/lib/ti/hash/registry";
import {
  getCachedHashResult,
  setCachedHashResult,
} from "@/lib/ti/cache";
import { makeIndicatorRoute, type Validated } from "@/lib/ti/route-handler";
import { requireSession } from "@/lib/require-session";
import type { HashCheckResult } from "@/lib/ti/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParsedHashInput = { hash: string; algorithm: HashAlgorithm };

/** Validate the hash up front, returning the clean hash or an error Response. */
function validateHash(raw: string | null): Validated<ParsedHashInput> {
  if (!raw) {
    return {
      error: Response.json(
        { error: "Missing 'hash' parameter" },
        { status: 400 },
      ),
    };
  }
  const parsed = parseHash(raw);
  if (!parsed) {
    return {
      error: Response.json(
        { error: "Invalid file hash. Provide an MD5, SHA-1, or SHA-256 digest." },
        { status: 400 },
      ),
    };
  }
  return { value: { hash: parsed.hash, algorithm: parsed.algorithm } };
}

const route = makeIndicatorRoute<ParsedHashInput, HashCheckResult>({
  paramName: "hash",
  label: "hash",
  sources: hashSources,
  validate: validateHash,
  getCached: ({ hash }) => getCachedHashResult(hash),
  setCached: ({ hash }, result) => setCachedHashResult(hash, result),
  run: ({ hash, algorithm }, onSettled) =>
    checkHash(hash, algorithm, onSettled),
});

// The second lock. proxy.ts already refuses anonymous callers; this is what
// still refuses if the proxy's matcher is ever edited out from under us.
export async function GET(...args: Parameters<typeof route.GET>) {
  return (await requireSession()) ?? route.GET(...args);
}

export async function POST(...args: Parameters<typeof route.POST>) {
  return (await requireSession()) ?? route.POST(...args);
}
