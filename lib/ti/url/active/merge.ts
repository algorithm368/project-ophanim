import type { ScanDetail } from "./detail";
import type { ScanEngine } from "./engines";
import type { ActiveScan } from "./types";

/** Whose value wins a tie-break in the merged detail. urlscan is first only
 *  because it reports more fields; the loser is never discarded, it is recorded
 *  as a disagreement. */
const ENGINE_ORDER: ScanEngine[] = ["urlscan", "cloudflare"];

export interface EngineDisagreement {
  field: string;
  values: { engine: ScanEngine; value: string }[];
  /** Why the difference matters, when it does. */
  note?: string;
}

export interface MergedScan {
  target: string;
  /** Engines that produced a finished scan. */
  engines: ScanEngine[];
  detail: ScanDetail;
  disagreements: EngineDisagreement[];
  /** Engines that ran but did not finish, named rather than dropped. */
  incomplete: { engine: ScanEngine; status: string; error?: string }[];
}

/**
 * Fields worth comparing across engines, with the label the UI shows.
 *
 * Only facts about what was served. A field one engine simply does not report
 * is not a competing claim, so absence never becomes a disagreement.
 */
const COMPARED: { key: keyof ScanDetail; label: string; note?: string }[] = [
  {
    key: "httpStatus",
    label: "HTTP status",
    note: "A site answering differently by visitor is what a kit dodging scanners does.",
  },
  { key: "finalUrl", label: "Final URL" },
  { key: "ip", label: "Serving IP" },
  { key: "server", label: "Server" },
  { key: "title", label: "Page title" },
];

type Finished = { engine: ScanEngine; detail: ScanDetail };

function readingsOf(
  finished: Finished[],
  key: keyof ScanDetail,
): { engine: ScanEngine; value: string }[] {
  return finished
    .map(({ engine, detail }) => ({ engine, value: detail[key] }))
    .filter(
      (r): r is { engine: ScanEngine; value: string } =>
        typeof r.value === "string" && r.value !== "",
    );
}

function disagreementsIn(finished: Finished[]): EngineDisagreement[] {
  const out: EngineDisagreement[] = [];

  for (const { key, label, note } of COMPARED) {
    const values = readingsOf(finished, key);
    if (values.length < 2) continue;
    if (new Set(values.map((v) => v.value)).size === 1) continue;
    out.push({ field: label, values, ...(note ? { note } : {}) });
  }

  const verdicts = finished.map(({ engine, detail }) => ({
    engine,
    value: detail.verdicts.overall.malicious ? "malicious" : "not malicious",
  }));
  if (verdicts.length >= 2 && new Set(verdicts.map((v) => v.value)).size > 1) {
    out.push({
      field: "Verdict",
      values: verdicts,
      note: "One engine flagged this and the other did not.",
    });
  }

  return out;
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** First non-empty value across engines, in ENGINE_ORDER. */
function mergedDetail(finished: Finished[]): ScanDetail {
  const ordered = [...finished].sort(
    (a, b) => ENGINE_ORDER.indexOf(a.engine) - ENGINE_ORDER.indexOf(b.engine),
  );

  const out: Record<string, unknown> = {
    requestCount: 0,
    verdicts: { overall: { malicious: false } },
    absent: [],
  };
  for (const { detail } of ordered) {
    for (const [key, value] of Object.entries(detail)) {
      if (!isEmptyValue(value) && isEmptyValue(out[key])) out[key] = value;
    }
  }

  // Malicious anywhere is malicious in the merged reading. The split itself is
  // reported separately as a disagreement, so nothing is hidden by this.
  const verdicts = out.verdicts as ScanDetail["verdicts"];
  out.verdicts = {
    ...verdicts,
    overall: {
      ...verdicts.overall,
      malicious: finished.some((f) => f.detail.verdicts.overall.malicious),
    },
  };

  // `absent` is the intersection: a block one engine reported is not absent,
  // and claiming otherwise would understate what is known.
  const absentSets = finished.map((f) => new Set(f.detail.absent));
  out.absent = [...(absentSets[0] ?? new Set<string>())].filter((name) =>
    absentSets.every((set) => set.has(name)),
  );

  return out as unknown as ScanDetail;
}

/** One merged reading per scanned target. */
export function mergeScans(scans: ActiveScan[]): MergedScan[] {
  const byTarget = new Map<string, ActiveScan[]>();
  for (const scan of scans) {
    byTarget.set(scan.target, [...(byTarget.get(scan.target) ?? []), scan]);
  }

  return [...byTarget.entries()].map(([target, group]) => {
    const finished: Finished[] = group
      .filter((s) => s.status === "done" && s.detail)
      .map((s) => ({ engine: s.engine, detail: s.detail as ScanDetail }));
    const incomplete = group
      .filter((s) => s.status !== "done" || !s.detail)
      .map((s) => ({
        engine: s.engine,
        status: s.status,
        ...(s.error ? { error: s.error } : {}),
      }));

    return {
      target,
      engines: finished.map((f) => f.engine),
      detail: mergedDetail(finished),
      disagreements: disagreementsIn(finished),
      incomplete,
    };
  });
}
