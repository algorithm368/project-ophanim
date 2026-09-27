"use client";

import type { ReactNode } from "react";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import type { ScanDetail } from "@/lib/ti/url/active/detail";
import {
  attribution,
  type MergedIndicator,
  type TargetDifference,
} from "@/lib/ti/url/active/merge";
import type { ActiveScan } from "@/lib/ti/url/active/types";
import { Tile } from "@/components/CheckResults/frame";
import { RecordRow, RecordTable } from "@/components/CheckResults/primitives";

/**
 * One addressable block of the teardown, as a partition of the page's frame.
 *
 * The `id` is what the jump rail and the red flags link to, so it is also the
 * id in `redFlagsFor`: a flag that pointed at a section that does not exist
 * would be a link to the top of the page.
 *
 * Half width by default. The teardown is read in pairs (the page and what it
 * pulled in, what it asks for and who owns the name), and a full-width tile of
 * two-column rows leaves a label column and a value column with a screen of
 * air between them.
 */
export function ScanSection({
  id,
  title,
  note,
  span = 6,
  children,
}: Readonly<{
  id: string;
  title: string;
  note?: ReactNode;
  span?: 6 | 12;
  children: ReactNode;
}>) {
  return (
    <Tile id={id} span={span} title={title} note={note}>
      <RecordTable>{children}</RecordTable>
    </Tile>
  );
}

/** The scanned URLs' differing answers for one field, or nothing when they
 *  agreed. Looked up by the label `COMPARED` gave it. */
export function differenceFor(
  merged: MergedIndicator,
  field: string,
): TargetDifference | undefined {
  return merged.targetDifferences.find((d) => d.field === field);
}

/**
 * A field the scanned URLs answered differently on, printed under the folded
 * value.
 *
 * Amber rather than red: two ports serving different things is a finding, not a
 * fault, and the red is reserved for what the scan saw the page do.
 */
export function Difference({
  of,
}: Readonly<{ of: TargetDifference | undefined }>) {
  if (!of) return null;
  return (
    <span className="mt-0.5 block font-mono text-[11px] text-amber-600 dark:text-amber-400">
      ⚠{" "}
      {of.values
        .map(({ target, value }) => `${target} → ${value}`)
        .join("   ·   ")}
    </span>
  );
}

/**
 * A folded value with the scanned URLs' differing answers beneath it, or
 * undefined when nothing was reported so `ScanRow` prints its own blank.
 *
 * Returning undefined rather than an empty fragment is the point: the row's
 * "not reported" wording is how this page keeps "we looked and found nothing"
 * apart from "we did not look", and a fragment would satisfy the truthiness
 * check and quietly render an empty cell instead.
 */
export function folded(
  merged: MergedIndicator,
  field: string,
  value: string | undefined,
): ReactNode | undefined {
  if (!value) return undefined;
  return (
    <>
      {value}
      <Difference of={differenceFor(merged, field)} />
    </>
  );
}

/**
 * One row of the teardown.
 *
 * Built on the same `RecordRow` the subject record uses, so a scan row and a
 * passive row line up in the same ledger column on the same page rather than
 * being two tables that nearly agree.
 *
 * A row with nothing behind it still renders, saying so. Vanishing would let an
 * unanswered question read as an answered one, which on this page is the whole
 * distinction between "we looked and found nothing" and "we did not look".
 */
export function ScanRow({
  label,
  value,
  engines = [],
  tone,
  mono,
  hint,
  missing = "not reported",
}: Readonly<{
  label: string;
  /** Absent means nothing was reported, and the row says so in `missing`. */
  value?: ReactNode;
  /** Which scanners backed this value. A claim carried into a ticket has to be
   *  attributable to the scanner that made it. */
  engines?: string[];
  tone?: string;
  mono?: boolean;
  hint?: string;
  /** What the row says with nothing behind it, when "not reported" would be the
   *  wrong reason for the blank. */
  missing?: string;
}>) {
  const empty = value === undefined || value === null || value === "";
  return (
    <RecordRow
      label={label}
      hint={hint}
      mono={mono && !empty}
      tone={empty ? "text-muted-foreground" : tone}
      note={empty || engines.length === 0 ? undefined : engines.join(" + ")}
    >
      {empty ? missing : value}
    </RecordRow>
  );
}

/** Engine names for a field, ready to print. */
export function by(scans: ActiveScan[], key: keyof ScanDetail): string[] {
  return attribution(scans, key).map((e) => ENGINE_NAME[e]);
}

/**
 * A list as one wrapped line, with the tail counted rather than dropped: a
 * truncated list that does not say it was truncated reads as the whole set.
 *
 * A function returning undefined rather than a component returning null, which
 * is what it was and what made every empty list render as a blank cell. `null`
 * is a perfectly good ReactNode, so `ScanRow` saw a value, skipped its "not
 * reported" wording, and printed nothing at all — which is exactly the silence
 * this page is built to avoid.
 */
export function listed(
  items: string[] | undefined,
  { total, max = 12 }: { total?: number; max?: number } = {},
): ReactNode | undefined {
  if (!items?.length) return undefined;
  const whole = total ?? items.length;
  const rest = whole > max ? `, and ${whole - max} more` : "";
  return (
    <span className="font-mono text-[13px]">
      {items.slice(0, max).join(", ")}
      {rest}
    </span>
  );
}
