import { depthOf, type InvalidInput, type RowSummary } from "./types";

const HEADER = "indicator,display,kind,verdict,risk_score,depth,state,bucket,missing,note,checked_at";

/** Spreadsheets run a cell that starts with one of these as a formula. */
function cell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const line = (values: (string | number | undefined)[]) => values.map(cell).join(",");

export function toCsv(rows: RowSummary[]): string {
  const body = rows.map((r) =>
    line([r.indicator, r.display, r.kind, r.verdict, r.riskScore, depthOf(r), r.state, r.bucket, r.missing.join(";"), r.note, r.checkedAt]),
  );
  return [HEADER, ...body].join("\n") + "\n";
}

export function toJson(rows: RowSummary[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      indicator: r.indicator, display: r.display, kind: r.kind, verdict: r.verdict, riskScore: r.riskScore,
      depth: depthOf(r), state: r.state, bucket: r.bucket, missing: r.missing, note: r.note, checkedAt: r.checkedAt,
    })),
  );
}

export function invalidCsv(invalid: InvalidInput[]): string {
  return ["input,reason", ...invalid.map((i) => line([i.input, i.reason]))].join("\n") + "\n";
}
