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
import type { DomainContext, GeoContext, HashContext } from "@/lib/ti/types";
import type { IconType } from "./types";

export function scoreBarColor(score: number): string {
    if (score >= 70) return "bg-red-500";
    if (score >= 40) return "bg-orange-500";
    if (score >= 15) return "bg-amber-500";
    return "bg-emerald-500";
}

/** Classify what kind of address this is, from ip-api context flags. */
export function classifyType(geo?: GeoContext): {
    label: string;
    desc: string;
    icon: IconType;
} {
    if (!geo) {
        return {
            label: "Unknown type",
            desc: "No network classification available.",
            icon: ShieldQuestion,
        };
    }
    if (geo.isProxy) {
        return {
            label: "Anonymizer",
            desc: "Proxy, VPN, or Tor; the real user is hidden.",
            icon: ShieldAlert,
        };
    }
    if (geo.isHosting) {
        return {
            label: "Hosting / Datacenter",
            desc: "Server or cloud infrastructure, not a home user.",
            icon: Server,
        };
    }
    if (geo.isMobile) {
        return {
            label: "Mobile network",
            desc: "A mobile carrier (cellular) address.",
            icon: Smartphone,
        };
    }
    return {
        label: "Residential / Other",
        desc: "Likely a home or business end-user network.",
        icon: Network,
    };
}

/** Classify a domain from its registration age + whether it resolves. */
export function classifyDomain(
    ctx?: DomainContext,
    resolves?: boolean,
): { label: string; desc: string; icon: IconType } {
    if (ctx?.ageDays !== undefined && ctx.ageDays < 30) {
        return {
            label: "Newly registered",
            desc: `Created ${ctx.ageDays} day(s) ago; young domains skew higher-risk.`,
            icon: Sparkles,
        };
    }
    if (resolves === false) {
        return {
            label: "Inactive / parked",
            desc: "Doesn't currently resolve to an address.",
            icon: ShieldQuestion,
        };
    }
    if (ctx?.ageDays !== undefined) {
        const years = Math.floor(ctx.ageDays / 365);
        return {
            label: "Established",
            desc:
                years >= 1
                    ? `Registered ${years}+ year(s) ago.`
                    : "Registered under a year ago.",
            icon: ShieldCheck,
        };
    }
    return {
        label: "Domain",
        desc: "Registration age unknown.",
        icon: Globe,
    };
}

/** Classify a file from its known malware family / file type, or lack thereof. */
export function classifyHash(
    ctx: HashContext | undefined,
    hasData: boolean,
): { label: string; desc: string; icon: IconType } {
    if (ctx?.malwareFamily) {
        return {
            label: ctx.malwareFamily,
            desc: `Identified as ${ctx.malwareFamily}${
                ctx.fileType ? ` (${ctx.fileType})` : ""
            }.`,
            icon: Bug,
        };
    }
    if (ctx?.fileType) {
        return {
            label: ctx.fileType,
            desc: ctx.fileName
                ? `Seen as "${ctx.fileName}".`
                : "Known file, no malware family attributed.",
            icon: FileText,
        };
    }
    if (!hasData) {
        return {
            label: "Unknown file",
            desc: "No threat-intel source has this file on record.",
            icon: FileDigit,
        };
    }
    return {
        label: "File",
        desc: "No file metadata was returned.",
        icon: FileDigit,
    };
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
