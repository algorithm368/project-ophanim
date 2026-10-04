"use client";

import { memo, useMemo } from "react";
import { flagUrl } from "@/lib/flag";
import { buildIdentity, type IdentityClaim, type Vital } from "@/lib/ti/identity";
import type { AnyCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Frame, Tile } from "./frame";
/**
 * The subject record, as a dex entry, in two tiles of the page's frame.
 *
 * `VitalsTile` is the four headline facts and `RecordTile` is the full ledger
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
 *  - Four vitals above the ledger, in the same grammar as the five stat cells
 *    at the top of the panel, so the card reads as two banks of one instrument:
 *    that one is how bad this is, this one is what it is. None of the four
 *    repeats a stat from the bank above.
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
 * The four headline facts, side by side.
 *
 * Four fixed slots as bento cells, each one headline over one caption. The
 * cells are ruled apart the way the frame rules its tiles, a one-pixel gap
 * over the rule colour, so a shared edge is never two borders. The slots
 * are per IOC type and never move, which is what lets a reader go to the third
 * cell for the network rather than reading four labels to find it. A slot with
 * nothing behind it still occupies its place and says what is missing, because
 * a strip that closes up around a gap moves every fact after it.
 */
function Vitals({ vitals }: Readonly<{ vitals: Vital[] }>) {
    return (
        <div className="grid h-full grid-cols-1 gap-px bg-foreground/12 md:grid-cols-4">
            {vitals.map((vital) => (
                <div
                    key={vital.key}
                    className="relative isolate flex min-w-0 flex-col overflow-hidden bg-card p-4"
                >
                    <FlagWallpaper code={vital.countryCode} />
                    <div className="font-mono text-[9.5px] tracking-[0.11em] text-muted-foreground uppercase">
                        {vital.label}
                    </div>
                    <div
                        className={cn(
                            "mt-2 flex items-start gap-2 text-base leading-tight font-medium",
                            vital.absent && "font-normal text-muted-foreground",
                        )}
                    >
                        <span className="line-clamp-2 min-w-0 wrap-anywhere" title={vital.value}>
                            {vital.value}
                        </span>
                    </div>
                    {vital.sub && (
                        <div
                            className="mt-0.5 truncate text-xs text-muted-foreground"
                            title={vital.sub}
                        >
                            {vital.sub}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
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
export function VitalsSkeleton({ span = 9 }: Readonly<{ span?: 9 | 12 }> = {}) {
    return (
        <Tile span={span} className="p-0">
            <div className="grid h-full grid-cols-1 gap-px bg-foreground/12 md:grid-cols-4">
                {["w-16", "w-12", "w-20", "w-14"].map((w) => (
                    <div key={w} className="bg-card p-4">
                        <span className={cn("sweep block h-2 rounded", w)} />
                        <span className="sweep mt-2.5 block h-4 w-28 rounded" />
                        <span className="sweep mt-1.5 block h-2 w-20 rounded" />
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
