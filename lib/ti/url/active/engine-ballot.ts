import { count } from "@/lib/text";
import type { VoteCell } from "@/lib/ti/geo/votes";
import type { ScanDetail } from "./detail";
import type { ScanEngine } from "./engines";
import { COMPARED } from "./merge";
import type { ActiveScan } from "./types";

/** One question the engines were both asked, as the rail's grid names it. */
export interface BallotField {
  key: string;
  label: string;
  /** Each engine's mark for this field. */
  cells: Partial<Record<ScanEngine, VoteCell>>;
}

/** Every engine that read one URL, and how their answers line up. */
export interface EngineBallot {
  target: string;
  engines: ScanEngine[];
  fields: BallotField[];
}

const VERDICT = {
  label: "Verdict",
  read: (d: ScanDetail) => (d.verdicts.overall.malicious ? "malicious" : "not malicious"),
};

/** The verdict first, then the facts `mergeScans` compares, in its order, so
 *  the grid and the merge can never be comparing different things. */
const FIELDS = [VERDICT, ...COMPARED];

/**
 * Each engine's mark on one field.
 *
 * The answer most engines gave wins. When there is no single most common
 * answer, as with two engines that disagree, nobody wins and every answer is a
 * dissent: picking one of two scanners as the right one would be the page
 * taking a side it has no evidence for. An engine that said nothing is silent,
 * not dissenting.
 */
function cellsFor(
  readings: { engine: ScanEngine; value: string | undefined }[],
): Partial<Record<ScanEngine, VoteCell>> {
  const tally = new Map<string, number>();
  for (const { value } of readings) {
    if (value) tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  const top = Math.max(0, ...tally.values());
  const leaders = [...tally.entries()].filter(([, n]) => n === top);
  const winner = leaders.length === 1 ? leaders[0][0] : undefined;

  const cells: Partial<Record<ScanEngine, VoteCell>> = {};
  for (const { engine, value } of readings) {
    if (!value) cells[engine] = { status: "absent" };
    else if (value === winner) cells[engine] = { status: "win" };
    else cells[engine] = { status: "dissent", value };
  }
  return cells;
}

/**
 * The engines' answers per URL, for every URL two or more of them finished
 * reading. One engine has nobody to agree with, so a URL only it read has no
 * ballot at all.
 */
export function engineBallots(scans: ActiveScan[]): EngineBallot[] {
  const byTarget = new Map<string, { engine: ScanEngine; detail: ScanDetail }[]>();
  for (const scan of scans) {
    if (scan.status !== "done" || !scan.detail) continue;
    byTarget.set(scan.target, [
      ...(byTarget.get(scan.target) ?? []),
      { engine: scan.engine, detail: scan.detail },
    ]);
  }
  return [...byTarget.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([target, group]) => ({
      target,
      engines: group.map((g) => g.engine),
      fields: FIELDS.map(({ label, read }) => ({
        key: label,
        label,
        cells: cellsFor(group.map((g) => ({ engine: g.engine, value: read(g.detail) }))),
      })),
    }));
}

/** How many fields, across every ballot, the engines split on. */
export function ballotSplits(ballots: EngineBallot[]): number {
  return ballots.reduce(
    (n, b) =>
      n + b.fields.filter((f) => Object.values(f.cells).some((c) => c?.status === "dissent")).length,
    0,
  );
}

/** The ballot as one word for the rail, or nothing when there is no ballot. */
export function agreementLevel(ballots: EngineBallot[]): string | undefined {
  if (ballots.length === 0) return undefined;
  const splits = ballotSplits(ballots);
  return splits === 0 ? "Agree" : count(splits, "split");
}
