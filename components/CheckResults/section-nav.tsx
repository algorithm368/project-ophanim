"use client";

import {
    useEffect,
    useState,
    type ComponentType,
    type MouseEvent,
} from "react";
import {
    BadgeCheck,
    Camera,
    Circle,
    Code2,
    Download,
    Fingerprint,
    Gavel,
    Globe,
    Link2,
    ListChecks,
    MonitorPlay,
    Network,
    Send,
    Telescope,
    Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pickActiveId } from "./use-scroll-spy";

export type NavItem = { id: string; label: string };

const NAV_OFFSET = 88;

type IconType = ComponentType<{ className?: string }>;

/** One glyph per section id, across both readings. The item's label is the
 *  accessible name/tooltip, so a section with no glyph here still works; it
 *  just falls back to a bare circle. */
const ICONS: Record<string, IconType> = {
    // The passive result page.
    origin: Globe,
    dossier: Fingerprint,
    certs: BadgeCheck,
    dns: Network,
    related: Link2,
    dist: Download,
    research: Telescope,
    sources: ListChecks,
    // The active scan page, in the order the scanner met them.
    capture: Camera,
    request: Send,
    page: MonitorPlay,
    network: Waypoints,
    dom: Code2,
    identity: Fingerprint,
    verdicts: Gavel,
    trace: ListChecks,
    subject: Globe,
};

function jumpTo(e: MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * One jump target, labelled.
 *
 * The label used to live only in `aria-label`/`title`, which made the nav six
 * unnamed glyphs: nothing on screen mapped a fingerprint to "Dossier" or a
 * telescope to "Research", and because the section set differs per IOC type
 * (and again on the scan page) the mapping could not be learned once and
 * reused. A tooltip is not a fix — it needs a pointer, a hover, and a second
 * of patience to answer a question the label answers for free.
 *
 * `rail` is the desktop gutter column, `strip` the sticky row on narrow
 * screens, where the target also grows to the 44px minimum it was missing at
 * `size-9`.
 */
function NavLink({
    item,
    active,
    variant,
}: Readonly<{ item: NavItem; active: boolean; variant: "rail" | "strip" }>) {
    const Icon = ICONS[item.id] ?? Circle;
    return (
        <a
            href={`#${item.id}`}
            onClick={(e) => jumpTo(e, item.id)}
            aria-current={active ? "true" : undefined}
            className={cn(
                "flex min-w-0 shrink-0 items-center rounded-md transition-colors",
                // Tight by design. The rail is fixed in the left gutter, which
                // is (100vw - 64rem) / 2 wide — 128px at the xl breakpoint where
                // the rail first appears — so padding spent here is padding that
                // pushes the rail into the content column.
                variant === "rail"
                    ? "gap-2 px-2 py-1.5 text-xs"
                    : "min-h-11 gap-1.5 px-2.5 text-xs",
                active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
        >
            <Icon className={variant === "rail" ? "size-4 shrink-0" : "size-3.5 shrink-0"} />
            <span className="truncate">{item.label}</span>
        </a>
    );
}

/**
 * Section jump nav for the result page — icon-only, scroll-spy highlighted.
 * On wide screens it is a vertical rail floating in the left gutter, listed
 * top-down in document order; below that it falls back to a sticky horizontal
 * icon strip so it never overlaps the content column. Result cards self-hide
 * when empty, so items whose section rendered nothing are pruned.
 */
export function SectionNav({ items }: Readonly<{ items: NavItem[] }>) {
    const candidateKey = items.map((i) => i.id).join(",");
    const [present, setPresent] = useState<NavItem[]>(items);
    const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

    useEffect(() => {
        const byId = new Map(items.map((i) => [i.id, i] as const));
        let frame = 0;

        function update() {
            frame = 0;
            const measured = items
                .map((i) => {
                    const el = document.getElementById(i.id);
                    if (!el || el.offsetHeight <= 0) return null;
                    return { id: i.id, top: el.getBoundingClientRect().top };
                })
                .filter((s): s is { id: string; top: number } => s !== null);
            setPresent(measured.map((m) => byId.get(m.id)!));
            setActive(pickActiveId(measured, NAV_OFFSET));
        }
        function schedule() {
            if (frame) return;
            frame = requestAnimationFrame(update);
        }

        schedule();
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        return () => {
            window.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
            if (frame) cancelAnimationFrame(frame);
        };
        // items is derived from candidateKey; re-run when the id set changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidateKey]);

    if (present.length < 2) return null;

    return (
        <>
            {/* Wide screens: vertical labelled rail floating in the left gutter. */}
            <nav
                aria-label="Result sections"
                // Width is left to the content — the rail is as wide as its
                // longest label and no wider. The gutter it sits in is
                // (100vw - 64rem) / 2, or 128px at `xl`, and the content column
                // pads 16px in from there; a fixed width wide enough for the
                // longest label on any page would spend most of that clearance
                // on the pages whose labels are shorter. The max-width is a
                // backstop against a future section named something long.
                className="fixed top-28 left-4 z-30 hidden max-w-[7rem] flex-col gap-0.5 rounded-lg border border-border bg-background/80 p-1 backdrop-blur xl:flex 2xl:left-8"
            >
                {present.map((item) => (
                    <NavLink
                        key={item.id}
                        item={item}
                        active={active === item.id}
                        variant="rail"
                    />
                ))}
            </nav>

            {/* Narrow screens: sticky horizontal labelled strip above the content.
                Opaque, unlike the frosted panel this replaced. At 70% over a
                blur, the page scrolling underneath showed through the strip as
                ghosted text: tolerable behind six icons, not behind six words,
                where the reader is asked to separate the label from whatever
                happens to be passing behind it. The blur stays for the sliver
                the border rounds off. */}
            <nav
                aria-label="Result sections"
                className="sticky top-[4.25rem] z-20 -mx-4 border-b border-border bg-background px-4 backdrop-blur xl:hidden"
            >
                <div className="flex gap-1 overflow-x-auto py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {present.map((item) => (
                        <NavLink
                            key={item.id}
                            item={item}
                            active={active === item.id}
                            variant="strip"
                        />
                    ))}
                </div>
            </nav>
        </>
    );
}
