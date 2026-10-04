"use client";

import {
    type AnyCheckResult,
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import type { LookupType } from "@/lib/ioc";
import type { PartialLookup } from "@/lib/ti/partial";
import { PivotContext } from "./primitives";
import { Frame } from "./frame";
import {
    BallotsTile,
    ConfidenceTile,
    EvidenceTile,
    hasBallots,
    HeroTile,
    ProvenanceTile,
    RailTile,
} from "./panel";
import { RecordTile, VitalsTile } from "./identity";
import { TimelineTile } from "./timeline";
import { SubdomainsTile } from "./subdomains";
import { FrameSkeleton } from "./pending";
import { SourceBreakdown } from "./sources";
import { SourceHealthNotice } from "./activity";
import { DistributionUrlsCard } from "./connections";
import { HashProfileCard } from "./profile";
import { LinksTile, LiveIntelTile, researchTarget } from "./research";
import { SectionNav, type NavItem } from "./section-nav";
import type { ResearchStreamState } from "./use-research";

/** Section anchors + jump-nav labels, in document order, per IOC type. Tiles
 *  self-hide when empty, so SectionNav prunes any that render nothing. */
const IP_SECTIONS: NavItem[] = [
    { id: "evidence", label: "Evidence" },
    { id: "timeline", label: "Timeline" },
    { id: "record", label: "Record" },
    { id: "research", label: "Research" },
    { id: "sources", label: "Sources" },
];

const DOMAIN_SECTIONS: NavItem[] = [
    { id: "evidence", label: "Evidence" },
    { id: "timeline", label: "Timeline" },
    { id: "record", label: "Record" },
    { id: "subdomains", label: "Subdomains" },
    { id: "research", label: "Research" },
    { id: "sources", label: "Sources" },
];

const HASH_SECTIONS: NavItem[] = [
    { id: "origin", label: "Analysis" },
    { id: "dist", label: "Dist" },
    { id: "timeline", label: "Timeline" },
    { id: "research", label: "Research" },
    { id: "sources", label: "Sources" },
];

/** Anchor wrapper: gives a card a nav target and clears the sticky nav on jump. */
function Section({ id, children }: Readonly<{ id: string; children: React.ReactNode }>) {
    return (
        <section id={id} className="scroll-mt-20">
            {children}
        </section>
    );
}

/**
 * The whole result as one frame.
 *
 * Reading order is the grid's own order: what it is, how sure we are, what is
 * on record, where else to look. The narrow lane is what a reader consults
 * rather than reads, and it is tinted rather than separated, because the page
 * is one subject and a gutter between the lanes made it two.
 */
function Results({
    result,
    partial,
    indicator,
    onRefresh,
    research,
}: Readonly<{
    result: CheckResult | null;
    partial: PartialLookup | null;
    indicator: string;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    const streaming = result === null;
    return (
        <div className="mt-5 space-y-5">
            {result && <SourceHealthNotice result={result} />}
            {streaming ? (
                <FrameSkeleton indicator={indicator} partial={partial} kind="ip" />
            ) : (
                <Frame>
                    <RailTile result={result} />
                    <HeroTile result={result} />
                    <ProvenanceTile result={result} onRefresh={onRefresh} />
                    <VitalsTile result={result} />
                    <ConfidenceTile result={result} />
                    <EvidenceTile result={result} span={hasBallots(result) ? 9 : 12} />
                    <BallotsTile result={result} />
                    <TimelineTile result={result} />
                    <RecordTile result={result} omitDates />
                    <LiveIntelTile research={research} kind="ip" />
                    <LinksTile indicator={researchTarget(result).indicator} kind="ip" />
                    <SourceBreakdown
                        sources={result.sources}
                        indicator={indicator}
                        kind="ip"
                    />
                </Frame>
            )}
            {/* Rendered in both phases: it draws the left rail, and a rail that
                appears only with results slides the whole column sideways. */}
            <SectionNav items={IP_SECTIONS} />
        </div>
    );
}

function DomainResults({
    result,
    partial,
    indicator,
    onRefresh,
    research,
}: Readonly<{
    result: DomainCheckResult | null;
    partial: PartialLookup | null;
    indicator: string;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    const streaming = result === null;
    return (
        <div className="mt-5 space-y-5">
            {result && <SourceHealthNotice result={result} />}
            {streaming ? (
                <FrameSkeleton indicator={indicator} partial={partial} kind="domain" />
            ) : (
                <Frame>
                    <RailTile result={result} />
                    <HeroTile result={result} />
                    <ProvenanceTile result={result} onRefresh={onRefresh} />
                    <VitalsTile result={result} />
                    <ConfidenceTile result={result} />
                    <EvidenceTile result={result} span={hasBallots(result) ? 9 : 12} />
                    <BallotsTile result={result} />
                    <TimelineTile result={result} />
                    <RecordTile result={result} omitDates />
                    <SubdomainsTile result={result} />
                    <LiveIntelTile research={research} kind="domain" />
                    <LinksTile indicator={researchTarget(result).indicator} kind="domain" />
                    <SourceBreakdown
                        sources={result.sources}
                        indicator={indicator}
                        kind="domain"
                    />
                </Frame>
            )}
            {/* Rendered in both phases: it draws the left rail, and a rail that
                appears only with results slides the whole column sideways. */}
            <SectionNav items={DOMAIN_SECTIONS} />
        </div>
    );
}

function HashResults({
    result,
    partial,
    indicator,
    onRefresh,
    research,
}: Readonly<{
    result: HashCheckResult | null;
    partial: PartialLookup | null;
    indicator: string;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    const streaming = result === null;
    return (
        <div className="mt-5 space-y-5">
            {result && <SourceHealthNotice result={result} />}
            {streaming ? (
                <FrameSkeleton indicator={indicator} partial={partial} kind="hash" />
            ) : (
                <Frame>
                    <RailTile result={result} />
                    <HeroTile result={result} />
                    <ProvenanceTile result={result} onRefresh={onRefresh} />
                    <VitalsTile result={result} />
                    <ConfidenceTile result={result} />
                    <EvidenceTile result={result} span={hasBallots(result) ? 9 : 12} />
                    <BallotsTile result={result} />
                    <TimelineTile result={result} />
                    <RecordTile result={result} omitDates />
                    <LiveIntelTile research={research} kind="hash" />
                    <LinksTile indicator={researchTarget(result).indicator} kind="hash" />
                    <SourceBreakdown
                        sources={result.sources}
                        indicator={indicator}
                        kind="hash"
                    />
                </Frame>
            )}
            {/* Rendered in both phases: it draws the left rail, and a rail that
                appears only with results slides the whole column sideways. */}
            <SectionNav items={HASH_SECTIONS} />
            {/* Still their own cards: neither has been folded into the frame
                yet. */}
            <Section id="origin">
                <HashProfileCard result={result} streaming={streaming} />
            </Section>
            <Section id="dist">
                <DistributionUrlsCard result={result} streaming={streaming} />
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
}: Readonly<{
    result: AnyCheckResult | null;
    /** Set while the panel is still answering; null once `result` arrives. */
    partial: PartialLookup | null;
    indicator: string;
    /** Which per-type view to render. Needed because the type guards below
     *  have nothing to read while `result` is still null. */
    kind: LookupType;
    onRefresh: () => void;
    /** Launch a fresh check for a related indicator clicked within the result. */
    onPivot?: (value: string) => void;
    /** Progressive live-research state, fetched in parallel with the main check. */
    research: ResearchStreamState;
}>) {
    // The guards still run when a result is present, so a mismatched `kind`
    // cannot render the wrong view.
    //
    // An if/else ladder rather than chained ternaries: `no-nested-ternary` is
    // an error in this project, not a warning.
    let shape: LookupType;
    if (result === null) shape = kind;
    else if (isHashResult(result)) shape = "hash";
    else if (isDomainResult(result)) shape = "domain";
    else shape = "ip";

    const common = { partial, indicator, onRefresh, research };
    let body: React.ReactNode;
    if (shape === "hash") {
        body = <HashResults result={result as HashCheckResult | null} {...common} />;
    } else if (shape === "domain") {
        body = <DomainResults result={result as DomainCheckResult | null} {...common} />;
    } else {
        body = <Results result={result as CheckResult | null} {...common} />;
    }
    return (
        <PivotContext.Provider value={onPivot ?? null}>
            {body}
        </PivotContext.Provider>
    );
}
