"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseBulkInput, WEB_CAP } from "@/lib/ti/bulk/parse";
import { ConfirmBar } from "./confirm-bar";
import { QuotaStrip } from "./quota-strip";
import { ResultsTable } from "./results-table";
import { useBulkRun } from "./use-bulk-run";

export function BulkLookup() {
  const router = useRouter();
  const runId = useSearchParams().get("run");
  const [text, setText] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { view, phase, error, accept, skip } = useBulkRun(runId);
  // At the 1,000-row cap a parse takes milliseconds; memoised, it is one pass
  // per change rather than one per render.
  const parsed = useMemo(() => parseBulkInput(text), [text]);
  const ips = parsed.items.filter((i) => i.kind === "ip").length;
  const internal = parsed.items.filter((i) => i.internal).length;

  async function submit() {
    setSubmitError(null);
    const res = await fetch("/api/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: text }) });
    const body = await res.json();
    if (!res.ok) return setSubmitError(body.error);
    router.push(`/bulk?run=${body.runId}`);
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Bulk lookup</h1>
      <textarea
        aria-label="Indicators, one per line"
        className="h-40 w-full rounded-md border border-border bg-background p-3 font-mono text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste IPs and domains, one per line. Defanged is fine."
      />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {parsed.items.length} indicators, {ips} IP, {parsed.items.length - ips} domain, {parsed.duplicates} duplicates, {internal} internal, {parsed.invalid.length} not supported
        </span>
        <Button onClick={submit} disabled={parsed.items.length === 0 || parsed.items.length > WEB_CAP}>Look up</Button>
      </div>
      {parsed.items.length > WEB_CAP && (
        <p className="text-sm">More than {WEB_CAP} indicators. Use the CLI: bun --env-file=.env.local scripts/bulk.ts your-file.txt</p>
      )}
      {submitError && <p role="alert" className="text-sm">{submitError}</p>}
      {error && <p role="alert" className="text-sm">{error}</p>}
      {phase === "confirm" && view && <ConfirmBar estimate={view.estimate} quota={view.quota} onAccept={accept} onSkip={skip} />}
      {phase === "waiting" && <p className="text-sm text-muted-foreground">VirusTotal allows 4 lookups a minute, continuing shortly.</p>}
      {view && <ResultsTable rows={view.run.rows} runId={view.run.id} />}
      {view && <QuotaStrip quota={view.quota} />}
    </section>
  );
}
