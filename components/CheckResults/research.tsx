"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Telescope } from "lucide-react";
import {
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import {
    researchLinks,
    type ResearchCert,
    type ResearchLink,
    type ResearchResult,
    type UrlScanItem,
    type WaybackSnapshot,
} from "@/lib/ti/research";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PivotList, SectionHeading, useCopied } from "./primitives";
import type { ResearchStreamState } from "./use-research";

/** Open a URL in a new *background* tab, keeping the user on the result page.
 *  A synthetic modifier-click (Ctrl on Windows/Linux, Cmd on macOS) is the
 *  portable way to ask for a background tab — a plain click or window.open()
 *  foregrounds the new tab and yanks the user away from their place. Setting
 *  both modifiers lets the browser apply whichever matches the platform.
 *  Anchor-click navigation (not window.open) also sidesteps the popup blocker,
 *  so a whole section can open at once. */
function openInBackground(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.dispatchEvent(
        new MouseEvent("click", {
            ctrlKey: true,
            metaKey: true,
            bubbles: true,
            cancelable: true,
            view: window,
        }),
    );
    a.remove();
}

/** Intercept a plain left-click to open in the background, preserving the user's
 *  place; modified clicks / non-primary buttons keep native handling. */
function backgroundClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    url: string,
) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
    e.preventDefault();
    openInBackground(url);
}

/** Fan-out: open every link in a section at once, all in background tabs. */
function openAll(links: ResearchLink[]) {
    for (const link of links) openInBackground(link.url);
}

const CHIP =
    "group inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted focus-visible:border-foreground/40 focus-visible:bg-muted focus-visible:outline-none";

const SUBLABEL =
    "font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase";

/** ISO timestamp → YYYY-MM-DD; "—" for missing/sentinel (pre-1990) dates. */
function fmtDay(iso?: string): string {
    if (!iso || Number(iso.slice(0, 4)) <= 1990) return "—";
    return iso.slice(0, 10);
}

/** Host portion of a URL, for a compact caption. */
function hostOf(url: string): string {
    try {
        return new URL(url).host || url;
    } catch {
        return url;
    }
}

/** A grid of URLScan submission screenshots, each linking to its full scan. */
function UrlScanGrid({ scans }: { scans: UrlScanItem[] }) {
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {scans.map((s, i) => (
                <a
                    key={i}
                    href={s.scanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => backgroundClick(e, s.scanUrl)}
                    title={`${s.pageUrl} — open scan`}
                    className="group block overflow-hidden rounded-md border border-border bg-background transition-colors hover:border-foreground/40"
                >
                    <div className="aspect-[4/3] overflow-hidden bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={s.screenshot}
                            alt={`Screenshot of ${s.pageUrl}`}
                            loading="lazy"
                            className="size-full object-cover object-top grayscale-[0.15] transition group-hover:grayscale-0"
                            onError={(e) => {
                                e.currentTarget.style.visibility = "hidden";
                            }}
                        />
                    </div>
                    <div className="space-y-0.5 p-2">
                        <div
                            className="truncate font-mono text-[11px] text-foreground"
                            title={s.pageUrl}
                        >
                            {hostOf(s.pageUrl)}
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                            <span className="tabular-nums">{fmtDay(s.time)}</span>
                            {s.country && <span>{s.country}</span>}
                            {s.asn && <span className="truncate">{s.asn}</span>}
                        </div>
                    </div>
                </a>
            ))}
        </div>
    );
}

/** Wayback snapshots as a row of dated, deep-linked chips. */
function WaybackRow({ snapshots }: { snapshots: WaybackSnapshot[] }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {snapshots.map((s, i) => (
                <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => backgroundClick(e, s.url)}
                    className={CHIP}
                >
                    <span className="font-mono text-[12px] tabular-nums">
                        {fmtDay(s.time)}
                    </span>
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                </a>
            ))}
        </div>
    );
}

const CERT_PREVIEW = 5;

/** A compact crt.sh cert list (issuer + validity span), previewed with a toggle. */
function CertList({ certs }: { certs: ResearchCert[] }) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? certs : certs.slice(0, CERT_PREVIEW);
    return (
        <div className="space-y-1.5">
            {shown.map((c, i) => (
                <div
                    key={i}
                    className="flex items-baseline justify-between gap-3 text-[13px]"
                >
                    <span
                        className="min-w-0 truncate"
                        title={c.commonName ?? c.issuer}
                    >
                        {c.issuer}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {fmtDay(c.notBefore)} → {fmtDay(c.notAfter)}
                    </span>
                </div>
            ))}
            {certs.length > CERT_PREVIEW && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                    {expanded ? "show less" : `show all ${certs.length}`}
                </button>
            )}
        </div>
    );
}

/** One provider's result block: header (name, summary, outbound link) + body. */
function ProviderBlock({ result }: { result: ResearchResult }) {
    const { provider, status, summary, error, data, link } = result;

    let body: React.ReactNode = null;
    if (data?.type === "urlscan") {
        body = <UrlScanGrid scans={data.scans} />;
    } else if (data?.type === "wayback") {
        body =
            data.snapshots.length > 0 ? (
                <WaybackRow snapshots={data.snapshots} />
            ) : null;
    } else if (data?.type === "crtsh") {
        body = (
            <div className="space-y-3">
                {data.subdomains.length > 0 && (
                    <div className="space-y-1.5">
                        <div className={SUBLABEL}>
                            Subdomains{" "}
                            <span className="text-muted-foreground/60">
                                ({data.subdomains.length})
                            </span>
                        </div>
                        <PivotList values={data.subdomains} max={12} />
                    </div>
                )}
                {data.certs.length > 0 && <CertList certs={data.certs} />}
            </div>
        );
    }

    // Empty / failed runs still report, quietly, so the user knows the lane ran.
    const note =
        status === "ok"
            ? summary
            : status === "empty"
              ? (summary ?? "Nothing found")
              : status === "timeout"
                ? "Timed out"
                : (error ?? "Unavailable");

    return (
        <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-foreground">
                    {provider.name}
                </span>
                <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">
                        {note}
                    </span>
                    {link && (
                        <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => backgroundClick(e, link)}
                            title={`Open ${provider.name}`}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <ExternalLink className="size-3.5" />
                        </a>
                    )}
                </div>
            </div>
            {body}
        </div>
    );
}

/** A labeled placeholder for a provider whose result hasn't streamed in yet. */
function ProviderSkeleton({ name }: { name: string }) {
    return (
        <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-foreground">
                    {name}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                    loading…
                </span>
            </div>
            <div className="h-16 animate-pulse rounded bg-muted/40" />
        </div>
    );
}

/** The live, fetched portion of the Research card, rendered progressively from
 *  the stream: each provider shows a labeled skeleton until its result arrives,
 *  so a fast source (URLScan) appears immediately and a slow one (crt.sh) never
 *  blocks it. Renders nothing when there is no live lane for this IOC type
 *  (e.g. a bare hash) and no error. */
function LiveResearch({ research }: { research: ResearchStreamState }) {
    const { metas, results, loading, started, error } = research;
    const visible = metas.filter((m) => results[m.id]?.status !== "skipped");

    if (!loading && visible.length === 0 && !error) return null;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className={SUBLABEL}>Live intel</div>
                {loading && (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )}
            </div>

            {!started && loading ? (
                <div className="space-y-2">
                    {[0, 1].map((i) => (
                        <div
                            key={i}
                            className="h-20 animate-pulse rounded-md border border-foreground/10 bg-muted/30"
                        />
                    ))}
                </div>
            ) : (
                <>
                    {visible.map((m) => {
                        const r = results[m.id];
                        return r ? (
                            <ProviderBlock key={m.id} result={r} />
                        ) : (
                            <ProviderSkeleton key={m.id} name={m.name} />
                        );
                    })}
                    {error && visible.length === 0 && (
                        <p className="font-mono text-[12px] text-muted-foreground">
                            Live lookup unavailable.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

/** Outbound research panel: live free-API context (URLScan/Wayback/crt.sh)
 *  fetched and rendered inline, followed by one-click links that open each
 *  platform's search for this indicator in a new tab. A Copy control puts the
 *  indicator on the clipboard for platforms whose search can't be deep-linked
 *  (e.g. ANY.RUN). */
export function ResearchCard({
    result,
    research,
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
    research: ResearchStreamState;
}) {
    const [copied, copy] = useCopied();

    const { indicator, kind } = isHashResult(result)
        ? { indicator: result.hash, kind: "hash" as const }
        : isDomainResult(result)
          ? { indicator: result.domain, kind: "domain" as const }
          : { indicator: result.ip, kind: "ip" as const };

    const sections = researchLinks(indicator, kind);

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-5">
                <SectionHeading
                    icon={Telescope}
                    action={
                        <div className="flex min-w-0 items-center gap-1.5">
                            <code className="max-w-[150px] truncate font-mono text-[12px] text-muted-foreground sm:max-w-[260px]">
                                {indicator}
                            </code>
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                aria-label={`Copy ${kind}`}
                                className="gap-1.5 text-muted-foreground hover:text-foreground"
                                onClick={() => copy(indicator)}
                            >
                                {copied ? (
                                    <>
                                        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                                        Copied
                                    </>
                                ) : (
                                    <>
                                        <Copy className="size-3.5" />
                                        Copy
                                    </>
                                )}
                            </Button>
                        </div>
                    }
                >
                    Research
                </SectionHeading>

                <LiveResearch research={research} />

                {sections.map((section) => (
                    <div key={section.id} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className={SUBLABEL}>{section.label}</div>
                            {/* Best-effort: opens every chip in this group at once. */}
                            <button
                                type="button"
                                onClick={() => openAll(section.links)}
                                title={`Open all ${section.label.toLowerCase()} links`}
                                className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:outline-none"
                            >
                                Open all
                                <ExternalLink className="size-3" />
                            </button>
                        </div>
                        {/* Wrapping chips: small flat hit targets, a hover fill, and
                            a ↗ that brightens on hover so each reads as an outbound
                            link. Mirrors the Pivot chip idiom. */}
                        <div className="flex flex-wrap gap-1.5">
                            {section.links.map((link) => (
                                <a
                                    key={link.id}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Search ${link.name} for ${indicator}`}
                                    onClick={(e) => backgroundClick(e, link.url)}
                                    className={CHIP}
                                >
                                    {link.name}
                                    <ExternalLink className="size-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                                </a>
                            ))}
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
