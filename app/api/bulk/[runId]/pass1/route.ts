import { withLane } from "@/lib/ti/keys";
import { withRequestMemo } from "@/lib/ti/request-memo";
import { runPass1 } from "@/lib/ti/bulk/engine";
import { ndjsonStream, PASS1_CHUNK, readRowIds } from "@/lib/ti/bulk/api";
import { hydrate, loadRun, mergeRows, saveRun, summarize } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";
import type { BulkRow } from "@/lib/ti/bulk/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 25 rows in parallel, bounded by the slowest pass 1 source (15s) plus cache
// round trips; same reasoning as app/api/check/route.ts.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  const run = await loadRun((await ctx.params).runId, user.email);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  const ids = readRowIds(await req.json().catch(() => null), PASS1_CHUNK);
  if (!ids) return Response.json({ error: `Send 1 to ${PASS1_CHUNK} rowIds` }, { status: 400 });

  const summaries = run.rows.filter((r) => ids.includes(r.id) && r.state === "pending");
  return ndjsonStream(async (emit) => {
    const done: BulkRow[] = [];
    // One memo for the chunk, so the feeds every row consults are fetched once.
    await withLane("bulk", () =>
      withRequestMemo(() =>
        Promise.all(
          summaries.map(async (s) => {
            const next = await runPass1(await hydrate(s));
            done.push(next);
            emit({ v: 1, type: "row", row: summarize(next) });
          }),
        ),
      ),
    );
    await saveRun(mergeRows(run, done));
    emit({ v: 1, type: "done" });
  });
}
