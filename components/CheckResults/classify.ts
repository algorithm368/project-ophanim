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

/** A playful one-liner about where this IP supposedly lives. */
export function locationQuip(geo?: GeoContext): string {
    if (!geo) return "Pulled a vanishing act. No location, no paper trail.";
    if (geo.isProxy)
        return "Sneaky. It threw on a disguise to hide where it really lives.";
    if (geo.isHosting) return "Lives in a server rack, not on anyone's couch.";
    if (geo.isMobile) return "Probably doomscrolling on the bus right now.";
    return "Looks like an ordinary home address. Allegedly.";
}

/** Avatar emoji + passport stamp + wisecrack, keyed to domain maturity. */
export function domainVibe(label: string): {
    avatar: string;
    stamp: string;
    tone: string;
    quip: string;
} {
    switch (label) {
        case "Newly registered":
            return {
                avatar: "🌱",
                stamp: "Fresh!",
                tone: "text-orange-600 dark:text-orange-400 border-orange-500/50",
                quip: "Practically still in the shrink-wrap. Brand-new domains love to misbehave.",
            };
        case "Established":
            return {
                avatar: "🌳",
                stamp: "Veteran",
                tone: "text-emerald-600 dark:text-emerald-400 border-emerald-500/50",
                quip: "Been around the block. Old enough to know better.",
            };
        case "Inactive / parked":
            return {
                avatar: "🚧",
                stamp: "Parked",
                tone: "text-foreground/70 border-foreground/40",
                quip: "Nobody's home. It doesn't even resolve.",
            };
        default:
            return {
                avatar: "🌐",
                stamp: "Domain",
                tone: "text-sky-600 dark:text-sky-400 border-sky-500/50",
                quip: "A domain doing ordinary domain things.",
            };
    }
}

/** Avatar emoji + passport stamp + wisecrack, keyed to what the file is. */
export function hashVibe(
    ctx: HashContext | undefined,
    hasData: boolean,
): { avatar: string; stamp: string; tone: string; quip: string } {
    if (ctx?.malwareFamily || ctx?.threatLabel) {
        return {
            avatar: "🦠",
            stamp: "Malware",
            tone: "text-red-600 dark:text-red-400 border-red-500/50",
            quip: "Caught red-handed. This one's a known troublemaker.",
        };
    }
    if (ctx) {
        return {
            avatar: "📄",
            stamp: "Known",
            tone: "text-sky-600 dark:text-sky-400 border-sky-500/50",
            quip: "Seen this one before. Nothing scandalous on the record.",
        };
    }
    if (hasData) {
        return {
            avatar: "📄",
            stamp: "On file",
            tone: "text-foreground/70 border-foreground/40",
            quip: "On the books, but travelling light. Barely any details.",
        };
    }
    return {
        avatar: "👻",
        stamp: "Unseen",
        tone: "text-foreground/70 border-foreground/40",
        quip: "A total stranger. Never spotted in the wild, which isn't a clean bill of health.",
    };
}
