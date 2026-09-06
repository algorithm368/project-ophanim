import type { Confidence, GeoResolution, ResolvedField } from "../types";
import { authorityFor, type GeoField } from "./weights";

type VoteStatus = "win" | "dissent" | "absent" | "scatter";

export interface VoteCell {
  status: VoteStatus;
  /** the differing value to show when status === "dissent" */
  value?: string;
  /** this provider is the allocation authority and it backed the winner */
  authority?: boolean;
}

export interface VoteColumn {
  key: "country" | "city" | "coordinates" | "asn";
  label: string;
  /** RESULT-row display value */
  winner: string;
  confidence: Confidence;
  cells: Record<string, VoteCell>;
  /** ballot view: providers backing the winner */
  backers: string[];
  /** ballot view: dissenting values + who voted for them */
  dissent: { value: string; sources: string[] }[];
  /** provider that is the authority AND backed the winner */
  authorityId?: string;
}

export interface VoteTable {
  /** row order (union of reporting providers across columns) */
  providers: string[];
  fields: VoteColumn[];
}

/** Fixed display order; unknown ids are appended in first-seen order. */
const PROVIDER_ORDER = [
  "ip-api",
  "ipinfo",
  "ipgeolocation",
  "ipwhois",
  "freeipapi",
  "rdap-ip",
  "ripestat",
  "abuseipdb",
  "reverse-dns",
];

const PROVIDER_LABEL: Record<string, string> = {
  ripestat: "RIPEstat",
  abuseipdb: "AbuseIPDB",
  "reverse-dns": "reverse DNS",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
}

function geoFieldFor(key: VoteColumn["key"]): GeoField {
  return key === "coordinates" ? "coords" : key;
}

/** Build a column for a reconciled string field (country, city, asn). */
function stringColumn(
  key: "country" | "city" | "asn",
  label: string,
  field: ResolvedField<string> | undefined,
): VoteColumn | null {
  if (!field) return null;
  const authority = authorityFor(geoFieldFor(key));
  const cells: Record<string, VoteCell> = {};
  for (const id of field.sources) {
    cells[id] = authority === id ? { status: "win", authority: true } : { status: "win" };
  }
  for (const alt of field.alternatives ?? []) {
    for (const id of alt.sources) {
      cells[id] = { status: "dissent", value: alt.value };
    }
  }
  const authorityId =
    authority && field.sources.includes(authority) ? authority : undefined;
  return {
    key,
    label,
    winner: field.value,
    confidence: field.confidence,
    cells,
    backers: field.sources,
    dissent: (field.alternatives ?? []).map((a) => ({ value: a.value, sources: a.sources })),
    authorityId,
  };
}

/** RESULT-row wording for the coords column. "clustered" only when every
 *  reporting provider landed in the winning cluster. */
function coordsWinnerLabel(clustered: boolean, outliers: number): string {
  if (!clustered) return "scattered";
  return outliers === 0 ? "clustered" : `clustered, ${outliers} outlying`;
}

/** Coordinates are cluster-based: reconcile votes over proximity clusters, so a
 *  provider either backs the winning cluster or sits in a losing one. We show
 *  clustered/win vs scattered/scatter, never a fabricated per-provider distance. */
function coordsColumn(field: GeoResolution["coordinates"]): VoteColumn | null {
  if (!field) return null;
  const outliers = (field.alternatives ?? []).flatMap((a) => a.sources);
  const clustered = field.confidence !== "low";
  const cells: Record<string, VoteCell> = {};
  for (const id of field.sources) {
    cells[id] = { status: clustered ? "win" : "scatter" };
  }
  // Providers in a losing cluster read as scattered rather than absent: they did
  // report a point, it just lost.
  for (const id of outliers) cells[id] = { status: "scatter" };
  return {
    key: "coordinates",
    label: "COORDS",
    winner: coordsWinnerLabel(clustered, outliers.length),
    confidence: field.confidence,
    cells,
    backers: clustered ? field.sources : [],
    dissent: [],
  };
}

export function buildVoteTable(res: GeoResolution): VoteTable | null {
  const columns = [
    stringColumn("country", "COUNTRY", res.country),
    stringColumn("city", "CITY", res.city),
    coordsColumn(res.coordinates),
    stringColumn("asn", "ASN", res.asn),
  ].filter((c): c is VoteColumn => c !== null);

  if (columns.length === 0) return null;

  // Union of reporting providers, ordered by PROVIDER_ORDER (unknowns appended,
  // first-seen order preserved via insertion + stable sort).
  const seen = new Set<string>();
  for (const col of columns) {
    for (const id of Object.keys(col.cells)) seen.add(id);
  }
  const providers = [...seen].sort((a, b) => {
    const ia = PROVIDER_ORDER.indexOf(a);
    const ib = PROVIDER_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // Backfill absent cells so every column has a cell for every provider row.
  for (const col of columns) {
    for (const id of providers) {
      if (!col.cells[id]) col.cells[id] = { status: "absent" };
    }
  }

  return { providers, fields: columns };
}
