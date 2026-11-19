"use client";

import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { Verdict } from "@/lib/ti/types";
import type { IconType } from "./types";

export type VerdictStyle = {
    label: string;
    headline: string;
    icon: IconType;
    text: string;
    bar: string;
    ring: string;
    chip: string;
    wash: string;
    border: string;
};

/**
 * The verdict's colour and label, shared by every component that has to show
 * one. The hero this file used to hold is gone: `panel.tsx` renders the
 * verdict now, once, under the sprite.
 */
export const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
    malicious: {
        label: "Malicious",
        headline: "Malicious",
        icon: ShieldAlert,
        text: "text-red-600 dark:text-red-400",
        bar: "bg-red-500",
        ring: "stroke-red-500",
        chip: "border-transparent bg-red-500/12 text-red-600 dark:text-red-400",
        wash: "from-red-500/15",
        border: "border-red-500/40",
    },
    suspicious: {
        label: "Suspicious",
        headline: "Suspicious",
        icon: ShieldAlert,
        text: "text-orange-600 dark:text-orange-400",
        bar: "bg-orange-500",
        ring: "stroke-orange-500",
        chip: "border-transparent bg-orange-500/12 text-orange-600 dark:text-orange-400",
        wash: "from-orange-500/15",
        border: "border-orange-500/40",
    },
    low: {
        label: "Low risk",
        headline: "Low risk",
        icon: ShieldQuestion,
        text: "text-amber-600 dark:text-amber-400",
        bar: "bg-amber-500",
        ring: "stroke-amber-500",
        chip: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
        wash: "from-amber-500/12",
        border: "border-amber-500/40",
    },
    clean: {
        label: "Clean",
        headline: "Clean",
        icon: ShieldCheck,
        text: "text-emerald-600 dark:text-emerald-400",
        bar: "bg-emerald-500",
        ring: "stroke-emerald-500",
        chip: "border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
        wash: "from-emerald-500/12",
        border: "border-emerald-500/40",
    },
    unknown: {
        label: "Unknown",
        headline: "Unknown",
        icon: ShieldQuestion,
        text: "text-muted-foreground",
        bar: "bg-muted-foreground",
        ring: "stroke-muted-foreground",
        chip: "border-transparent bg-muted text-muted-foreground",
        wash: "from-foreground/8",
        border: "border-foreground/20",
    },
};
