"use client";

import {
    useEffect,
    useState,
    type ComponentType,
    type MouseEvent,
} from "react";
import {
    BadgeCheck,
    Circle,
    Download,
    Fingerprint,
    Globe,
    Link2,
    ListChecks,
    Network,
    Telescope,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pickActiveId } from "./use-scroll-spy";

export type NavItem = { id: string; label: string };

const NAV_OFFSET = 88;

type IconType = ComponentType<{ className?: string }>;

/** One glyph per section id. The item's label is the accessible name/tooltip. */
const ICONS: Record<string, IconType> = {
    origin: Globe,
    dossier: Fingerprint,
    certs: BadgeCheck,
    dns: Network,
    related: Link2,
    dist: Download,
    research: Telescope,
    sources: ListChecks,
};

function jumpTo(e: MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function NavLink({ item, active }: Readonly<{ item: NavItem; active: boolean }>) {
    const Icon = ICONS[item.id] ?? Circle;
    return (
        <a
            href={`#${item.id}`}
            onClick={(e) => jumpTo(e, item.id)}
            aria-label={item.label}
            title={item.label}
            aria-current={active ? "true" : undefined}
            className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors",
                active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
        >
            <Icon className="size-4" />
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
            {/* Wide screens: vertical icon rail floating in the left gutter. */}
            <nav
                aria-label="Result sections"
                className="fixed top-28 left-4 z-30 hidden flex-col gap-1 rounded-lg border border-border bg-background/80 p-1 backdrop-blur xl:flex 2xl:left-8"
            >
                {present.map((item) => (
                    <NavLink
                        key={item.id}
                        item={item}
                        active={active === item.id}
                    />
                ))}
            </nav>

            {/* Narrow screens: sticky horizontal icon strip above the content. */}
            <nav
                aria-label="Result sections"
                className="sticky top-[4.25rem] z-20 -mx-4 border-b border-border bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 xl:hidden"
            >
                <div className="flex gap-1 overflow-x-auto py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {present.map((item) => (
                        <NavLink
                            key={item.id}
                            item={item}
                            active={active === item.id}
                        />
                    ))}
                </div>
            </nav>
        </>
    );
}
