import { parseIP, parseIPv4 } from "../../ip";

/**
 * The rows of a ballot grid, with interchangeable voters merged.
 *
 * A domain's location is voted on per address it resolves to, and a name
 * behind a load balancer resolves to many: xvideos.com answers with fifteen
 * addresses in one /24, every one of them voting the same country and city.
 * Fifteen identical rows is one fact said fifteen times, and it pushed the
 * rail to three times the height of the page beside it.
 *
 * Only addresses merge. Two providers that happen to agree are still two
 * witnesses, and which provider said what is the point of their rows; two
 * addresses behind one name are not, so they collapse into one row with a
 * count. An address that votes differently keeps its own row, so a dissent is
 * never folded into the majority.
 */

/** Rows shown before the rest fold behind a "more" line: one per location
 *  provider there is, so an address's own ballot never folds and only a name
 *  with more distinct answers than that does. */
export const BALLOT_ROW_CAP = 9;

export interface BallotRow {
  /** Stable key: the first voter's id. */
  key: string;
  /** Every voter the row stands for, in their original order. */
  ids: string[];
  label: string;
}

/**
 * @param signature what a voter said, as a string: equal strings merge.
 * @param label a single voter's name.
 */
export function ballotRows(
  ids: string[],
  signature: (id: string) => string,
  label: (id: string) => string,
): BallotRow[] {
  if (!ids.every((id) => parseIP(id))) {
    return ids.map((id) => ({ key: id, ids: [id], label: label(id) }));
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const sig = signature(id);
    groups.set(sig, [...(groups.get(sig) ?? []), id]);
  }
  return [...groups.values()].map((group) => ({
    key: group[0],
    ids: group,
    label: group.length === 1 ? label(group[0]) : addressesLabel(group),
  }));
}

/** "89.222.127.x" for addresses in one /24, "89.222.x.x" in one /16, and a
 *  plain count otherwise. */
export function addressesLabel(ids: string[]): string {
  const octets = ids.map((id) => parseIPv4(id)?.octets);
  if (octets.every((o) => o !== undefined)) {
    for (const keep of [3, 2] as const) {
      const prefix = octets[0].slice(0, keep).join(".");
      if (octets.every((o) => o.slice(0, keep).join(".") === prefix)) {
        return `${prefix}${".x".repeat(4 - keep)}`;
      }
    }
  }
  return `${ids.length} addresses`;
}
