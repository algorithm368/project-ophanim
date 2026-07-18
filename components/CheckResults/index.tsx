"use client";

import {
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import { PivotContext } from "./primitives";
import { VerdictHero } from "./verdict";
import { SourceBreakdown } from "./sources";
import { SourceHealthNotice } from "./activity";
import { CertificatesCard, PassiveDnsCard } from "./deep";
import {
    ConnectionsCard,
    DistributionUrlsCard,
    ExposedServicesCard,
} from "./connections";
import {
    ProfileCard,
    DomainProfileCard,
    HashProfileCard,
} from "./profile";
import { ResearchCard } from "./research";
import { SectionNav, type NavItem } from "./section-nav";
import type { ResearchStreamState } from "./use-research";

/** Section anchors + jump-nav labels, in document order, per IOC type. Cards
 *  self-hide when empty, so SectionNav prunes any that render nothing. */
const IP_SECTIONS: NavItem[] = [
    { id: "origin", label: "Origin" },
    { id: "exposed", label: "Exposed" },
    { id: "dns", label: "DNS" },
    { id: "related", label: "Related" },
    { id: "research", label: "Research" },
    { id: "sources", label: "Sources" },
];

const DOMAIN_SECTIONS: NavItem[] = [
    { id: "origin", label: "Origin" },
    { id: "certs", label: "Certs" },
    { id: "dns", label: "DNS" },
    { id: "related", label: "Related" },
    { id: "research", label: "Research" },
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
function Section({ id, children }: { id: string; children: React.ReactNode }) {
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
}: {
    result: CheckResult;
    onRefresh: () => void;
    research: ResearchStreamState;
}) {
    return (
        <div className="mt-5 space-y-5">
            <SourceHealthNotice result={result} />
            <VerdictHero result={result} onRefresh={onRefresh} />
            <SectionNav items={IP_SECTIONS} />
            <Section id="origin">
                <ProfileCard result={result} />
            </Section>
            <Section id="exposed">
                <ExposedServicesCard result={result} />
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
}: {
    result: DomainCheckResult;
    onRefresh: () => void;
    research: ResearchStreamState;
}) {
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

function HashResults({
    result,
    onRefresh,
    research,
}: {
    result: HashCheckResult;
    onRefresh: () => void;
    research: ResearchStreamState;
}) {
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
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
    onRefresh: () => void;
    /** Launch a fresh check for a related indicator clicked within the result. */
    onPivot?: (value: string) => void;
    /** Progressive live-research state, fetched in parallel with the main check. */
    research: ResearchStreamState;
}) {
    const body = isHashResult(result) ? (
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
