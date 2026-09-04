export function scoreBarColor(score: number): string {
    if (score >= 70) return "bg-red-500";
    if (score >= 40) return "bg-orange-500";
    if (score >= 15) return "bg-amber-500";
    return "bg-emerald-500";
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
