import { getRedis } from "@/lib/ti/cache";
import { parseBulkInput, WEB_CAP } from "@/lib/ti/bulk/parse";
import { createRun, saveRun } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  if (!getRedis()) return Response.json({ error: "Bulk lookup needs the Redis cache" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { input?: unknown } | null;
  if (typeof body?.input !== "string") return Response.json({ error: "Missing 'input'" }, { status: 400 });

  const parsed = parseBulkInput(body.input);
  if (parsed.items.length === 0) return Response.json({ error: "No IPs or domains found", invalid: parsed.invalid.slice(0, 50) }, { status: 422 });
  if (parsed.items.length > WEB_CAP) {
    return Response.json({ error: `More than ${WEB_CAP} indicators, use the CLI: bun --env-file=.env.local scripts/bulk.ts <file>` }, { status: 413 });
  }
  const { run, rows } = createRun(user.email, parsed);
  if (!(await saveRun(run))) return Response.json({ error: "Could not save the run" }, { status: 503 });
  return Response.json({
    runId: run.id,
    rows: rows.length,
    internal: rows.filter((r) => r.state === "internal").length,
    invalid: run.invalid.slice(0, 50),
    invalidCount: run.invalid.length,
    duplicates: run.duplicates,
  });
}
