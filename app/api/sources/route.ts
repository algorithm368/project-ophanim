import { type NextRequest } from "next/server";
import { sources } from "@/lib/ti/registry";
import { domainSources } from "@/lib/ti/domain/registry";
import { hashSources } from "@/lib/ti/hash/registry";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// No network calls (isEnabled() only reads env vars); trivial ceiling.
export const maxDuration = 10;

const REGISTRIES = {
  ip: sources,
  domain: domainSources,
  hash: hashSources,
} as const;

type RegistryType = keyof typeof REGISTRIES;

/** Lists registered sources and whether each is currently enabled (key present). */
async function listSources(request: NextRequest) {
  const param = request.nextUrl.searchParams.get("type");
  const type: RegistryType =
    param === "domain" || param === "hash" ? param : "ip";
  return Response.json({
    type,
    sources: REGISTRIES[type].map((s) => ({
      ...s.meta,
      enabled: s.isEnabled(),
    })),
  });
}

// The second lock. proxy.ts already refuses anonymous callers; this is what
// still refuses if the proxy's matcher is ever edited out from under us.
export async function GET(request: NextRequest) {
  return (await requireSession()) ?? listSources(request);
}
