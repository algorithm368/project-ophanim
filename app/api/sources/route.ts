import { type NextRequest } from "next/server";
import { sources } from "@/lib/ti/registry";
import { domainSources } from "@/lib/ti/domain/registry";
import { hashSources } from "@/lib/ti/hash/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGISTRIES = {
  ip: sources,
  domain: domainSources,
  hash: hashSources,
} as const;

type RegistryType = keyof typeof REGISTRIES;

/** Lists registered sources and whether each is currently enabled (key present). */
export async function GET(request: NextRequest) {
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
