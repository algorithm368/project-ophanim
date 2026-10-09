// Bulk lookup from a file, any size. Runs over 1,000 rows start with pass 0
// (local feeds) and escalate only strong hits. The run lives in a directory
// (default ~/.ophanim/bulk/<id>), so it can be stopped and resumed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { withLane } from "@/lib/ti/keys";
import { withRequestMemo } from "@/lib/ti/request-memo";
import { confirmAt } from "@/lib/ti/bulk/api";
import { escalationQueue, estimate, estimateTotal, newRow, runPass1, runPass2 } from "@/lib/ti/bulk/engine";
import { mapLimit } from "@/lib/ti/bulk/limit";
import { parseBulkInput, WEB_CAP } from "@/lib/ti/bulk/parse";
import { runPass0, settlePass0 } from "@/lib/ti/bulk/pass0";
import { appendRows, defaultRoot, initRunDir, loadRunDir, resolveRunDir, saveState, writeOutputs, type RunState } from "@/lib/ti/bulk/run-dir";
import { summarize } from "@/lib/ti/bulk/run-store";
import type { BulkRow } from "@/lib/ti/bulk/types";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    resume: { type: "string" },
    "include-weak": { type: "boolean", default: false },
    concurrency: { type: "string", default: "5" },
    yes: { type: "boolean", default: false },
    "out-dir": { type: "string" },
  },
});

const PASS0_BATCH = 2000;
const log = (msg: string) => console.error(msg);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(): string {
  if (values.resume) return resolveRunDir(values.resume);
  const file = positionals[0];
  if (!file) throw new Error("Usage: scripts/bulk.ts <file> [--include-weak] [--concurrency n] [--yes] [--out-dir dir] | --resume <id|dir>");
  const parsed = parseBulkInput(readFileSync(file, "utf8"));
  const id = crypto.randomUUID();
  const dir = values["out-dir"] ?? join(defaultRoot(), id);
  const state: RunState = {
    v: 1, id, createdAt: new Date().toISOString(), phase: parsed.items.length > WEB_CAP ? "pass0" : "pass1",
    includeWeak: values["include-weak"]!, concurrency: Math.max(1, Number(values.concurrency) || 5),
    confirmed: false, invalid: parsed.invalid, duplicates: parsed.duplicates,
  };
  initRunDir(dir, state, parsed.items);
  log(`${parsed.items.length} indicators, ${parsed.duplicates} duplicates, ${parsed.invalid.length} invalid`);
  log(`run ${id} in ${dir}`);
  return dir;
}

async function pass0(dir: string, state: RunState, rows: Map<number, BulkRow>, items: ReturnType<typeof loadRunDir>["items"]) {
  const todo = items.map((item, i) => rows.get(i) ?? newRow(i, item)).filter((r) => r.state === "pending" && r.kind === "ip");
  for (let i = 0; i < todo.length; i += PASS0_BATCH) {
    const batch = todo.slice(i, i + PASS0_BATCH);
    const summaries = await Promise.all(batch.map((r) => runPass0(r.indicator)));
    const settled = batch.flatMap((r, j) => {
      const done = settlePass0(r, summaries[j], state.includeWeak);
      return done ? [done] : [];
    });
    appendRows(dir, settled);
    for (const r of settled) rows.set(r.id, r);
    log(`pass 0: ${Math.min(i + PASS0_BATCH, todo.length)}/${todo.length}`);
  }
}

async function pass1(dir: string, state: RunState, rows: Map<number, BulkRow>, items: ReturnType<typeof loadRunDir>["items"]) {
  const todo = items.map((item, i) => rows.get(i) ?? newRow(i, item)).filter((r) => r.state === "pending" || r.state === "internal");
  let n = 0;
  // One memo per row, the scope of one search: a run-wide memo would hold
  // every request of a 20k-row pass in memory until the pass ends.
  await withLane("bulk", () =>
    mapLimit(todo, state.concurrency, (r) => withRequestMemo(() => runPass1(r)), (r) => {
      appendRows(dir, [r]);
      rows.set(r.id, r);
      if (++n % 100 === 0 || n === todo.length) log(`pass 1: ${n}/${todo.length}`);
    }),
  );
}

async function pass2(dir: string, state: RunState, rows: Map<number, BulkRow>): Promise<boolean> {
  const all = [...rows.values()];
  const total = estimateTotal(estimate(all));
  if (!state.confirmed && total > confirmAt() && !values.yes) {
    log(`pass 2 needs ${total} metered calls: ${JSON.stringify(estimate(all))}`);
    log(`re-run with: bun --env-file=.env.local scripts/bulk.ts --resume ${dir} --yes`);
    return false;
  }
  state.confirmed = true;
  saveState(dir, state);
  await withLane("bulk", async () => {
    for (let row = escalationQueue([...rows.values()])[0]; row; row = escalationQueue([...rows.values()])[0]) {
      const { row: next, waitMs } = await runPass2(row);
      appendRows(dir, [next]);
      rows.set(next.id, next);
      if (waitMs !== undefined) {
        log(`VirusTotal minute cap, waiting ${Math.ceil(waitMs / 1000)}s`);
        await sleep(waitMs);
      }
    }
  });
  return true;
}

const dir = start();
const { state, items, rows } = loadRunDir(dir);
if (state.phase === "pass0") {
  await pass0(dir, state, rows, items);
  state.phase = "pass1";
  saveState(dir, state);
}
if (state.phase === "pass1") {
  await pass1(dir, state, rows, items);
  state.phase = "pass2";
  saveState(dir, state);
}
if (state.phase === "pass2" && (await pass2(dir, state, rows))) {
  state.phase = "done";
  saveState(dir, state);
}
const ordered = items.map((item, i) => summarize(rows.get(i) ?? newRow(i, item)));
process.stdout.write(writeOutputs(dir, ordered, state));
log(`results in ${dir}`);
