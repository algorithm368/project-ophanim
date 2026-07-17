"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { pickActiveId } from "./use-scroll-spy";

export type NavItem = { id: string; label: string };

const NAV_OFFSET = 88;

/**
 * Sticky jump nav for the result page. Renders one anchor per section, pins to
 * the top of the viewport on scroll, and highlights the section currently under
 * the nav line (scroll-spy). Result cards self-hide when they have no data, so
 * candidate items whose section rendered nothing are pruned — the nav never
 * points at an empty anchor.
 */
export function SectionNav({ items }: { items: NavItem[] }) {
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

        // Measure on the next frame (async — avoids a synchronous effect setState)
        // and on every scroll/resize thereafter.
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

    function go(e: MouseEvent<HTMLAnchorElement>, id: string) {
        e.preventDefault();
        document
            .getElementById(id)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    return (
        <nav
            aria-label="Result sections"
            className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70"
        >
            <div className="flex gap-1 overflow-x-auto py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {present.map((item) => (
                    <a
                        key={item.id}
                        href={`#${item.id}`}
                        onClick={(e) => go(e, item.id)}
                        aria-current={active === item.id ? "true" : undefined}
                        className={cn(
                            "shrink-0 rounded-md px-2.5 py-1 font-mono text-[11px] font-medium tracking-wider uppercase transition-colors",
                            active === item.id
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {item.label}
                    </a>
                ))}
            </div>
        </nav>
    );
}
