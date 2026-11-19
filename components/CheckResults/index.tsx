"use client";

import {
    type AnyCheckResult,
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import { useMemo, useState } from "react";
import type { LookupType } from "@/lib/ioc";
import type { PartialLookup } from "@/lib/ti/partial";
import { provisionalResult } from "@/lib/ti/provisional";
import { PivotContext } from "./primitives";
import { Frame, Stack } from "./frame";
import { EvidenceTile, HeroTile, RailTile } from "./panel";
import { ProvenanceTile } from "./readout";
import { RecordTile, VitalsTile } from "./identity";
import { TimelineTile } from "./timeline";
import { SubdomainsTile } from "./subdomains";
import { LiveContext, useReducedMotion } from "./live";
import { SourceBreakdown } from "./sources";
import { SourceHealthNotice } from "./activity";
import { DistributionUrlsCard } from "./connections";
import { HashProfileCard } from "./profile";
import { LinksTile, LiveIntelTile, hasLiveIntel, researchTarget } from "./research";
import type { ResearchStreamState } from "./use-research";

/** Anchor wrapper: gives a card an id to link to. */
function Section({ id, children }: Readonly<{ id: string; children: React.ReactNode }>) {
    return (
        <section id={id} className="scroll-mt-20">
            {children}
        </section>
    );
}

/** What every per-type view takes. `result` is always present: while the
 *  panel answers it is the provisional one, assembled from whoever has landed,
 *  and the tiles read `LiveContext` for what they may not show yet. */
type ViewProps<R> = Readonly<{
    result: R;
    pending: boolean;
    indicator: string;
    onRefresh: () => void;
    research: ResearchStreamState;
}>;

/**
 * The whole result as one frame.
 *
 * Reading order is the grid's own order: what it is, how sure we are, what is
 * on record, where else to look. The narrow lane is what a reader consults
 * rather than reads, and it is tinted rather than separated, because the page
 * is one subject and a gutter between the lanes made it two.
 *
 * The same frame from the first frame of a lookup to the last. There used to
 * be a separate pending page, first a grey copy of this one and then a roll
 * call of the sources, and both were swapped out whole when the last source
 * landed. Now the tiles are rendered from the sources that have answered and
 * each value is typed into its slot as it arrives, so the end of a lookup is
 * the last few values landing, not a new page.
 */
function Results({ result, pending, indicator, onRefresh, research }: ViewProps<CheckResult>) {
    return (
        <div className="mt-5 space-y-5">
            {!pending && <SourceHealthNotice result={result} />}
            <Frame>
                <RailTile result={result} />
                <HeroTile result={result} />
                <ProvenanceTile result={result} onRefresh={onRefresh} />
                <Stack span={9}>
                    <VitalsTile result={result} span={12} />
                    <EvidenceTile result={result} />
                </Stack>
                <TimelineTile result={result} />
                <RecordTile result={result} omitDates />
                <LiveIntelTile research={research} kind="ip" />
                <LinksTile
                    indicator={researchTarget(result).indicator}
                    kind="ip"
                    span={hasLiveIntel(research, "ip") ? 7 : 12}
                />
                <SourceBreakdown sources={result.sources} indicator={indicator} kind="ip" />
            </Frame>
        </div>
    );
}

function DomainResults({ result, pending, indicator, onRefresh, research }: ViewProps<DomainCheckResult>) {
    return (
        <div className="mt-5 space-y-5">
            {!pending && <SourceHealthNotice result={result} />}
            <Frame>
                <RailTile result={result} />
                <HeroTile result={result} />
                <ProvenanceTile result={result} onRefresh={onRefresh} />
                <Stack span={9}>
                    <VitalsTile result={result} span={12} />
                    <EvidenceTile result={result} />
                </Stack>
                <TimelineTile result={result} />
                <RecordTile result={result} omitDates />
                <SubdomainsTile result={result} />
                <LiveIntelTile research={research} kind="domain" />
                <LinksTile
                    indicator={researchTarget(result).indicator}
                    kind="domain"
                    span={hasLiveIntel(research, "domain") ? 7 : 12}
                />
                <SourceBreakdown sources={result.sources} indicator={indicator} kind="domain" />
            </Frame>
        </div>
    );
}

function HashResults({ result, pending, indicator, onRefresh, research }: ViewProps<HashCheckResult>) {
    return (
        <div className="mt-5 space-y-5">
            {!pending && <SourceHealthNotice result={result} />}
            <Frame>
                <RailTile result={result} />
                <HeroTile result={result} />
                <ProvenanceTile result={result} onRefresh={onRefresh} />
                <Stack span={9}>
                    <VitalsTile result={result} span={12} />
                    <EvidenceTile result={result} />
                </Stack>
                <TimelineTile result={result} />
                <RecordTile result={result} omitDates />
                <LiveIntelTile research={research} kind="hash" />
                <LinksTile
                    indicator={researchTarget(result).indicator}
                    kind="hash"
                    span={hasLiveIntel(research, "hash") ? 7 : 12}
                />
                <SourceBreakdown sources={result.sources} indicator={indicator} kind="hash" />
            </Frame>
            {/* Still their own cards: neither has been folded into the frame
                yet, and neither can say anything until the result lands. */}
            <Section id="origin">
                <HashProfileCard result={pending ? null : result} streaming={pending} />
            </Section>
            <Section id="dist">
                <DistributionUrlsCard result={pending ? null : result} streaming={pending} />
            </Section>
        </div>
    );
}

export default function CheckResults({
    result,
    partial,
    indicator,
    kind,
    onRefresh,
    onPivot,
    research,
    typing = false,
}: Readonly<{
    result: AnyCheckResult | null;
    /** Set while the panel is still answering; null once `result` arrives. */
    partial: PartialLookup | null;
    indicator: string;
    /** Which per-type view to render while `result` is still null. */
    kind: LookupType;
    onRefresh: () => void;
    /** Launch a fresh check for a related indicator clicked within the result. */
    onPivot?: (value: string) => void;
    /** Progressive live-research state, fetched in parallel with the main check. */
    research: ResearchStreamState;
    /** This lookup is streaming from the sources, so values are typed in as
     *  they land. False for a cache hit or a restored result. */
    typing?: boolean;
}>) {
    // The provisional result's clock, which a domain's age is counted from.
    // Per mount: the checker remounts this for every lookup.
    const [startedAt] = useState(() => new Date().toISOString());
    const reduced = useReducedMotion();
    const pending = result === null;
    const settled = partial?.sources;
    const shown = useMemo(
        () => result ?? provisionalResult(kind, indicator, settled ?? [], startedAt),
        [result, kind, indicator, settled, startedAt],
    );
    const live = useMemo(
        () => ({ pending, typing: typing && !reduced, partial }),
        [pending, typing, reduced, partial],
    );

    // An if/else ladder rather than chained ternaries: `no-nested-ternary` is
    // an error in this project, not a warning.
    const common = { pending, indicator, onRefresh, research };
    let body: React.ReactNode;
    if (isHashResult(shown)) {
        body = <HashResults result={shown} {...common} />;
    } else if (isDomainResult(shown)) {
        body = <DomainResults result={shown} {...common} />;
    } else {
        body = <Results result={shown} {...common} />;
    }
    return (
        <PivotContext.Provider value={onPivot ?? null}>
            <LiveContext.Provider value={live}>{body}</LiveContext.Provider>
        </PivotContext.Provider>
    );
}
