import {
    Bug,
    FileDigit,
    FileText,
    Globe,
    Network,
    Server,
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
    Smartphone,
    Sparkles,
} from "lucide-react";
import {
    classifyDomainLabel,
    classifyHashLabel,
    classifyIpLabel,
} from "@/lib/ti/indicator-class";
import type { DomainContext, GeoContext, HashContext } from "@/lib/ti/types";
import type { IconType } from "./types";

export function scoreBarColor(score: number): string {
    if (score >= 70) return "bg-red-500";
    if (score >= 40) return "bg-orange-500";
    if (score >= 15) return "bg-amber-500";
    return "bg-emerald-500";
}

/** The icon each label carries. Kept here rather than in lib/ because lucide is
 *  a component-layer dependency and the labels are not. */
const IP_ICON: Record<string, IconType> = {
    "Unknown type": ShieldQuestion,
    Anonymizer: ShieldAlert,
    "Hosting / Datacenter": Server,
    "Mobile network": Smartphone,
    "Residential / Other": Network,
};

/** Classify what kind of address this is, from ip-api context flags. */
export function classifyType(geo?: GeoContext): {
    label: string;
    desc: string;
    icon: IconType;
} {
    const c = classifyIpLabel(geo);
    return { ...c, icon: IP_ICON[c.label] ?? ShieldQuestion };
}

const DOMAIN_ICON: Record<string, IconType> = {
    "Newly registered": Sparkles,
    "Inactive / parked": ShieldQuestion,
    Established: ShieldCheck,
    Domain: Globe,
};

/** Classify a domain from its registration age + whether it resolves. */
export function classifyDomain(
    ctx?: DomainContext,
    resolves?: boolean,
): { label: string; desc: string; icon: IconType } {
    const c = classifyDomainLabel(ctx, resolves);
    return { ...c, icon: DOMAIN_ICON[c.label] ?? Globe };
}

/** Classify a file from its known malware family / file type, or lack thereof. */
export function classifyHash(
    ctx: HashContext | undefined,
    hasData: boolean,
): { label: string; desc: string; icon: IconType } {
    const c = classifyHashLabel(ctx, hasData);
    // The hash label is the malware family or file type itself, so it cannot be
    // a table key. Pick the icon from which branch produced it.
    if (ctx?.malwareFamily) return { ...c, icon: Bug };
    if (ctx?.fileType) return { ...c, icon: FileText };
    return { ...c, icon: FileDigit };
}

/**
 * ISO 3166-1 alpha-2 country code -> flag image URL. We use real images rather
 * than emoji flags because Windows doesn't render regional-indicator emoji as
 * flags (it shows the two letters instead).
 */
export function flagUrl(cc?: string): string | undefined {
    if (!cc || !/^[a-zA-Z]{2}$/.test(cc)) return undefined;
    return `https://flagcdn.com/${cc.toLowerCase()}.svg`;
}

/** Accent tone (text color classes) for a domain maturity classification. */
export function domainTone(label: string): string {
    switch (label) {
        case "Newly registered":
            return "text-orange-600 dark:text-orange-400";
        case "Established":
            return "text-emerald-600 dark:text-emerald-400";
        case "Inactive / parked":
            return "text-foreground/70";
        default:
            return "text-foreground/80";
    }
}

/** Accent tone (text color classes) for a file/hash classification. */
export function hashTone(ctx: HashContext | undefined): string {
    if (ctx?.malwareFamily || ctx?.threatLabel)
        return "text-red-600 dark:text-red-400";
    return "text-foreground/80";
}
