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

function Results({
    result,
    onRefresh,
}: {
    result: CheckResult;
    onRefresh: () => void;
}) {
    return (
        <div className="mt-5 space-y-5">
            <SourceHealthNotice result={result} />
            <VerdictHero result={result} onRefresh={onRefresh} />
            <ProfileCard result={result} />
            <ExposedServicesCard result={result} />
            <PassiveDnsCard result={result} />
            <ConnectionsCard result={result} />
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
}: {
    result: DomainCheckResult;
    onRefresh: () => void;
}) {
    return (
        <div className="mt-5 space-y-5">
            <SourceHealthNotice result={result} />
            <VerdictHero result={result} onRefresh={onRefresh} />
            <DomainProfileCard result={result} />
            <CertificatesCard result={result} />
            <PassiveDnsCard result={result} />
            <ConnectionsCard result={result} />
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
}: {
    result: HashCheckResult;
    onRefresh: () => void;
}) {
    return (
        <div className="mt-5 space-y-5">
            <SourceHealthNotice result={result} />
            <VerdictHero result={result} onRefresh={onRefresh} />
            <HashProfileCard result={result} />
            <ConnectionsCard result={result} />
            <DistributionUrlsCard result={result} />
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
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
    onRefresh: () => void;
    /** Launch a fresh check for a related indicator clicked within the result. */
    onPivot?: (value: string) => void;
}) {
    const body = isHashResult(result) ? (
        <HashResults result={result} onRefresh={onRefresh} />
    ) : isDomainResult(result) ? (
        <DomainResults result={result} onRefresh={onRefresh} />
    ) : (
        <Results result={result} onRefresh={onRefresh} />
    );
    return (
        <PivotContext.Provider value={onPivot ?? null}>
            {body}
        </PivotContext.Provider>
    );
}
