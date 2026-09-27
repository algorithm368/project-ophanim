"use client";

import { useContext } from "react";
import { Search } from "lucide-react";
import type { DomainCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Tile } from "./frame";
import { PivotContext } from "./primitives";

/**
 * Every name certificate transparency has seen under this domain.
 *
 * Two decisions carry this tile, and both are about reading forty rows rather
 * than about the rows themselves:
 *
 *  - **The apex prints once, in the header.** Every row then shows only the
 *    part that distinguishes it. Forty repetitions of ".github.com" is forty
 *    times the same eleven characters between the eye and the word it came for.
 *    The suffix is still drawn on each row, quietly, because a name is not a
 *    name without it and an analyst copying one out needs the whole thing.
 *  - **Rows, not chips.** A chip claims to be a control worth its own weight,
 *    and forty of them in a wrapped block have no column to scan down. These
 *    are the same rows the rest of the page is made of.
 *
 * The list is not capped. A fold here would hide exactly the tail an analyst is
 * looking for, since a newly minted name sorts wherever its letters put it.
 */
export function SubdomainsTile({ result }: Readonly<{ result: DomainCheckResult }>) {
    const subs = result.subdomains ?? [];
    if (subs.length === 0) return null;

    const apex = result.domain;
    return (
        <Tile
            span={12}
            id="subdomains"
            title="Subdomains"
            note={`${subs.length} under ${apex}`}
        >
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
                {subs.map((name) => (
                    <SubdomainRow key={name} name={name} apex={apex} />
                ))}
            </div>
        </Tile>
    );
}

/** One name. Clicking it checks that name, when the page can pivot. */
function SubdomainRow({ name, apex }: Readonly<{ name: string; apex: string }>) {
    const pivot = useContext(PivotContext);
    const suffix = `.${apex}`;
    const head = name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
    const tail = name.endsWith(suffix) ? suffix : "";

    const label = (
        <>
            <span className="truncate">
                {head}
                <span className="text-muted-foreground">{tail}</span>
            </span>
            {pivot && (
                <Search className="size-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
            )}
        </>
    );

    const shape =
        "group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-b border-foreground/8 py-1 text-left font-mono text-[11.5px] last:border-b-0";

    if (!pivot) {
        return (
            <span title={name} className={shape}>
                {label}
            </span>
        );
    }
    return (
        <button
            type="button"
            title={`Check ${name}`}
            onClick={() => pivot(name)}
            className={cn(shape, "transition-colors hover:border-foreground/40")}
        >
            {label}
        </button>
    );
}
