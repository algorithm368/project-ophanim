"use client";

import { Fragment, memo, useMemo } from "react";
import { Barlow_Condensed } from "next/font/google";
import { flagUrl } from "@/lib/flag";
import { buildIdentity, longestRun, markParts, type IdentityClaim, type Vital } from "@/lib/ti/identity";
import type { AnyCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Frame, Tile } from "./frame";

/**
 * The one webfont in the app, and it sets nothing but the vitals.
 *
 * Every mark in the strip is meant to be the same height, and a system face is
 * too wide for that: at the size the strip wants, a domain or a country name
 * outgrows its cell and has to wrap mid-word. A condensed face keeps them
 * whole. `next/font` serves it from this app's own origin, so the page still
 * makes no request to anyone else, and it is loaded here rather than in the
 * layout so only the pages that draw the strip pay for it.
 */
const markFace = Barlow_Condensed({ weight: "700", subsets: ["latin"], display: "swap" });

/**
 * The subject record, as a dex entry, in two tiles of the page's frame.
 *
 * `VitalsTile` is the headline facts and `RecordTile` is the full ledger
 * under them. They are separate tiles because they answer at different speeds:
 * one is read at a glance and the other is read when the glance was not enough.
 *
 * Rules this file exists to hold:
 *
 *  - One fixed list, in two columns, and nothing else. No groups, no headings
 *    inside the tile, no fold. The eye learns where each field sits and stops
 *    reading labels, which only works if the order never moves.
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
            <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
                {identity.fields.map((field, i) => (
                    <Row key={field.key} claim={field} at={placement(i, identity.fields.length)} />
                ))}
            </div>
        </Tile>
    );
});

/**
 * The headline facts, side by side, as marks.
 *
 * No labels: each value is set large enough to be the thing the eye lands on,
 * and the small line over it says what kind of fact it is (the city over the
 * country, the holder over the AS number, the host part over the domain).
 * The strip is always one row: three across for an address, four for a domain
 * or a file.
 *
 * Every mark in a strip is one size, never squeezed: the largest, up to 56px,
 * at which the strip's longest word still fits a cell, so values wrap between
 * words and never through one. The size is pure CSS, each cell a container and
 * the mark sized in its `cqi`, so it holds on any width with no script and no
 * shift. Marks start at the top of their cells, so a value that wraps grows
 * downward and the first lines always align.
 *
 * The slots are per IOC type and never move, which is what lets a reader go to
 * the second cell for the network without reading anything else. A slot with
 * nothing behind it still occupies its place and says what is missing, because
 * a strip that closes up around a gap moves every fact after it.
 */
function Vitals({ vitals }: Readonly<{ vitals: Vital[] }>) {
    // Barlow Condensed Bold averages a little under half an em per capital,
    // so half an em per character is the safe width of the longest run.
    const size = `min(56px, calc(100cqi / ${longestRun(vitals) * 0.5}))`;
    return (
        <div
            className={cn(
                "grid h-full grid-cols-1 gap-px bg-foreground/12",
                vitals.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4",
            )}
        >
            {vitals.map((vital) => (
                <div
                    key={vital.key}
                    className="@container relative isolate flex min-w-0 flex-col overflow-hidden bg-card p-4"
                >
                    <FlagWallpaper code={vital.countryCode} />
                    <span className="sr-only">{vital.label}: </span>
                    {/* One line, always: a caption that wraps pushes its mark below the
                        others' first lines. The whole of it is on hover. */}
                    <div
                        className="mb-1 min-h-3.5 truncate text-[11.5px] leading-3.5 text-muted-foreground"
                        title={vital.sub}
                    >
                        {vital.sub}
                    </div>
                    <div
                        className={cn(
                            markFace.className,
                            "leading-[0.82] tracking-[0.005em] uppercase wrap-anywhere",
                            vital.absent && "text-foreground/35",
                        )}
                        style={{ fontSize: size }}
                        title={vital.value}
                    >
                        {markParts(vital).map((part, i) => (
                            <span key={i} className={cn(part.quiet && "text-foreground/35")}>
                                <Breakable text={part.text} />
                            </span>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** A break opportunity after every dot, so a long domain wraps between its
 *  labels before `wrap-anywhere` has to split one of them. */
function Breakable({ text }: Readonly<{ text: string }>) {
    const pieces = text.split(".");
    return pieces.map((piece, i) => (
        <Fragment key={i}>
            {piece}
            {i < pieces.length - 1 && (
                <>
                    .<wbr />
                </>
            )}
        </Fragment>
    ));
}

/** The country's flag behind a vital, filling the cell and fading out toward
 *  the text so the headline stays the thing that is read. */
function FlagWallpaper({ code }: Readonly<{ code?: string }>) {
    const src = flagUrl(code);
    if (!src) return null;
    return (
        // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
        <img
            src={src}
            alt=""
            aria-hidden
            loading="lazy"
            className="pointer-events-none absolute inset-0 -z-10 size-full object-cover opacity-25 [mask-image:linear-gradient(to_left,black_35%,transparent_95%)] dark:opacity-20"
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
                {claim.value}
            </dd>
        </div>
    );
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
                        <span className="sweep block h-2.5 w-20 rounded" />
                        <span className={cn("sweep mt-2.5 block h-9 rounded", w)} />
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
