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
import { PivotContext } from "./primitives";
import { LayerStack } from "./layers";
import { ActiveScanCard } from "./active-scan";
import { VerdictHero } from "./verdict";
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
    onRefresh,
    research,
}: Readonly<{
    result: CheckResult;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    return (
        <div className="mt-5 space-y-5">
            <SourceHealthNotice result={result} />
            <VerdictHero result={result} onRefresh={onRefresh} />
            <SectionNav items={IP_SECTIONS} />
            <Section id="dossier">
                <IpDossierCard result={result} />
            </Section>
            <Section id="dns">
                <PassiveDnsCard result={result} />
            </Section>
            <Section id="related">
                <ConnectionsCard result={result} />
            </Section>
            <Section id="research">
                <ResearchCard result={result} research={research} />
            </Section>
            <Section id="scan">
                <ActiveScanCard indicator={result.ip} kind="ip" />
            </Section>
            <Section id="sources">
                <SourceBreakdown
                    sources={result.sources}
                    indicator={result.ip}
                    kind="ip"
                />
            </Section>
        </div>
    );
}

function DomainResults({
    result,
    onRefresh,
    research,
}: Readonly<{
    result: DomainCheckResult;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    return (
        <div className="mt-5 space-y-5">
            <SourceHealthNotice result={result} />
            <VerdictHero result={result} onRefresh={onRefresh} />
            <SectionNav items={DOMAIN_SECTIONS} />
            <Section id="origin">
                <DomainProfileCard result={result} />
            </Section>
            <Section id="certs">
                <CertificatesCard result={result} />
            </Section>
            <Section id="dns">
                <PassiveDnsCard result={result} />
            </Section>
            <Section id="related">
                <ConnectionsCard result={result} />
            </Section>
            <Section id="research">
                <ResearchCard result={result} research={research} />
            </Section>
            <Section id="scan">
                <ActiveScanCard indicator={result.domain} kind="domain" />
            </Section>
            <Section id="sources">
                <SourceBreakdown
                    sources={result.sources}
                    indicator={result.domain}
                    kind="domain"
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
    onRefresh,
    research,
}: Readonly<{
    result: UrlCheckResult;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    const LAYER_TITLE = {
        url: "the URL",
        domain: "the host",
        ip: "the address",
    } as const;
    return (
        <div className="mt-5 space-y-5">
            <Section id="layers">
                <LayerStack result={result} onRefresh={onRefresh} />
            </Section>
            <SectionNav items={URL_SECTIONS} />
            <Section id="research">
                <ResearchCard result={result} research={research} />
            </Section>
            <Section id="scan">
                <ActiveScanCard indicator={result.url} kind="url" />
            </Section>
            <Section id="sources">
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
            </Section>
        </div>
    );
}

function HashResults({
    result,
    onRefresh,
    research,
}: Readonly<{
    result: HashCheckResult;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    return (
        <div className="mt-5 space-y-5">
            <SourceHealthNotice result={result} />
            <VerdictHero result={result} onRefresh={onRefresh} />
            <SectionNav items={HASH_SECTIONS} />
            <Section id="origin">
                <HashProfileCard result={result} />
            </Section>
            <Section id="related">
                <ConnectionsCard result={result} />
            </Section>
            <Section id="dist">
                <DistributionUrlsCard result={result} />
            </Section>
            <Section id="research">
                <ResearchCard result={result} research={research} />
            </Section>
            <Section id="sources">
                <SourceBreakdown
                    sources={result.sources}
                    indicator={result.hash}
                    kind="hash"
                />
            </Section>
        </div>
    );
}

export default function CheckResults({
    result,
    onRefresh,
    onPivot,
    research,
}: Readonly<{
    result: AnyCheckResult | UrlCheckResult;
    onRefresh: () => void;
    /** Launch a fresh check for a related indicator clicked within the result. */
    onPivot?: (value: string) => void;
    /** Progressive live-research state, fetched in parallel with the main check. */
    research: ResearchStreamState;
}>) {
    // Checked first: a URL result is the most specific shape, and the other
    // guards would not recognize it.
    const body = isUrlResult(result) ? (
        <UrlResults result={result} onRefresh={onRefresh} research={research} />
    ) : isHashResult(result) ? (
        <HashResults result={result} onRefresh={onRefresh} research={research} />
    ) : isDomainResult(result) ? (
        <DomainResults result={result} onRefresh={onRefresh} research={research} />
    ) : (
        <Results result={result} onRefresh={onRefresh} research={research} />
    );
    return (
        <PivotContext.Provider value={onPivot ?? null}>
            {body}
        </PivotContext.Provider>
    );
}
