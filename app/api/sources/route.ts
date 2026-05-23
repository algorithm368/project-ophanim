import { sources } from "@/lib/ti/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists registered sources and whether each is currently enabled (key present). */
export async function GET() {
  return Response.json({
    sources: sources.map((s) => ({
      ...s.meta,
      enabled: s.isEnabled(),
    })),
  });
}
