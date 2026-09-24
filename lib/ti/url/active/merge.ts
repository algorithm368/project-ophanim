import { hostFromUrl } from "@/lib/url";
import type { FormTarget, ScanCapability } from "./capability";
import type { ScanDetail, ScanVerdictLane } from "./detail";
import type { ScanEngine } from "./engines";
import type { ActiveScan } from "./types";

/** Whose value wins a tie-break in the merged detail. urlscan is first only
 *  because it reports more fields; the loser is never discarded, it is recorded
 *  as a disagreement. */
const ENGINE_ORDER: ScanEngine[] = ["urlscan", "cloudflare"];

interface EngineDisagreement {
  field: string;
  values: { engine: ScanEngine; value: string }[];
  /** Why the difference matters, when it does. */
  note?: string;
}

/**
 * Two scanned URLs of the same indicator answering differently.
 *
 * Deliberately not called a disagreement. Two engines reading one URL and
 * seeing different things are in conflict, and one of them is wrong. An IP's
 * port 80 and port 443 are two services, so a difference between them is not an
 * error to resolve, it is the finding: a redirect stub on 80 and the real
 * application on 443 is exactly what `scanTargetsFor` sends both for.
 */
export interface TargetDifference {
  field: string;
  values: { target: string; value: string }[];
}

export interface MergedScan {
  target: string;
  /** Engines that produced a finished scan. */
  engines: ScanEngine[];
  detail: ScanDetail;
  /** What the captured page can do, across both engines. Carries an error when
   *  no engine managed to read a DOM, so the UI can say the analysis is
   *  unavailable instead of reporting an absence it never observed. */
  capability: ScanCapability;
  disagreements: EngineDisagreement[];
  /** Engines that ran but did not finish, named rather than dropped. */
  incomplete: { engine: ScanEngine; status: string; error?: string }[];
}

/**
 * Fields worth comparing between two readings, with the label the UI shows.
 *
 * Only facts about what was served. A field one reading simply does not report
 * is not a competing claim, so absence never becomes a difference. `read`
 * rather than a bare key because the hop count is a fact about what was served
 * too, and it is a list rather than a string.
 *
 * Exported for the scan page's ballots, which print every engine's answer on
 * these same fields: one list, so the ballot and the disagreements computed
 * here can never be comparing different things.
 */
export const COMPARED: {
  label: string;
  read: (detail: ScanDetail) => string | undefined;
  note?: string;
}[] = [
  {
    label: "HTTP status",
    read: (d) => d.httpStatus,
    note: "A site answering differently by visitor is what a kit dodging scanners does.",
  },
  { label: "Final URL", read: (d) => d.finalUrl },
  { label: "Serving IP", read: (d) => d.ip },
  { label: "Server", read: (d) => d.server },
  { label: "Page title", read: (d) => d.title },
  {
    label: "Redirect hops",
    read: (d) => (d.redirects ? String(d.redirects.length) : undefined),
  },
];

type Finished = { engine: ScanEngine; detail: ScanDetail };

/**
 * Every compared field the readings do not agree on, plus the verdict.
 *
 * Generic over who is being compared because the same comparison serves two
 * questions: two engines reading one URL, and the several URLs one indicator
 * expands to. The wording differs at the call site; the arithmetic does not,
 * and two copies of it would be two chances to compare different field sets.
 */
function differencesBetween<W>(
  readings: { who: W; detail: ScanDetail }[],
  verdictNote: string,
): { field: string; values: { who: W; value: string }[]; note?: string }[] {
  const out: {
    field: string;
    values: { who: W; value: string }[];
    note?: string;
  }[] = [];

  for (const { label, read, note } of COMPARED) {
    const values = readings
      .map(({ who, detail }) => ({ who, value: read(detail) }))
      .filter((r): r is { who: W; value: string } => Boolean(r.value));
    if (values.length < 2) continue;
    if (new Set(values.map((v) => v.value)).size === 1) continue;
    out.push({ field: label, values, ...(note ? { note } : {}) });
  }

  const verdicts = readings.map(({ who, detail }) => ({
    who,
    value: detail.verdicts.overall.malicious ? "malicious" : "not malicious",
  }));
  if (verdicts.length >= 2 && new Set(verdicts.map((v) => v.value)).size > 1) {
    out.push({ field: "Verdict", values: verdicts, note: verdictNote });
  }

  return out;
}

function disagreementsIn(finished: Finished[]): EngineDisagreement[] {
  return differencesBetween(
    finished.map(({ engine, detail }) => ({ who: engine, detail })),
    "One engine flagged this and the other did not.",
  ).map(({ field, values, note }) => ({
    field,
    values: values.map(({ who, value }) => ({ engine: who, value })),
    ...(note ? { note } : {}),
  }));
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

  // `requestCount` is deliberately not seeded here, unlike the other two
  // required fields. A seeded 0 can never be replaced: `isEmptyValue(0)` is
  // false, so the guard below sees the slot as already filled and every
  // engine's real count is discarded. It is defaulted after the loop instead.
  const out: Record<string, unknown> = {
    verdicts: { overall: { malicious: false } },
    absent: [],
  };
  for (const { detail } of ordered) {
    for (const [key, value] of Object.entries(detail)) {
      if (!isEmptyValue(value) && isEmptyValue(out[key])) out[key] = value;
    }
  }
  out.requestCount ??= 0;

  // Malicious anywhere is malicious in the merged reading. The split itself is
  // reported separately as a disagreement, so nothing is hidden by this.
  //
  // Built here rather than left to the loop above, which never replaced the
  // seeded `verdicts` (a seeded object is not empty), so every engine's brands,
  // categories and tags were dropped and "Impersonates" read "no brand named"
  // on a page urlscan had called a Microsoft phish. Labels are unioned: one
  // engine naming a brand is a claim worth keeping even if the other named none.
  const lanes = ordered.map((f) => f.detail.verdicts);
  const union = (pick: (lane: ScanVerdictLane) => string[] | undefined) => {
    const all = [...new Set(lanes.flatMap((l) => pick(l.overall) ?? []))];
    return all.length ? all : undefined;
  };
  out.verdicts = {
    overall: {
      ...lanes[0]?.overall,
      malicious: finished.some((f) => f.detail.verdicts.overall.malicious),
      brands: union((l) => l.brands),
      categories: union((l) => l.categories),
      tags: union((l) => l.tags),
    },
    engines: lanes.find((l) => l.engines)?.engines,
    community: lanes.find((l) => l.community)?.community,
  } satisfies ScanDetail["verdicts"];

  // `absent` is the intersection: a block one engine reported is not absent,
  // and claiming otherwise would understate what is known.
  const absentSets = finished.map((f) => new Set(f.detail.absent));
  out.absent = [...(absentSets[0] ?? new Set<string>())].filter((name) =>
    absentSets.every((set) => set.has(name)),
  );

  return out as unknown as ScanDetail;
}

/**
 * Fold the per-engine DOM readings into one.
 *
 * A password field either engine rendered counts as seen: a kit that shows its
 * form to one visitor and not another is the case this whole feature exists to
 * catch, so presence beats absence. An error survives only when nobody looked
 * successfully, because one engine's failed fetch says nothing about a page the
 * other engine read.
 */
function mergedCapability(finished: ActiveScan[]): ScanCapability {
  const readings = finished
    .map((scan) => scan.capability)
    .filter((c): c is ScanCapability => Boolean(c));

  if (readings.length === 0) {
    return {
      passwordField: false,
      forms: [],
      downloadLinks: [],
      error: "The page DOM was not read.",
    };
  }

  const forms: FormTarget[] = [];
  const seenForms = new Set<string>();
  for (const form of readings.flatMap((r) => r.forms)) {
    if (seenForms.has(form.action)) continue;
    seenForms.add(form.action);
    forms.push(form);
  }

  const succeeded = readings.filter((r) => !r.error);
  return {
    passwordField: readings.some((r) => r.passwordField),
    forms,
    downloadLinks: [...new Set(readings.flatMap((r) => r.downloadLinks))],
    ...(succeeded.length === 0 ? { error: readings[0].error } : {}),
  };
}

/**
 * Which engines reported a value for one field.
 *
 * The merged reading keeps one value per field, so the page needs this to say
 * where a row came from. A claim carried into a ticket has to be attributable
 * to the scanner that made it.
 */
export function attribution(
  scans: ActiveScan[],
  key: keyof ScanDetail,
): ScanEngine[] {
  const engines: ScanEngine[] = [];
  for (const scan of scans) {
    if (scan.status !== "done" || !scan.detail) continue;
    const value = scan.detail[key];
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (!empty && !engines.includes(scan.engine)) engines.push(scan.engine);
  }
  return engines;
}

/** One reading for the whole indicator, folded across every URL that was sent. */
export interface MergedIndicator {
  /** The URLs that were scanned, in the order they were submitted. */
  targets: string[];
  engines: ScanEngine[];
  detail: ScanDetail;
  capability: ScanCapability;
  /** Engines that read the same URL and saw different things, each tagged with
   *  the URL it was about: two engines disagreeing about port 80 and the same
   *  two disagreeing about port 443 are two findings, and without the tag they
   *  print as one finding stated twice with its values swapped. */
  disagreements: (EngineDisagreement & { target: string })[];
  /** Scanned URLs that answered differently. Evidence, not conflict. */
  targetDifferences: TargetDifference[];
  /**
   * The URLs served materially different pages rather than one site answering
   * on two ports, so the folded reading below describes more than one thing and
   * the page has to say so.
   */
  separateSites: boolean;
  incomplete: { engine: ScanEngine; status: string; error?: string }[];
  /** The per-target readings this was folded from, so a caller can still show
   *  one URL on its own. */
  perTarget: MergedScan[];
}

/**
 * The folded reading in the shape a single-URL reader wants.
 *
 * `buildScanNarrative` writes about "this URL" and compares where the trip
 * ended against the host that was submitted, which needs one target rather than
 * a list. The first URL sent stands in: an IP's two ports share a host, so the
 * host-to-host comparison it feeds is the same either way, and everything else
 * on the folded reading already describes both.
 */
export function asSingleScan(m: MergedIndicator): MergedScan {
  return {
    target: m.targets[0] ?? "",
    engines: m.engines,
    detail: m.detail,
    capability: m.capability,
    disagreements: m.disagreements,
    incomplete: m.incomplete,
  };
}

/** The identity of a page: where the trip ended and what the page called
 *  itself. Two URLs matching on both are one site. */
function pageIdentity(detail: ScanDetail): string | undefined {
  const host = detail.finalUrl ? hostFromUrl(detail.finalUrl) : undefined;
  const parts = [host, detail.title].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Whether the scanned URLs led to different pages.
 *
 * Compared on where the trip ended and what the page was called, not on every
 * field. An IP whose two ports both redirect to the same host is one site even
 * when one takes an extra hop, and calling that "separate sites" would put a
 * warning on the ordinary case. Readings that report neither host nor title
 * cannot answer the question, so they are left out rather than counted as
 * matching.
 */
function servesSeparateSites(perTarget: MergedScan[]): boolean {
  const identities = perTarget
    .map((t) => pageIdentity(t.detail))
    .filter((id): id is string => Boolean(id));
  return identities.length >= 2 && new Set(identities).size > 1;
}

/**
 * Fold every scanned URL of one indicator into a single reading.
 *
 * A bare IP is submitted on both ports, so the page would otherwise render two
 * near-identical teardowns whose paragraphs match almost word for word. Folding
 * them is only honest because what differs is reported rather than dropped:
 * `targetDifferences` names every field the URLs answered differently on, and
 * `separateSites` says when the difference is large enough that one reading is
 * describing two things.
 */
export function mergeTargets(scans: ActiveScan[]): MergedIndicator {
  const perTarget = mergeScans(scans);
  const done = scans.filter((s) => s.status === "done" && s.detail);
  const finished: Finished[] = done.map((s) => ({
    engine: s.engine,
    detail: s.detail as ScanDetail,
  }));

  const readable = perTarget.filter((t) => t.engines.length > 0);
  const targetDifferences = differencesBetween(
    readable.map((t) => ({ who: t.target, detail: t.detail })),
    "One of the scanned URLs was flagged and the other was not.",
  ).map(({ field, values }) => ({
    field,
    values: values.map(({ who, value }) => ({ target: who, value })),
  }));

  const engines: ScanEngine[] = [];
  for (const { engine } of finished) {
    if (!engines.includes(engine)) engines.push(engine);
  }

  return {
    targets: perTarget.map((t) => t.target),
    engines,
    detail: mergedDetail(finished),
    capability: mergedCapability(done),
    // Engine conflicts stay per-target: two engines disagreeing about port 80
    // is a different claim from the same two disagreeing about port 443, and
    // pooling them would invent a conflict neither reported.
    disagreements: perTarget.flatMap((t) =>
      t.disagreements.map((d) => ({ ...d, target: t.target })),
    ),
    targetDifferences,
    separateSites: servesSeparateSites(readable),
    incomplete: perTarget.flatMap((t) => t.incomplete),
    perTarget,
  };
}

/** One merged reading per scanned target. */
export function mergeScans(scans: ActiveScan[]): MergedScan[] {
  const byTarget = new Map<string, ActiveScan[]>();
  for (const scan of scans) {
    byTarget.set(scan.target, [...(byTarget.get(scan.target) ?? []), scan]);
  }

  return [...byTarget.entries()].map(([target, group]) => {
    const done = group.filter((s) => s.status === "done" && s.detail);
    const finished: Finished[] = done.map((s) => ({
      engine: s.engine,
      detail: s.detail as ScanDetail,
    }));
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
      capability: mergedCapability(done),
      disagreements: disagreementsIn(finished),
      incomplete,
    };
  });
}
