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
import { ActiveScanCard } from "./active-scan";
import { VerdictHero } from "./verdict";
import { PendingHero } from "./pending";
import { SourceBreakdown } from "./sources";
import { SourceHealthNotice } from "./activity";
import { CertificatesCard, PassiveDnsCard } from "./deep";
import {
    ConnectionsCard,
    DistributionUrlsCard,
} from "./connections";
import { DomainProfileCard, HashProfileCard } from "./profile";
import { IpDossierCard } from "./dossier";
import { ResearchCard } from "./research";
import { SectionNav, type NavItem } from "./section-nav";
import type { ResearchStreamState } from "./use-research";

/** Section anchors + jump-nav labels, in document order, per IOC type. Cards
 *  self-hide when empty, so SectionNav prunes any that render nothing. */
const IP_SECTIONS: NavItem[] = [
    { id: "dossier", label: "Dossier" },
    { id: "dns", label: "DNS" },
    { id: "related", label: "Related" },
    { id: "research", label: "Research" },
    { id: "scan", label: "Scan" },
    { id: "sources", label: "Sources" },
];

const DOMAIN_SECTIONS: NavItem[] = [
    { id: "origin", label: "Origin" },
    { id: "certs", label: "Certs" },
    { id: "dns", label: "DNS" },
    { id: "related", label: "Related" },
    { id: "research", label: "Research" },
    { id: "scan", label: "Scan" },
    { id: "sources", label: "Sources" },
];

const HASH_SECTIONS: NavItem[] = [
    { id: "origin", label: "Origin" },
    { id: "related", label: "Related" },
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
            {result ? (
                <VerdictHero result={result} onRefresh={onRefresh} />
            ) : (
                partial && <PendingHero indicator={indicator} partial={partial} />
            )}
            {/* Rendered in both phases: it draws the left rail, and a rail that
                appears only with results slides the whole column sideways. */}
            <SectionNav items={IP_SECTIONS} />
            <Section id="dossier">
                <IpDossierCard result={result} streaming={streaming} />
            </Section>
            <Section id="dns">
                <PassiveDnsCard result={result} streaming={streaming} />
            </Section>
            <Section id="related">
                <ConnectionsCard result={result} streaming={streaming} />
            </Section>
            <Section id="research">
                <ResearchCard result={result} research={research} streaming={streaming} />
            </Section>
            <Section id="scan">
                {/* Takes an indicator, not a result: it reports whether a scan
                    already exists, which does not depend on this lookup. */}
                <ActiveScanCard indicator={indicator} kind="ip" />
            </Section>
            <Section id="sources">
                <SourceBreakdown
                    sources={result?.sources ?? partial?.sources ?? []}
                    indicator={indicator}
                    kind="ip"
                    streaming={streaming}
                />
            </Section>
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
            {result ? (
                <VerdictHero result={result} onRefresh={onRefresh} />
            ) : (
                partial && <PendingHero indicator={indicator} partial={partial} />
            )}
            {/* Both phases: the rail draws the left column's edge, and a rail
                that appears only with results slides the whole content column
                sideways when the result lands. */}
            <SectionNav items={DOMAIN_SECTIONS} />
            <Section id="origin">
                <DomainProfileCard result={result} streaming={streaming} />
            </Section>
            <Section id="certs">
                <CertificatesCard result={result} streaming={streaming} />
            </Section>
            <Section id="dns">
                <PassiveDnsCard result={result} streaming={streaming} />
            </Section>
            <Section id="related">
                <ConnectionsCard result={result} streaming={streaming} />
            </Section>
            <Section id="research">
                <ResearchCard result={result} research={research} streaming={streaming} />
            </Section>
            <Section id="scan">
                {/* Takes an indicator, not a result: it reports whether a scan
                    already exists, which does not depend on this lookup. */}
                <ActiveScanCard indicator={indicator} kind="domain" />
            </Section>
            <Section id="sources">
                <SourceBreakdown
                    sources={result?.sources ?? partial?.sources ?? []}
                    indicator={indicator}
                    kind="domain"
                    streaming={streaming}
                />
            </Section>
        </div>
    );
}

const URL_SECTIONS: NavItem[] = [
    { id: "layers", label: "Layers" },
    { id: "research", label: "Research" },
    { id: "scan", label: "Scan" },
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
    indicator,
    onRefresh,
    research,
}: Readonly<{
    result: UrlCheckResult | null;
    indicator: string;
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
            <Section id="research">
                <ResearchCard result={result} research={research} streaming={streaming} />
            </Section>
            <Section id="scan">
                {/* Takes an indicator, not a result: it reports whether a scan
                    already exists, which does not depend on this lookup. */}
                <ActiveScanCard indicator={indicator} kind="url" />
            </Section>
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
            {result ? (
                <VerdictHero result={result} onRefresh={onRefresh} />
            ) : (
                partial && <PendingHero indicator={indicator} partial={partial} />
            )}
            {/* Both phases: the rail draws the left column's edge, and a rail
                that appears only with results slides the whole content column
                sideways when the result lands. */}
            <SectionNav items={HASH_SECTIONS} />
            <Section id="origin">
                <HashProfileCard result={result} streaming={streaming} />
            </Section>
            <Section id="related">
                <ConnectionsCard result={result} streaming={streaming} />
            </Section>
            <Section id="dist">
                <DistributionUrlsCard result={result} streaming={streaming} />
            </Section>
            <Section id="research">
                <ResearchCard result={result} research={research} streaming={streaming} />
            </Section>
            <Section id="sources">
                <SourceBreakdown
                    sources={result?.sources ?? partial?.sources ?? []}
                    indicator={indicator}
                    kind="hash"
                    streaming={streaming}
                />
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
