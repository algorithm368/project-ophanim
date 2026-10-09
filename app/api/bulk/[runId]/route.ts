import { estimate } from "@/lib/ti/bulk/engine";
import { confirmAt, needsConfirmation } from "@/lib/ti/bulk/api";
import { remaining } from "@/lib/ti/bulk/quota";
import { loadRun } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  const run = await loadRun((await ctx.params).runId, user.email);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({ run, estimate: estimate(run.rows), needsConfirmation: needsConfirmation(run), confirmAt: confirmAt(), quota: await remaining() });
}
