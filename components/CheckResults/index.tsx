"use client";

import {
    type AnyCheckResult,
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import { isUrlResult, type UrlCheckResult } from "@/lib/ti/url/types";
import type { IOCType } from "@/lib/ioc";
import type { PartialLookup } from "@/lib/ti/partial";
import { PivotContext } from "./primitives";
import { LayerStack } from "./layers";
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
    { id: "record", label: "Record" },
    { id: "research", label: "Research" },
    { id: "sources", label: "Sources" },
];

const DOMAIN_SECTIONS: NavItem[] = [
    { id: "evidence", label: "Evidence" },
    { id: "record", label: "Record" },
    { id: "subdomains", label: "Subdomains" },
    { id: "research", label: "Research" },
    { id: "sources", label: "Sources" },
];

const HASH_SECTIONS: NavItem[] = [
    { id: "origin", label: "Analysis" },
    { id: "dist", label: "Dist" },
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
                    <RecordTile result={result} />
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
                    <RecordTile result={result} />
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

const URL_SECTIONS: NavItem[] = [
    { id: "layers", label: "Layers" },
    { id: "research", label: "Research" },
    { id: "sources", label: "Sources" },
];

/**
 * A URL result leads with the layer stack rather than a single hero, because
 * the headline is meaningless without the layer it came from. Sources are
 * grouped per layer for the same reason: forty rows in one list would hide
 * which of the three indicators each row is actually about.
 */
function UrlResults({
    result,
    onRefresh,
    research,
}: Readonly<{
    result: UrlCheckResult | null;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    const streaming = result === null;
    const LAYER_TITLE = {
        url: "the URL",
        domain: "the host",
        ip: "the address",
    } as const;
    return (
        <div className="mt-5 space-y-5">
            {/* LayerStack renders its own skeleton while streaming: it is the
                hero for a URL result, and there is no verdict to hold a
                separate pending hero's place for until a layer lands. */}
            <Section id="layers">
                <LayerStack result={result} onRefresh={onRefresh} streaming={streaming} />
            </Section>
            {/* Both phases: the rail draws the left column's edge, and a rail
                that appears only with results slides the whole content column
                sideways when the result lands. */}
            <SectionNav items={URL_SECTIONS} />
            {result && (
                <Frame>
                    <LiveIntelTile research={research} kind="domain" />
                    <LinksTile indicator={researchTarget(result).indicator} kind="domain" />
                </Frame>
            )}
            <Section id="sources">
                {/* `result.layers` doesn't exist while streaming; render
                    nothing here until the result lands rather than crashing. */}
                {result && (
                    <div className="space-y-8">
                        {result.layers
                            .filter((layer) => layer.sources.length > 0)
                            .map((layer) => (
                                <div key={layer.kind}>
                                    <p className="mb-3 font-mono text-[11px] tracking-[0.14em] text-foreground/55 uppercase">
                                        Sources for {LAYER_TITLE[layer.kind]}
                                    </p>
                                    <SourceBreakdown
                                        sources={layer.sources}
                                        indicator={layer.indicator}
                                        kind={layer.kind}
                                    />
                                </div>
                            ))}
                    </div>
                )}
            </Section>
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
                    <RecordTile result={result} />
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
    result: AnyCheckResult | UrlCheckResult | null;
    /** Set while the panel is still answering; null once `result` arrives. */
    partial: PartialLookup | null;
    indicator: string;
    /** Which per-type view to render. Needed because the type guards below
     *  have nothing to read while `result` is still null. */
    kind: IOCType | "url";
    onRefresh: () => void;
    /** Launch a fresh check for a related indicator clicked within the result. */
    onPivot?: (value: string) => void;
    /** Progressive live-research state, fetched in parallel with the main check. */
    research: ResearchStreamState;
}>) {
    // A URL result is checked first: it is the most specific shape, and the
    // other guards would not recognize it. The guards still run when a result
    // is present, so a mismatched `kind` cannot render the wrong view.
    //
    // An if/else ladder rather than chained ternaries: `no-nested-ternary` is
    // an error in this project, not a warning.
    let shape: IOCType | "url";
    if (result === null) shape = kind;
    else if (isUrlResult(result)) shape = "url";
    else if (isHashResult(result)) shape = "hash";
    else if (isDomainResult(result)) shape = "domain";
    else shape = "ip";

    const common = { partial, indicator, onRefresh, research };
    let body: React.ReactNode;
    if (shape === "url") {
        body = <UrlResults result={result as UrlCheckResult | null} {...common} />;
    } else if (shape === "hash") {
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
