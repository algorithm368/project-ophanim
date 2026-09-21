import type { AnyResult } from "./subject-record";
import { parseSeen, seenRange } from "./subject-record";
import { isHashResult } from "./types";

/**
 * What is left of the bestiary panel's stat bank.
 *
 * The panel used to open with five named ladders: priors, evidence, consensus,
 * activity, and one slot that varied by IOC type. Four of the five were removed
 * once the rest of the card grew into them, and the removals are worth
 * recording, because each one was a duplicate rather than a simplification:
 *
 *   priors      the summary's Checked column already counts them
 *   evidence    the detector rows in Evidence say which source, at what score
 *   consensus   the same rows, plus Coverage and Agreement in the foot
 *   exposure    the subject record's Open ports row, and the vitals
 *   tenure      the vitals' registration date, and the record's Registered row
 *   detection   the detector rows, where VirusTotal's tally is one of them
 *
 * Activity is the one measurement nothing else on the card carries, so it is
 * the one that stayed. It is rendered as a line in the Checked column rather
 * than as a ladder, since one ladder alone is a chart of a single number.
 *
 * `PanelRung` outlived the bank: the confidence axes in the foot still draw on
 * the same four named rungs, and the three states below are still what that
 * drawing has to keep apart.
 *
 *   rung 0    measured, and nothing on this axis  -> four outlined rungs
 *   rung null no measurement at all               -> four hatched rungs
 *
 * A measured zero drawn as an absence is a lie about the evidence, which is the
 * failure this model is built to make impossible rather than merely unlikely.
 */
export type PanelRung = 0 | 1 | 2 | 3 | 4 | null;

export type PanelStat = {
  /** Stable id, for keys and tests. */
  key: string;
  /** The axis name, e.g. "Activity". */
  label: string;
  /** The rung's name, e.g. "Dormant". Never a number. */
  value: string;
  rung: PanelRung;
  /** One line of the evidence behind the rung. */
  detail?: string;
};

const DAY = 86_400_000;
const NO_RECORD = "No record";

/** How recently a source last saw it. Absent when nobody dated their sighting,
 *  which is a gap in the evidence and must not read as "quiet". */
export function activityStat(r: AnyResult, now: number = Date.now()): PanelStat {
  const base = { key: "activity", label: "Activity" } as const;
  const seen = seenRange(r.sources, isHashResult(r) ? r.context : undefined);
  const last = parseSeen(seen?.last);
  if (last === undefined) return { ...base, value: NO_RECORD, rung: null };
  const age = now - last;
  const detail = sinceLabel(age);
  if (age < DAY) return { ...base, value: "Live", rung: 4, detail };
  if (age < 7 * DAY) return { ...base, value: "Recent", rung: 3, detail };
  if (age < 30 * DAY) return { ...base, value: "This month", rung: 2, detail };
  return { ...base, value: "Dormant", rung: 1, detail };
}

function sinceLabel(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(ms / DAY)}d ago`;
}

/** The last sighting as one phrase, for the Checked column: the age when a
 *  source dated one, and the absence in its own words when none did. */
export function lastSeenLabel(r: AnyResult, now?: number): string {
  const stat = activityStat(r, now);
  return stat.detail ?? "no record";
}
