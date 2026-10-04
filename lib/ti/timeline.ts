import { parseSeen } from "./subject-record";
import { isDomainResult, isHashResult } from "./types";
import type { AnyCheckResult, SourceResult } from "./types";

/**
 * The indicator's life, in the order the outside world recorded it.
 *
 * Only what the sources dated. Ophanim's own check history is deliberately
 * absent: it says when we looked, not when anything happened.
 *
 * Every kind appears once. Several sources reporting the same kind fold into
 * one row, dated by the earliest (or, for the "last" kinds, the latest), with
 * the rest kept in `also`, so a data-rich hash stays a short story instead of
 * six "first seen" rows in one February.
 */

export type EventKind =
  | "registered"
  | "first-resolved"
  | "cert-issued"
  | "first-seen"
  | "listed"
  | "last-seen"
  | "last-resolved"
  | "last-reported"
  | "cert-expires"
  | "expires";

export type PhaseKind =
  | "before-records"
  | "dormant"
  | "live"
  | "listed"
  | "quiet"
  | "paid-to"
  | "lapsed";

export interface TimelineEvent {
  kind: EventKind;
  /** ISO day, from the winning source. */
  at: string;
  source: string;
  also: { source: string; at: string }[];
  detail?: string;
  tone: "neutral" | "adverse" | "future";
}

export interface TimelineGap {
  after: EventKind;
  months: number;
}

export interface Phase {
  kind: PhaseKind;
  from: string;
  to: string;
  /** Still running as of `now`. */
  ongoing: boolean;
  /** The events that open and close it, for the ledger highlight. */
  edges: EventKind[];
}

export interface Timeline {
  now: string;
  events: TimelineEvent[];
  gaps: TimelineGap[];
  phases: Phase[];
  sourceCount: number;
}

export const EVENT_LABEL: Record<EventKind, string> = {
  registered: "Registered",
  "first-resolved": "First resolved",
  "cert-issued": "Cert issued",
  "first-seen": "First seen",
  listed: "Listed",
  "last-seen": "Last seen",
  "last-resolved": "Last resolved",
  "last-reported": "Last reported",
  "cert-expires": "Cert expires",
  expires: "Expires",
};

export const PHASE_LABEL: Record<PhaseKind, string> = {
  "before-records": "Before records",
  dormant: "Dormant",
  live: "Live",
  listed: "Listed",
  quiet: "Quiet",
  "paid-to": "Paid ahead",
  lapsed: "Lapsed",
};

/** Kind order, which is also the tie-break for two events on one day. */
const ORDER: EventKind[] = Object.keys(EVENT_LABEL) as EventKind[];

const LATEST_WINS = new Set<EventKind>([
  "last-seen",
  "last-resolved",
  "last-reported",
  "cert-expires",
  "expires",
]);

/** Sources whose malicious finding is a listing: a curated feed put the
 *  indicator on it on a date. A scanner's verdict (VirusTotal) is not. */
const LISTING_SOURCES = new Set(["feodo", "threatfox", "urlhaus", "malwarebazaar", "abuseipdb"]);

/** The `details` keys that carry a first-seen (see subject-record.ts). */
const FIRST_SEEN_KEYS = ["firstSeen", "feedFirstSeen"] as const;

type Kind = "ip" | "domain" | "hash";
type Candidate = { kind: EventKind; ms: number; source: string; detail?: string };

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** An expiry may sit years ahead, past `parseSeen`'s next-year cap. */
function parseExpiry(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || new Date(ms).getUTCFullYear() < 1990) return undefined;
  return ms;
}

function firstSeenOf(s: SourceResult): string | undefined {
  if (s.hashContext?.firstSeen) return s.hashContext.firstSeen;
  for (const key of FIRST_SEEN_KEYS) {
    const v = s.details?.[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function domainCandidates(
  s: SourceResult,
  push: (k: EventKind, ms?: number, d?: string) => void,
  parse: (value: string | undefined) => number | undefined,
) {
  const ctx = s.domainContext;
  push("registered", parse(ctx?.createdAt), ctx?.registrar && `via ${ctx.registrar}`);
  push("expires", parseExpiry(ctx?.expiresAt));
  for (const c of s.certificates ?? []) {
    push("cert-issued", parse(c.firstSeen), c.issuer);
    push("cert-expires", parseExpiry(c.notAfter));
  }
}

function sourceCandidates(s: SourceResult, kind: Kind, now: Date): Candidate[] {
  const out: Candidate[] = [];
  const latest = new Date(now);
  latest.setUTCFullYear(latest.getUTCFullYear() + 1);
  const parse = (value: string | undefined) => {
    const ms = parseSeen(value, now);
    return ms !== undefined && ms <= latest.getTime() ? ms : undefined;
  };
  const push = (k: EventKind, ms?: number, detail?: string) => {
    if (ms !== undefined) out.push({ kind: k, ms, source: s.source.id, detail: detail || undefined });
  };

  if (kind === "domain") domainCandidates(s, push, parse);
  if (kind !== "hash") {
    for (const p of s.passiveDns ?? []) {
      push("first-resolved", parse(p.firstSeen), `to ${p.value}`);
      push("last-resolved", parse(p.lastSeen), `to ${p.value}`);
    }
  }

  const first = parse(firstSeenOf(s));
  const last = parse(s.hashContext?.lastSeen ?? s.lastSeen);
  const listing = s.malicious === true && LISTING_SOURCES.has(s.source.id);
  const what = s.categories?.slice(0, 2).join(", ");

  if (kind === "hash") {
    push("first-seen", first);
    push("last-seen", last);
    if (listing) push("listed", first, what);
  } else if (listing) {
    push("listed", first, what);
    push("last-reported", last, what);
  } else {
    push("first-seen", first);
    push("last-seen", last);
  }
  return out;
}

function wins(kind: EventKind, a: Candidate, b: Candidate): boolean {
  return LATEST_WINS.has(kind) ? a.ms > b.ms : a.ms < b.ms;
}

function foldKind(kind: EventKind, candidates: Candidate[], nowMs: number): TimelineEvent {
  const perSource = new Map<string, Candidate>();
  for (const c of candidates) {
    const held = perSource.get(c.source);
    if (!held || wins(kind, c, held)) perSource.set(c.source, c);
  }
  const ranked = [...perSource.values()].sort(
    (a, b) => (wins(kind, a, b) ? -1 : 0) || (wins(kind, b, a) ? 1 : 0) || a.source.localeCompare(b.source),
  );
  const [winner, ...rest] = ranked;
  let tone: TimelineEvent["tone"] = "neutral";
  if (winner.ms > nowMs) tone = "future";
  else if (kind === "listed" || kind === "last-reported") tone = "adverse";
  return {
    kind,
    at: isoDay(winner.ms),
    source: winner.source,
    also: rest.map((c) => ({ source: c.source, at: isoDay(c.ms) })),
    detail: winner.detail,
    tone,
  };
}

/** Whole calendar months from one ISO day to a later one. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

const GAP_MONTHS = 6;

function findGaps(events: TimelineEvent[]): TimelineGap[] {
  const gaps: TimelineGap[] = [];
  for (let i = 1; i < events.length; i++) {
    const months = monthsBetween(events[i - 1].at, events[i].at);
    if (months >= GAP_MONTHS) gaps.push({ after: events[i - 1].kind, months });
  }
  return gaps;
}

function kindOf(result: AnyCheckResult): Kind {
  if (isHashResult(result)) return "hash";
  if (isDomainResult(result)) return "domain";
  return "ip";
}

export function buildTimeline(result: AnyCheckResult, now = new Date(result.checkedAt)): Timeline {
  const kind = kindOf(result);
  const nowMs = now.getTime();
  const candidates = result.sources
    .filter((s) => s.status === "ok")
    .flatMap((s) => sourceCandidates(s, kind, now));

  const events = ORDER.flatMap((k) => {
    const of = candidates.filter((c) => c.kind === k);
    return of.length ? [foldKind(k, of, nowMs)] : [];
  }).sort((a, b) => a.at.localeCompare(b.at) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  const sources = new Set(events.flatMap((e) => [e.source, ...e.also.map((a) => a.source)]));

  return {
    now: isoDay(nowMs),
    events,
    gaps: findGaps(events),
    phases: buildPhases(events, kind, nowMs),
    sourceCount: sources.size,
  };
}

/** Filled in by Task 3. */
function buildPhases(_events: TimelineEvent[], _kind: Kind, _nowMs: number): Phase[] {
  void _events;
  void _kind;
  void _nowMs;
  return [];
}
