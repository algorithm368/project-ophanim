"use client";

import { Button } from "@/components/ui/button";
import type { QuotaRemaining } from "@/lib/ti/bulk/quota";
import type { MeteredId, MeteredKeyEnv } from "@/lib/ti/bulk/types";

export const SOURCE_NAMES: Record<MeteredId, string> = {
  virustotal: "VirusTotal", abuseipdb: "AbuseIPDB", greynoise: "GreyNoise", otx: "OTX", safebrowsing: "Safe Browsing",
};
export const KEY_OF: Record<MeteredId, MeteredKeyEnv> = {
  virustotal: "VIRUSTOTAL_API_KEY", abuseipdb: "ABUSEIPDB_API_KEY", greynoise: "GREYNOISE_API_KEY", otx: "OTX_API_KEY", safebrowsing: "GOOGLE_SAFE_BROWSING_API_KEY",
};

export function poolLabel(id: MeteredId, quota: QuotaRemaining[] | null): string {
  const pool = quota?.find((q) => q.keyEnv === KEY_OF[id]);
  return `${SOURCE_NAMES[id]} (${pool?.own ? "bulk key" : "shared"})`;
}

export function ConfirmBar({ estimate, quota, onAccept, onSkip }: Readonly<{
  estimate: Partial<Record<MeteredId, number>>;
  quota: QuotaRemaining[] | null;
  onAccept: () => void;
  onSkip: () => void;
}>) {
  const ids = Object.keys(estimate) as MeteredId[];
  const need = ids.map((id) => `${estimate[id]} ${poolLabel(id, quota)}`).join(", ");
  const left = ids.map((id) => quota?.find((q) => q.keyEnv === KEY_OF[id])?.bulkLeft ?? 0).join(" and ");
  return (
    <div role="status" className="flex items-center justify-between gap-4 rounded-md border border-border p-3 text-sm">
      <p>Enrichment needs {need} lookups. Bulk has {left} left today.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onAccept}>Enrich</Button>
        <Button size="sm" variant="outline" onClick={onSkip}>Skip</Button>
      </div>
    </div>
  );
}
