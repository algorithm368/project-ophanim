import { cn } from "@/lib/utils";

/**
 * The page as one instrument panel: a twelve-column grid inside a single
 * border, partitioned by hairlines rather than separated by gaps.
 *
 * The hairlines are the grid's own gap showing through: the frame paints itself
 * the rule colour and every tile paints itself the card colour on top, so a
 * one-pixel gap reads as a one-pixel rule with no border on any tile to keep in
 * sync. That matters because tiles butt against each other in both axes, and
 * per-tile borders would double up on every shared edge.
 *
 * Why one frame at all: the entry spent most of its life as a single card, and
 * splitting it into free-floating tiles made twelve things where there is one
 * subject. Partitions keep the tiles legible as separate answers while the
 * border keeps them legible as one page about one indicator.
 */
export function Frame({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <div className="sketch-shadow grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-foreground/12 bg-foreground/12 md:grid-cols-12">
            {children}
        </div>
    );
}

/** How many of the twelve columns a tile claims. Below `md` the frame is one
 *  column and every tile is full width, so the span is a desktop-only concern. */
type Span = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;

const SPAN: Record<Span, string> = {
    3: "md:col-span-3",
    4: "md:col-span-4",
    5: "md:col-span-5",
    6: "md:col-span-6",
    7: "md:col-span-7",
    8: "md:col-span-8",
    9: "md:col-span-9",
    12: "md:col-span-12",
};

/**
 * One partition of the frame: an optional header strip, then a body.
 *
 * `tone="rail"` tints the tile, which is how the consulted column (verdict,
 * freshness, confidence, the ballots) stays distinguishable from the read
 * column without a second border or a second type scale. The tint is the only
 * thing separating the two lanes, so it is applied by hand per tile rather than
 * inferred from position: a tile's lane is a judgement about what it is for,
 * not about which column it landed in.
 */
export function Tile({
    span,
    rows,
    title,
    note,
    tone,
    id,
    className,
    children,
}: Readonly<{
    span: Span;
    /** How many of the frame's rows the tile runs down. A rail tile beside a
     *  `Stack` spans two: the row it starts in and the stack's. */
    rows?: 2;
    /** The small caps name of the tile. Omitted for the rail and the hero,
     *  which are identified by what they show rather than by a label. */
    title?: React.ReactNode;
    /** The right-aligned aside: a count, a state, a qualifier. */
    note?: React.ReactNode;
    tone?: "rail";
    /** Anchor target, for the jump nav. */
    id?: string;
    className?: string;
    children: React.ReactNode;
}>) {
    return (
        <section
            id={id}
            className={cn(
                "flex min-w-0 flex-col bg-card scroll-mt-20",
                SPAN[span],
                rows === 2 && "md:row-span-2",
                tone === "rail" && "bg-muted/40",
            )}
        >
            {title && (
                <div className="flex items-baseline justify-between gap-3 border-b border-foreground/12 bg-muted/30 px-4 py-2.5">
                    <h2 className="font-mono text-[9.5px] font-bold tracking-[0.14em] uppercase">
                        {title}
                    </h2>
                    {note && (
                        <span className="font-mono text-[9.5px] tracking-[0.06em] text-muted-foreground">
                            {note}
                        </span>
                    )}
                </div>
            )}
            <div className={cn("min-w-0 flex-1 p-4", className)}>{children}</div>
        </section>
    );
}

/**
 * Several tiles sharing one span, stacked, as a single cell of the frame.
 *
 * This is what lets a rail tile run down beside a column of read tiles without
 * the page counting which of them rendered: the stack is one row whatever is
 * inside it, so the rail spans exactly two, and the last tile grows to meet the
 * rail's foot rather than leaving the tint hanging below it.
 */
export function Stack({ span, children }: Readonly<{ span: Span; children: React.ReactNode }>) {
    return (
        <div className={cn("flex min-w-0 flex-col gap-px [&>*:last-child]:flex-1", SPAN[span])}>
            {children}
        </div>
    );
}
