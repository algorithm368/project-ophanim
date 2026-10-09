import { withLane } from "@/lib/ti/keys";
import { estimate, runPass1, runPass2 } from "@/lib/ti/bulk/engine";
import { needsConfirmation, ndjsonStream, PASS2_CHUNK, readRowIds } from "@/lib/ti/bulk/api";
import { remaining } from "@/lib/ti/bulk/quota";
import { PASS2_KEY_ENVS } from "@/lib/ti/bulk/profile";
import { hydrate, loadRun, mergeRows, saveRun, summarize } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";
import type { BulkRow } from "@/lib/ti/bulk/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Rows run one after another so the VirusTotal minute cap is honoured in
// order: 4 rows of up to 4 metered calls at the longest 15s timeout.
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  let run = await loadRun((await ctx.params).runId, user.email);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { rowIds?: unknown; confirmed?: unknown } | null;
  const ids = readRowIds(body, PASS2_CHUNK);
  if (!ids) return Response.json({ error: `Send 1 to ${PASS2_CHUNK} rowIds` }, { status: 400 });

  if (body?.confirmed === true && !run.confirmed) run = { ...run, confirmed: true };
  if (needsConfirmation(run)) return Response.json({ estimate: estimate(run.rows), quota: await remaining(new Date(), PASS2_KEY_ENVS) }, { status: 409 });

  const summaries = run.rows.filter((r) => ids.includes(r.id) && r.state === "pass1");
  const current = run;
  return ndjsonStream(async (emit) => {
    const done: BulkRow[] = [];
    await withLane("bulk", async () => {
      for (const s of summaries) {
        let row = await hydrate(s);
        // The row cache expired since pass 1: redo it rather than guess.
        if (row.state === "pending") row = await runPass1(row);
        const { row: next, waitMs } = await runPass2(row);
        done.push(next);
        emit({ v: 1, type: "row", row: summarize(next) });
        if (waitMs !== undefined) {
          emit({ v: 1, type: "wait", ms: waitMs });
          return;
        }
      }
    });
    await saveRun(mergeRows(current, done));
    emit({ v: 1, type: "done" });
  });
}
