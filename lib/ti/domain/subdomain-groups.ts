/**
 * A domain's subdomains, sorted into the families they were named in.
 *
 * Certificate transparency hands back names in bulk, and a large estate names
 * its hosts by pattern: Google files a third of its names under `.cloud`, True
 * Digital prefixes ninety-eight of its with `tmn-clf-`. Read as one alphabetical
 * list, the pattern is what the eye has to wade through to reach the part that
 * differs. Grouped, the pattern is said once, in the heading, and each row is
 * only the part that tells it apart.
 *
 * Two kinds of family, tried in this order, each needing `MIN_GROUP` names:
 *
 *  - **A zone**: the label just above the apex (`*.cloud`, which takes
 *    `console.eu.cloud` too). A zone is a delegation someone made on purpose,
 *    so it outranks a naming habit.
 *  - **A prefix** of the first label, by its first two hyphenated words
 *    (`tmn-clf-*`) and then by its first word (`tmn-*`), so the most specific
 *    family a name belongs to is the one it lands in.
 *
 * Whatever is left is `other`, always last, however large.
 */

export type SubdomainName = {
  /** The whole name, for copying and for checking it. */
  full: string;
  /** The part that tells it apart within its group. */
  shown: string;
  /** The zone it sits under, drawn quiet after `shown`. Only zone groups. */
  quiet?: string;
};

export type SubdomainGroup = {
  kind: "zone" | "prefix" | "other";
  /** How the heading names the family: `*.cloud`, `tmn-clf-*`, or `Other`. */
  pattern: string;
  /** In alphabetical order. */
  names: SubdomainName[];
};

const MIN_GROUP = 3;

function bucket(names: string[], keyOf: (rel: string) => string | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const rel of names) {
    const key = keyOf(rel);
    if (key === undefined) continue;
    const list = out.get(key) ?? [];
    list.push(rel);
    out.set(key, list);
  }
  return out;
}

/** The first `n` hyphenated words of the first label, when it has more than
 *  `n` of them; a one-word family also takes the bare word itself, so
 *  `smartconnectivity` sits with `smartconnectivity-dev`. */
function prefixKey(rel: string, n: number): string | undefined {
  const words = rel.split(".")[0].split("-");
  if (words.length > n) return words.slice(0, n).join("-");
  return n === 1 ? words[0] : undefined;
}

export function groupSubdomains(names: string[], apex: string): SubdomainGroup[] {
  const suffix = `.${apex}`;
  const under = [...new Set(names)].filter((n) => n.endsWith(suffix));
  const outside = names.filter((n) => !n.endsWith(suffix));
  const rel = under.map((n) => n.slice(0, -suffix.length));
  const groups: SubdomainGroup[] = [];
  const taken = new Set<string>();
  const full = (r: string) => `${r}${suffix}`;

  const zones = bucket(rel, (r) => (r.includes(".") ? r.slice(r.lastIndexOf(".") + 1) : undefined));
  for (const [zone, members] of zones) {
    if (members.length < MIN_GROUP) continue;
    members.forEach((r) => taken.add(r));
    groups.push({
      kind: "zone",
      pattern: `*.${zone}`,
      names: members.map((r) => ({ full: full(r), shown: r.slice(0, -(zone.length + 1)), quiet: `.${zone}` })),
    });
  }

  for (const n of [2, 1]) {
    const families = bucket(
      rel.filter((r) => !taken.has(r)),
      (r) => prefixKey(r, n),
    );
    for (const [key, members] of families) {
      if (members.length < MIN_GROUP) continue;
      members.forEach((r) => taken.add(r));
      groups.push({
        kind: "prefix",
        pattern: `${key}-*`,
        names: members.map((r) => ({ full: full(r), shown: r === key ? r : r.slice(key.length + 1) })),
      });
    }
  }

  groups.sort((a, b) => b.names.length - a.names.length || a.pattern.localeCompare(b.pattern));
  const rest = [
    ...rel.filter((r) => !taken.has(r)).map((r) => ({ full: full(r), shown: r })),
    ...outside.map((n) => ({ full: n, shown: n })),
  ];
  if (rest.length) groups.push({ kind: "other", pattern: "Other", names: rest });

  for (const g of groups) g.names.sort((a, b) => a.shown.localeCompare(b.shown));
  return groups;
}
