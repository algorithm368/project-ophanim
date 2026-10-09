"use client";

import type { QuotaRemaining } from "@/lib/ti/bulk/quota";
import type { MeteredId } from "@/lib/ti/bulk/types";
import { KEY_OF, SOURCE_NAMES } from "./confirm-bar";

const ID_OF = Object.fromEntries(Object.entries(KEY_OF).map(([id, key]) => [key, id as MeteredId]));

/** One pool, in words. A bulk key is all bulk's, a shared key is split with
 *  /check, so it says what bulk may still spend and what the day has used. */
export function quotaLine(q: QuotaRemaining): string {
  const name = SOURCE_NAMES[ID_OF[q.keyEnv]];
  if (q.own) return `${name}, bulk key, ${q.bulkLeft} of ${q.daily} left`;
  return `${name}, shared, ${q.bulkLeft} left for bulk, ${q.used} used today`;
}

export function QuotaStrip({ quota }: Readonly<{ quota: QuotaRemaining[] | null }>) {
  if (!quota || quota.length === 0) return null;
  return (
    <ul aria-label="Quota left today" className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
      {quota.map((q) => (
        <li key={q.keyEnv}>{quotaLine(q)}</li>
      ))}
    </ul>
  );
}
