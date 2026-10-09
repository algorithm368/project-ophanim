import { toCsv, toJson } from "@/lib/ti/bulk/export";
import { loadRun } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  const run = await loadRun((await ctx.params).runId, user.email);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  const json = new URL(req.url).searchParams.get("format") === "json";
  return new Response(json ? toJson(run.rows) : toCsv(run.rows), {
    headers: {
      "content-type": json ? "application/json" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bulk-${run.id}.${json ? "json" : "csv"}"`,
    },
  });
}
