"use client";

import { SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import { count } from "@/lib/text";
import { cn } from "@/lib/utils";
import type { Confidence, GeoResolution, ResolverConsensus } from "@/lib/ti/types";
import type { IconType } from "./types";

/** Fixed three-letter codes so the confidence levels are equal width in mono. */
const CONF_ABBR: Record<Confidence, string> = {
  high: "HIG",
  medium: "MED",
  low: "LOW",
};

/** Plain signal-strength icon, bars reflecting the level. */
const CONF_ICON: Record<Confidence, IconType> = {
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow,
};

/** Confidence as a plain icon plus a fixed three-letter code, all grey mono so
 *  the levels line up wherever they appear. */
export function ConfidenceLevel({
  confidence,
}: Readonly<{ confidence: Confidence }>) {
  const Icon = CONF_ICON[confidence];
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
      <Icon className="size-3 shrink-0 text-foreground/50" aria-hidden />
      {CONF_ABBR[confidence]}
    </span>
  );
}

const TONE: Record<Confidence, string> = {
  high: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  medium: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  low: "border-foreground/25 text-muted-foreground",
};

const LABEL: Record<Confidence, string> = {
  high: "high confidence, providers agree",
  medium: "medium confidence, contested",
  low: "low confidence, single provider or split",
};

/** Small inline chip indicating how trustworthy a reconciled field is. */
export function ConfidenceChip({ confidence }: Readonly<{ confidence: Confidence }>) {
  return (
    <span
      title={LABEL[confidence]}
      className={cn(
        "ml-2 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-wide",
        TONE[confidence],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {confidence}
    </span>
  );
}

/** One-line, comma-separated explanation of the geo confidence (house style:
 *  commas, no dashes). `unit` names what's being counted: a plain geo vote
 *  counts providers, the domain vote across resolved IPs counts those IPs
 *  instead, and the sentence should say so rather than mislabel an IP as a
 *  provider. */
export function geoConfidenceReason(res: GeoResolution, unit = "provider"): string {
  const parts: string[] = [
    `${res.providerCount} ${unit}${res.providerCount === 1 ? "" : "s"}`,
  ];
  if (res.country && res.country.sources.length > 1) {
    parts.push(`${res.country.sources.length} agree on country`);
  }
  if (res.city && res.city.confidence !== "low") {
    parts.push("city corroborated");
  }
  if (res.coordinates) {
    // Coordinates are voted over proximity clusters, so an outlying provider is
    // a losing cluster, not a loose one. Say which it is.
    const outliers = (res.coordinates.alternatives ?? []).reduce(
      (n, a) => n + a.sources.length,
      0,
    );
    if (outliers > 0) {
      parts.push(
        outliers === 1
          ? "1 provider places it elsewhere"
          : `${outliers} providers place it elsewhere`,
      );
    } else if (res.coordinates.sources.length > 1) {
      parts.push(
        res.coordinates.confidence === "high"
          ? "coordinates tightly clustered"
          : "coordinates loosely clustered",
      );
    }
  }
  return parts.join(", ");
}

/** One-line explanation for the DNS-resolver ballot: how many of the queried
 *  resolvers came back with the winning A record. */
export function resolverConfidenceReason(consensus: ResolverConsensus): string {
  const { respondingResolvers, totalResolvers, agreeCount } = consensus;
  if (respondingResolvers === 0) return "No resolver answered.";
  // Unanimous among responders is not the same claim as unanimous among every
  // resolver queried — a lone survivor "agreeing with itself" after the rest
  // timed out must not read as full consensus.
  const silent = totalResolvers - respondingResolvers;
  const silentNote = silent > 0 ? ` (${count(silent, "resolver")} did not respond)` : "";
  if (agreeCount === respondingResolvers) {
    return `${respondingResolvers} of ${respondingResolvers} resolvers agree on the resolved IP(s)${silentNote}`;
  }
  return `Resolvers split, ${agreeCount} of ${respondingResolvers} agree on the resolved IP(s)${silentNote}`;
}
