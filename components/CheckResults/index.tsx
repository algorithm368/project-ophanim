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
import type { ResearchStreamState } from "./use-research";

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
            <ProfileCard result={result} />
            <ExposedServicesCard result={result} />
            <PassiveDnsCard result={result} />
            <ConnectionsCard result={result} />
            <ResearchCard result={result} research={research} />
            <SourceBreakdown
                sources={result.sources}
                indicator={result.ip}
                kind="ip"
            />
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
            <DomainProfileCard result={result} />
            <CertificatesCard result={result} />
            <PassiveDnsCard result={result} />
            <ConnectionsCard result={result} />
            <ResearchCard result={result} research={research} />
            <SourceBreakdown
                sources={result.sources}
                indicator={result.domain}
                kind="domain"
            />
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
            <HashProfileCard result={result} />
            <ConnectionsCard result={result} />
            <DistributionUrlsCard result={result} />
            <ResearchCard result={result} research={research} />
            <SourceBreakdown
                sources={result.sources}
                indicator={result.hash}
                kind="hash"
            />
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
