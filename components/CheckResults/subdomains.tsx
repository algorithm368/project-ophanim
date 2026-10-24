"use client";

import { useContext, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { groupSubdomains, type SubdomainGroup, type SubdomainName } from "@/lib/ti/domain/subdomain-groups";
import type { DomainCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Tile } from "./frame";
import { PivotContext } from "./primitives";

/**
 * Every name certificate transparency has seen under this domain, by family.
 *
 * Three decisions carry this tile, and all of them are about reading a hundred
 * rows rather than about the rows themselves:
 *
 *  - **The pattern prints once, in a heading.** The apex is in the tile's
 *    header and a family's shared part is in its group's (see
 *    `groupSubdomains`), so each row is only the part that distinguishes it.
 *    In one flat list the long names were cut off at the end, which is exactly
 *    where `-fwevt-` and `-http-` told them apart.
 *  - **Rows, not chips, and never cut.** Three columns rather than four, so the
 *    longest name still fits, and a longer one wraps instead of truncating.
 *  - **A large group folds.** Each group shows its first `FOLD` names and says
 *    how many more it holds. The flat list did not fold, because a fold there
 *    hid an unknown tail; here every group's size is in its heading, so a
 *    folded group says what it is hiding, and the whole estate fits a screen.
 */
const FOLD = 12;

export function SubdomainsTile({ result }: Readonly<{ result: DomainCheckResult }>) {
    const subs = result.subdomains;
    const apex = result.domain;
    const groups = useMemo(() => groupSubdomains(subs ?? [], apex), [subs, apex]);
    if (!subs?.length) return null;

    return (
        <Tile
            span={12}
            id="subdomains"
            title="Subdomains"
            note={`${subs.length} under ${apex}`}
        >
            <div className="-mt-3.5">
                {groups.map((group) => (
                    <SubdomainGroupRows key={group.pattern} group={group} />
                ))}
            </div>
        </Tile>
    );
}

/** One family: its heading, then its names, folded past `FOLD` unless only a
 *  few would be hidden. */
function SubdomainGroupRows({ group }: Readonly<{ group: SubdomainGroup }>) {
    const [open, setOpen] = useState(false);
    const foldable = group.names.length > FOLD + 3;
    const shown = foldable && !open ? group.names.slice(0, FOLD) : group.names;
    return (
        <section className="mt-1.5">
            <h3 className="flex items-baseline gap-2.5 border-b border-foreground/25 pt-3.5 pb-1.5">
                <span
                    className={cn(
                        "font-semibold",
                        group.kind === "other"
                            ? "text-[11px] tracking-[0.1em] uppercase"
                            : "font-mono text-[12.5px]",
                    )}
                >
                    {group.pattern}
                </span>
                <span className="text-[12px] font-normal text-muted-foreground">{group.names.length}</span>
            </h3>
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((name) => (
                    <SubdomainRow key={name.full} name={name} />
                ))}
            </div>
            {foldable && (
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    className="pt-1.5 text-[12px] text-muted-foreground"
                >
                    {open ? "" : `+ ${group.names.length - FOLD} more `}
                    <span className="text-foreground underline underline-offset-3 hover:text-muted-foreground">
                        {open ? "show fewer" : "show all"}
                    </span>
                </button>
            )}
        </section>
    );
}

/** One name. Clicking it checks that name, when the page can pivot. */
function SubdomainRow({ name }: Readonly<{ name: SubdomainName }>) {
    const pivot = useContext(PivotContext);

    const label = (
        <>
            <span className="wrap-anywhere">
                {name.shown}
                {name.quiet && <span className="text-muted-foreground">{name.quiet}</span>}
            </span>
            {pivot && (
                <Search className="size-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
            )}
        </>
    );

    const shape =
        "group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-b border-foreground/8 py-1 text-left font-mono text-[12px] leading-[18px]";

    if (!pivot) {
        return (
            <span title={name.full} className={shape}>
                {label}
            </span>
        );
    }
    return (
        <button
            type="button"
            title={`Check ${name.full}`}
            onClick={() => pivot(name.full)}
            className={cn(shape, "transition-colors hover:border-foreground/40")}
        >
            {label}
        </button>
    );
}
