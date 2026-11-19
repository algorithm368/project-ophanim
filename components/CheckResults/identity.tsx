"use client";

import { Fragment, memo, useMemo } from "react";
import { flagFillUrl } from "@/lib/flag";
import {
    buildIdentity,
    longestRun,
    markParts,
    type IdentityClaim,
    type MarkPart,
    type Vital,
} from "@/lib/ti/identity";
import type { AnyCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Frame, Tile } from "./frame";
import { Typed, useLive } from "./live";
import { markFace } from "./mark-face";

/**
 * The subject record, as a dex entry, in two tiles of the page's frame.
 *
 * `VitalsTile` is the headline facts and `RecordTile` is the full ledger
 * under them. They are separate tiles because they answer at different speeds:
 * one is read at a glance and the other is read when the glance was not enough.
 *
 * Rules this file exists to hold:
 *
 *  - One fixed list, in two columns, and no fold. The eye learns where each
 *    field sits and stops reading labels, which only works if the order never
 *    moves. A domain's list is also headed by aspect (see `GroupedLedger`); an
 *    address's and a file's are not, yet.
 *  - The order runs *down* the first column and then down the second. That is
 *    explicit grid placement rather than CSS columns, because the two halves
 *    have to share row heights: with independent columns a wrapped value on the
 *    left pushed every rule below it out of step with the right, and the card
 *    read as two unrelated tables. Placing both halves in the same grid rows
 *    makes each row as tall as its taller half, so the rules line up straight
 *    across. The DOM keeps the true reading order, so the single-column layout
 *    below `md` needs no second copy of the list.
 *  - Every field renders on every lookup, including the ones with nothing
 *    behind them. An absence is a fact about the subject, and it is drawn quiet
 *    so it reads as one rather than as a value.
 *  - Three or four vitals above the ledger, set as marks rather than as
 *    labelled readouts: that bank above is how bad this is, this one is what it
 *    is, said in the fewest and largest words. None of them repeats a stat from
 *    the bank above.
 *  - This is a section of the panel's card, not a card of its own. The record
 *    is the back half of the same entry, and a gap between them read as two
 *    unrelated things about the same subject.
 */
export const VitalsTile = memo(function VitalsTile({
    result,
    span = 9,
}: Readonly<{ result: AnyCheckResult; span?: 9 | 12 }>) {
    const identity = useMemo(() => buildIdentity(result), [result]);
    return (
        <Tile span={span} className="p-0">
            <Vitals vitals={identity.vitals} />
        </Tile>
    );
});

export const RecordTile = memo(function RecordTile({
    result,
    omitDates = false,
}: Readonly<{ result: AnyCheckResult; omitDates?: boolean }>) {
    const identity = useMemo(() => buildIdentity(result, { omitDates }), [result, omitDates]);
    return (
        <Tile
            span={12}
            id="record"
            title="Subject record"
            note={`${identity.fields.length} fields`}
        >
            {identity.fields.some((field) => field.group) ? (
                <GroupedLedger fields={identity.fields} />
            ) : (
                <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
                    {identity.fields.map((field, i) => (
                        <Row key={field.key} claim={field} at={placement(i, identity.fields.length)} />
                    ))}
                </div>
            )}
        </Tile>
    );
});

/**
 * The ledger under headings, one per aspect.
 *
 * The groups flow down the first column and on into the second, and the
 * browser breaks between them where the two columns come out level, never
 * inside one. So a group's column depends on how much the groups before it
 * hold: a domain with a long SPF record pushes the later groups right. The
 * order never changes, and the headings are what the eye goes by, which is
 * why a group may change sides but a row may not leave its group.
 *
 * Prose (a registrar, a reading like "Softfail") is set in the page's sans and
 * anything a machine reads in mono, so the line a reader would copy is the
 * one that looks like it.
 */
function GroupedLedger({ fields }: Readonly<{ fields: IdentityClaim[] }>) {
    const groups: { name: string; claims: IdentityClaim[] }[] = [];
    for (const claim of fields) {
        const name = claim.group ?? "";
        const last = groups.at(-1);
        if (last?.name === name) last.claims.push(claim);
        else groups.push({ name, claims: [claim] });
    }
    return (
        <div className="-mt-3.5 gap-x-10 md:columns-2">
            {groups.map((g) => (
                <section key={g.name} className="break-inside-avoid">
                    <h3 className="border-b border-foreground/25 pt-3.5 pb-1.5 text-[11px] font-semibold tracking-[0.1em] uppercase">
                        {g.name}
                    </h3>
                    <dl>
                        {g.claims.map((claim) => (
                            <div
                                key={claim.key}
                                className="grid grid-cols-[9rem_1fr] items-baseline gap-x-4 border-b border-foreground/8 py-[7px]"
                            >
                                <dt className="text-[10.5px] leading-5 font-medium tracking-[0.07em] text-muted-foreground uppercase">
                                    {claim.label}
                                </dt>
                                <dd className="min-w-0 leading-5 wrap-anywhere">
                                    <ClaimValue claim={claim} />
                                </dd>
                            </div>
                        ))}
                    </dl>
                </section>
            ))}
        </div>
    );
}

/** One value: its reading and detail, or the value itself, then the lines or
 *  the raw record under it in small mono. */
function ClaimValue({ claim }: Readonly<{ claim: IdentityClaim }>) {
    const { pending } = useLive();
    const under = "mt-0.5 font-mono text-[11px] leading-[17px] text-muted-foreground";
    if (claim.absent) {
        // Absent is only a fact once every source has answered; until then the
        // field is still waiting, and its absence is typed in at the end.
        return (
            <span className="text-[13px] leading-5 text-foreground/40">
                <Typed text={pending ? undefined : claim.value} placeholder="10ch" />
            </span>
        );
    }
    if (claim.lead) {
        return (
            <>
                <span className="text-[14px] leading-5 font-semibold">
                    <Typed text={claim.lead} />
                </span>
                {claim.value && (
                    <span className="text-[13px] leading-5 text-muted-foreground">
                        {" "}
                        <Typed text={claim.value} />
                    </span>
                )}
                {claim.lines && (
                    <span className={cn(under, "block")}>
                        <TypedLines lines={claim.lines} />
                    </span>
                )}
                {claim.raw && (
                    <span className={cn(under, "block")}>
                        <Typed text={claim.raw} />
                    </span>
                )}
            </>
        );
    }
    return (
        <span
            className={cn(
                // A block, so a wrapped value keeps its own line height rather
                // than the taller strut of the row around it.
                "block leading-5",
                claim.data ? "font-mono text-[12.5px]" : "text-[14px]",
                claim.notable && "font-semibold",
            )}
        >
            {claim.lines ? <TypedLines lines={claim.lines} /> : <Typed text={claim.value} />}
        </span>
    );
}

/** A list set one item per line, each typed in on its own line. */
function TypedLines({ lines }: Readonly<{ lines: string[] }>) {
    return lines.map((line) => (
        <span key={line} className="block">
            <Typed text={line} />
        </span>
    ));
}

/**
 * The headline facts, side by side, as marks.
 *
 * Each cell is its slot name, then the value set large enough to be the thing
 * the eye lands on, then one small line qualifying it (the city under the
 * country, the holder under the AS number, the host part under the domain).
 * The strip is always one row: three across for an address, four for a domain
 * or a file.
 *
 * Every mark in a strip is one size, never squeezed: the largest, up to 56px,
 * at which the strip's longest word still fits a cell, so values wrap between
 * words and never through one. The size is pure CSS, each cell a container and
 * the mark sized in its `cqi`, so it holds on any width with no script and no
 * shift. Cells start at the top, so the labels and the first line of every
 * mark align, and a value that wraps grows downward.
 *
 * The slots are per IOC type and never move, which is what lets a reader go to
 * the second cell for the network without reading anything else. A slot with
 * nothing behind it still occupies its place and says what is missing, because
 * a strip that closes up around a gap moves every fact after it.
 */
export function Vitals({ vitals }: Readonly<{ vitals: Vital[] }>) {
    const { pending } = useLive();
    // Barlow Condensed Bold averages a little under half an em per capital,
    // so half an em per character is the safe width of the longest run. A
    // slot still waiting has no run yet: its absence wording is not the value
    // it is waiting for, and sizing to it shrank every mark on the strip.
    const run = longestRun(vitals.filter((v) => !(pending && waitsFor(v))));
    const size = run > 0 ? `min(56px, calc(100cqi / ${run * 0.5}))` : "56px";
    return (
        <div
            className={cn(
                "grid h-full grid-cols-1 gap-px bg-foreground/12",
                vitals.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4",
            )}
        >
            {vitals.map((vital) => (
                <VitalCell key={vital.key} vital={vital} size={size} waiting={pending && waitsFor(vital)} />
            ))}
        </div>
    );
}

/** A run of a mark with its role as its key: the quiet run before the core,
 *  the core, the quiet run after it. Roles rather than positions, so the core
 *  keeps its element when a quiet lead appears in front of it. */
type KeyedPart = { key: "lead" | "core" | "tail"; text?: string; quiet?: boolean };

function keyParts(parts: MarkPart[]): KeyedPart[] {
    const core = parts.findIndex((p) => !p.quiet);
    return parts.map((part, at) => {
        if (!part.quiet) return { ...part, key: "core" };
        return { ...part, key: at < core ? "lead" : "tail" };
    });
}

/** A slot whose value is only true once every source has answered: an
 *  absence, or a reading of one. */
function waitsFor(vital: Vital): boolean {
    return vital.absent === true || vital.inferred === true;
}

/**
 * One slot of the strip: its name, the mark, and the line under it.
 *
 * `waiting` is a slot with nothing behind it yet while the panel answers. It
 * draws a rule where the mark will go and keeps the line under it open, so the
 * slot does not change height when its value lands.
 */
function VitalCell({ vital, size, waiting }: Readonly<{ vital: Vital; size: string; waiting: boolean }>) {
    // A waiting slot is one part, the rule, keyed as the core, so the part the
    // value types into is the same element the rule was.
    const parts: KeyedPart[] = waiting ? [{ key: "core" }] : keyParts(markParts(vital));
    return (
        <div className="@container relative isolate flex min-w-0 flex-col overflow-hidden bg-card p-4">
            <FlagWallpaper code={vital.countryCode} />
            <div className="font-mono text-[9.5px] tracking-[0.11em] text-muted-foreground uppercase">
                {vital.label}
            </div>
            <div
                className={cn(
                    markFace.className,
                    "mt-2 leading-[0.82] tracking-[0.005em] uppercase wrap-anywhere",
                    vital.absent && !waiting && "text-foreground/35",
                    // The scan's own red flags, the one place a vital
                    // carries colour: see `Vital.flagged`.
                    vital.flagged && "text-red-600 dark:text-red-400",
                )}
                style={{ fontSize: size }}
                title={waiting ? undefined : vital.value}
            >
                {parts.map((part) => (
                    <span key={part.key} className={cn(part.quiet && (vital.flagged ? "opacity-40" : "text-foreground/35"))}>
                        <Breakable text={part.text} />
                    </span>
                ))}
            </div>
            {(vital.sub || waiting) && (
                // One line, the whole of it on hover.
                <div
                    className="mt-1.5 truncate text-[11.5px] leading-3.5 text-muted-foreground"
                    title={vital.sub}
                >
                    <Typed text={waiting ? undefined : vital.sub} placeholder="12ch" />
                </div>
            )}
        </div>
    );
}

/** A mark, typed in when it lands, with a break opportunity after every dot
 *  once it is all in, so a long domain wraps between its labels before
 *  `wrap-anywhere` has to split one of them. */
function Breakable({ text }: Readonly<{ text?: string }>) {
    return <Typed text={text} placeholder="4ch" render={breakAtDots} />;
}

function breakAtDots(text: string): React.ReactNode {
    // Each label keyed by where it starts in the name, which is what it is.
    const labels: { start: number; label: string }[] = [];
    let start = 0;
    for (const label of text.split(".")) {
        labels.push({ start, label });
        start += label.length + 1;
    }
    return labels.map(({ start: at, label }) => (
        <Fragment key={at}>
            {label}
            {at + label.length < text.length && (
                <>
                    .<wbr />
                </>
            )}
        </Fragment>
    ));
}

/** The country's flag behind a vital, filling the whole cell edge to edge.
 *  It is held faint rather than faded out under the text: a fade left most of
 *  the cell blank and read as a strip of flag, not a flag. Stretched rather
 *  than cropped: the cell is wider than any flag, and cropping a 3:2 flag to
 *  it cut the outer stripes off, which left Thailand's as one blue band. */
function FlagWallpaper({ code }: Readonly<{ code?: string }>) {
    const src = flagFillUrl(code);
    if (!src) return null;
    return (
        // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
        <img
            src={src}
            alt=""
            aria-hidden
            loading="lazy"
            className="pointer-events-none absolute inset-0 -z-10 size-full object-fill opacity-25 dark:opacity-20"
        />
    );
}

/**
 * Where a field sits once the list splits in two.
 *
 * The first half fills the left column top to bottom, then the second half
 * fills the right, so the fixed order still reads downwards. An odd count puts
 * the extra row on the left, which is where the eye starts.
 */
function placement(index: number, total: number): { "--c": number; "--r": number } {
    const half = Math.ceil(total / 2);
    return index < half
        ? { "--c": 1, "--r": index + 1 }
        : { "--c": 2, "--r": index - half + 1 };
}

/** One row of the entry, stretched to its grid row so its rule meets the rule
 *  of the row beside it. */
function Row({
    claim,
    at,
}: Readonly<{ claim: IdentityClaim; at: { "--c": number; "--r": number } }>) {
    return (
        <div
            style={at as React.CSSProperties}
            className="grid grid-cols-[8.5rem_1fr] items-baseline gap-x-4 border-b border-foreground/8 py-1.5 md:[grid-column:var(--c)] md:[grid-row:var(--r)]">
            <dt className="font-mono text-[9.5px] leading-5 tracking-[0.11em] text-muted-foreground uppercase">
                {claim.label}
            </dt>
            <dd
                className={cn(
                    "min-w-0 font-mono text-[12px] leading-5 wrap-anywhere",
                    claim.notable && "font-bold",
                    claim.absent && "text-muted-foreground",
                )}
            >
                <RowValue claim={claim} />
            </dd>
        </div>
    );
}

/** A row's value, or a rule while its field is still waiting on the panel. */
function RowValue({ claim }: Readonly<{ claim: IdentityClaim }>) {
    const { pending } = useLive();
    return <Typed text={claim.absent && pending ? undefined : claim.value} placeholder="14ch" />;
}

/**
 * The vitals and the ledger as two tiles' worth of skeleton, so the frame keeps
 * its shape while the result is still arriving.
 */
export function VitalsSkeleton({
    span = 9,
    cells = 4,
}: Readonly<{ span?: 9 | 12; cells?: 3 | 4 }> = {}) {
    return (
        <Tile span={span} className="p-0">
            <div
                className={cn(
                    "grid h-full grid-cols-1 gap-px bg-foreground/12",
                    cells === 3 ? "md:grid-cols-3" : "md:grid-cols-4",
                )}
            >
                {["w-28", "w-20", "w-32", "w-24"].slice(0, cells).map((w) => (
                    <div key={w} className="bg-card p-4">
                        <span className="sweep block h-2 w-14 rounded" />
                        <span className={cn("sweep mt-2.5 block h-9 rounded", w)} />
                        <span className="sweep mt-2 block h-2.5 w-24 rounded" />
                    </div>
                ))}
            </div>
        </Tile>
    );
}

export function RecordSkeleton() {
    return (
        <Tile span={12} title="Subject record">
            <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
                {["w-full", "w-4/5", "w-2/3", "w-3/4", "w-1/2", "w-5/6", "w-3/5", "w-2/3"].map((w, i) => (
                    // Indexed: two rows share a width, and a width alone as
                    // the key made React warn on every scan page load.
                    <div key={`${i}-${w}`} className="py-1.5">
                        <span className={cn("sweep block h-3 rounded", w)} />
                    </div>
                ))}
            </div>
        </Tile>
    );
}

/**
 * The record in a frame of its own.
 *
 * Only the active-scan page uses this: it shows a subject's identity with no
 * check page around it to be a partition of. On `/check` the two tiles are
 * partitions of the page's own frame, which is why they are the primary exports
 * and this is the wrapper.
 */
export function IdentityCard({
    result,
    streaming,
}: Readonly<{ result: AnyCheckResult | null; streaming: boolean }>) {
    return (
        <Frame>
            {streaming || !result ? (
                <>
                    <VitalsSkeleton span={12} />
                    <RecordSkeleton />
                </>
            ) : (
                <>
                    <VitalsTile result={result} span={12} />
                    <RecordTile result={result} />
                </>
            )}
        </Frame>
    );
}
