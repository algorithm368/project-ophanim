"use client";

import { useState } from "react";
import { preconnect } from "react-dom";
import {
    Check,
    Copy,
    Eye,
    ExternalLink,
    ImageOff,
    Loader2,
    Maximize2,
    Telescope,
} from "lucide-react";
import { ArchivePreview } from "@/components/ArchivePreview";
import { ImageInspector } from "@/components/ImageInspector";
import {
    type AnyCheckResult,
    isDomainResult,
    isHashResult,
} from "@/lib/ti/types";
import { isUrlResult, type UrlCheckResult } from "@/lib/ti/url/types";
import { parseUrl } from "@/lib/url";
import type { IOCType } from "@/lib/ioc";
import {
    archiveFrameUrl,
    researchLinks,
    researchMetasFor,
    type ResearchCert,
    type ResearchData,
    type ResearchLink,
    type ResearchResult,
    type ResearchStatus,
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

/** One screenshot tile: a shimmer while the image loads, a soft fade-in on
 *  success, and a labeled fallback when the scan produced no screenshot or the
 *  image fails to load, so a broken tile never collapses to a bare gray box.
 *  Loading is deferred and deprioritized (lazy + async decode + low fetch
 *  priority) so the grid never competes with the main result for bandwidth. */
function ScanThumb({ item }: Readonly<{ item: UrlScanItem }>) {
    // No screenshot URL at all → skip the request and show the fallback.
    const [status, setStatus] = useState<"loading" | "loaded" | "error">(
        item.screenshot ? "loading" : "error",
    );

    if (status === "error") {
        return (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground">
                <ImageOff className="size-5" aria-hidden />
                <span className="max-w-full truncate px-2 font-mono text-[10px]">
                    {hostOf(item.pageUrl)}
                </span>
            </div>
        );
    }

    return (
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
            {status === "loading" && <div className="sweep absolute inset-0" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={item.screenshot}
                alt={`Screenshot of ${item.pageUrl}`}
                width={400}
                height={300}
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                onLoad={() => setStatus("loaded")}
                onError={() => setStatus("error")}
                className={`size-full object-cover object-top grayscale-[0.15] transition duration-300 group-hover:grayscale-0 ${
                    status === "loaded" ? "opacity-100" : "opacity-0"
                }`}
            />
        </div>
    );
}

/** URLScan submissions as tidy rows: a small screenshot that opens full-screen
 *  on click, the page host + capture metadata, and an outbound link to the full
 *  scan. Compact so many scans read as an orderly list rather than a heavy grid. */
function UrlScanList({ scans }: Readonly<{ scans: UrlScanItem[] }>) {
    const [zoom, setZoom] = useState<UrlScanItem | null>(null);

    return (
        <>
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
                {scans.map((s) => (
                    <div
                        key={s.scanUrl}
                        className="flex items-center gap-3 bg-background p-2 transition-colors hover:bg-muted/30"
                    >
                        <button
                            type="button"
                            onClick={() => s.screenshot && setZoom(s)}
                            disabled={!s.screenshot}
                            aria-label={`View screenshot of ${s.pageUrl}`}
                            title={
                                s.screenshot ? "View screenshot" : "No screenshot"
                            }
                            className="group relative w-24 shrink-0 overflow-hidden rounded border border-border enabled:cursor-zoom-in"
                        >
                            <ScanThumb item={s} />
                            {s.screenshot && (
                                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-background opacity-0 transition group-hover:bg-foreground/30 group-hover:opacity-100">
                                    <Maximize2 className="size-4" />
                                </span>
                            )}
                        </button>
                        <div className="min-w-0 flex-1">
                            <div
                                className="truncate font-mono text-[12px] text-foreground"
                                title={s.pageUrl}
                            >
                                {hostOf(s.pageUrl)}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                                <span className="tabular-nums">
                                    {fmtDay(s.time)}
                                </span>
                                {s.country && <span>{s.country}</span>}
                                {s.asn && (
                                    <span className="truncate">{s.asn}</span>
                                )}
                            </div>
                        </div>
                        <a
                            href={s.scanUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => backgroundClick(e, s.scanUrl)}
                            title={`${s.pageUrl} — open scan`}
                            aria-label="Open scan"
                            className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <ExternalLink className="size-3.5" />
                        </a>
                    </div>
                ))}
            </div>
            {zoom?.screenshot && (
                <ImageInspector
                    src={zoom.screenshot}
                    alt={`Screenshot of ${zoom.pageUrl}`}
                    title={hostOf(zoom.pageUrl)}
                    subtitle={[fmtDay(zoom.time), zoom.country, zoom.asn]
                        .filter(Boolean)
                        .join(" · ")}
                    href={zoom.scanUrl}
                    hrefLabel="Open scan"
                    onClose={() => setZoom(null)}
                />
            )}
        </>
    );
}

/** Where every capture on this row is served from. */
const ARCHIVE_ORIGIN = "https://web.archive.org";

/** Captures already asked for, so hovering a chip twice costs one request. */
const warmedCaptures = new Set<string>();

/**
 * Ask for a capture during the pause before the click that needs it.
 *
 * Hovering a chip is a second or so of intent that was being thrown away, and
 * the archive spends most of a cold request finding the record rather than
 * sending it. So this pays off twice over: the browser may serve the frame from
 * cache, and the archive has the record in hand either way.
 *
 * `rel="prefetch"` rather than React's `preload`, which speaks `rel="preload"`
 * and needs an `as` this is not: the destination here is a document a frame
 * will navigate to, not a subresource of this page.
 */
function warmCapture(url: string | null) {
    if (!url || warmedCaptures.has(url)) return;
    warmedCaptures.add(url);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = url;
    document.head.append(link);
}

/**
 * Wayback snapshots as dated chips, each of which can be looked at here.
 *
 * The date opens the capture in place, because "what did this site look like in
 * March" is the question the chip exists to answer and a new tab at the archive
 * is a detour. The arrow still goes to the archive for the toolbar, the
 * calendar, and everything else the archive does better.
 */
function WaybackRow({ snapshots }: Readonly<{ snapshots: WaybackSnapshot[] }>) {
    const [preview, setPreview] = useState<WaybackSnapshot | null>(null);
    const frameUrl = preview ? archiveFrameUrl(preview.url) : null;

    // The first click on a chip was paying for DNS and a TLS handshake before
    // the archive had even been asked for anything. Settle that while the row
    // is being read instead.
    preconnect(ARCHIVE_ORIGIN);

    return (
        <>
            <div className="flex flex-wrap gap-1.5">
                {snapshots.map((s) => (
                    <span
                        key={s.url}
                        // Both the pointer and the keyboard announce a chip
                        // before they commit to it, and either is early enough
                        // to be worth acting on.
                        onPointerEnter={() => warmCapture(archiveFrameUrl(s.url))}
                        onFocus={() => warmCapture(archiveFrameUrl(s.url))}
                        className="group inline-flex items-stretch overflow-hidden rounded-md border border-border bg-muted/40 transition-colors hover:border-foreground/40"
                    >
                        <button
                            type="button"
                            onClick={() => setPreview(s)}
                            title={`View this capture, ${fmtDay(s.time)}`}
                            aria-label={`View the ${fmtDay(s.time)} capture`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        >
                            <Eye className="size-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                            <span className="font-mono text-[12px] tabular-nums">
                                {fmtDay(s.time)}
                            </span>
                        </button>
                        <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => backgroundClick(e, s.url)}
                            title="Open at the Wayback Machine"
                            aria-label={`Open the ${fmtDay(s.time)} capture at the Wayback Machine`}
                            className="inline-flex items-center border-l border-border px-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
                        >
                            <ExternalLink className="size-3" />
                        </a>
                    </span>
                ))}
            </div>
            {preview && frameUrl && (
                <ArchivePreview
                    frameUrl={frameUrl}
                    playbackUrl={preview.url}
                    title={hostOf(preview.url.replace(/^.*?\/web\/\d+\//, ""))}
                    subtitle={`archived ${fmtDay(preview.time)}`}
                    onClose={() => setPreview(null)}
                />
            )}
        </>
    );
}

const CERT_PREVIEW = 5;

/** A compact crt.sh cert list (issuer + validity span), previewed with a toggle. */
function CertList({ certs }: Readonly<{ certs: ResearchCert[] }>) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? certs : certs.slice(0, CERT_PREVIEW);
    return (
        <div className="space-y-1.5">
            {shown.map((c) => (
                <div
                    key={`${c.issuer}-${c.notBefore}-${c.commonName ?? ""}`}
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

/**
 * The frame every provider sits in, whether it is loading, empty, or full.
 *
 * One frame and one body height, because these blocks arrive seconds apart: a
 * lane that shrinks when it lands and grows when the next one starts moves the
 * card under the reader's cursor. A slot that never changes size means the only
 * thing that changes is the content.
 */
function ProviderShell({
    name,
    note,
    loading,
    link,
    children,
}: Readonly<{
    name: React.ReactNode;
    note: React.ReactNode;
    loading?: boolean;
    link?: string;
    children: React.ReactNode;
}>) {
    return (
        <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-foreground">
                    {name}
                </span>
                <div className="flex items-center gap-2">
                    {loading && (
                        <Loader2
                            className="size-3 animate-spin text-muted-foreground"
                            aria-hidden
                        />
                    )}
                    <span className="font-mono text-[11px] text-muted-foreground">
                        {note}
                    </span>
                    {link && (
                        <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => backgroundClick(e, link)}
                            title="Open provider"
                            className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <ExternalLink className="size-3.5" />
                        </a>
                    )}
                </div>
            </div>
            <div className="min-h-16">{children}</div>
        </div>
    );
}

/** What a lane found, rendered per provider. Null when there is nothing to draw,
 *  which the block turns into a sentence rather than a gap. */
function ProviderBody({ data }: Readonly<{ data: ResearchData }>) {
    if (data.type === "urlscan") return <UrlScanList scans={data.scans} />;
    if (data.type === "wayback") {
        return data.snapshots.length > 0 ? (
            <WaybackRow snapshots={data.snapshots} />
        ) : null;
    }
    if (data.certs.length === 0 && data.subdomains.length === 0) return null;
    return (
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

/** The header note: what the lane says about itself in one phrase. Empty and
 *  failed runs still report, quietly, so the user knows the lane ran. */
function noteFor(result: ResearchResult): string {
    const { status, summary, error } = result;
    if (status === "ok") return summary ?? "";
    if (status === "empty") return summary ?? "Nothing found";
    if (status === "timeout") return "Timed out";
    return error ?? "Unavailable";
}

/** What an empty body says. A lane that found nothing has to say so: left blank
 *  it looks identical to a lane still loading, and the two mean opposite
 *  things. */
const BLANK_BODY: Partial<Record<ResearchStatus, string>> = {
    empty: "Nothing on record here.",
    timeout: "The source did not answer in time, so nothing is known from it.",
    error: "The source could not be read, which is not the same as it being empty.",
};

/** One provider's result block: header (name, summary, outbound link) + body. */
function ProviderBlock({ result }: Readonly<{ result: ResearchResult }>) {
    const { provider, status, data, link } = result;
    const body = data ? <ProviderBody data={data} /> : null;

    return (
        <ProviderShell name={provider.name} note={noteFor(result)} link={link}>
            {body ?? (
                <p className="flex h-16 items-center text-[13px] text-muted-foreground">
                    {BLANK_BODY[status] ?? "Nothing to show."}
                </p>
            )}
        </ProviderShell>
    );
}

/** A provider that has not answered yet: the same frame, with the wait shown
 *  rather than implied. */
function ProviderSkeleton({ name }: Readonly<{ name?: string }>) {
    return (
        <ProviderShell
            name={
                name ?? (
                    <span className="sweep inline-block h-3 w-24 rounded align-middle" />
                )
            }
            note="loading…"
            loading
        >
            <div className="flex h-16 flex-col justify-center gap-2">
                {["w-full", "w-4/5", "w-2/3"].map((w) => (
                    <span key={w} className={`sweep block h-2.5 rounded ${w}`} />
                ))}
            </div>
        </ProviderShell>
    );
}

/** The live, fetched portion of the Research card, rendered progressively from
 *  the stream: each provider shows a labeled skeleton until its result arrives,
 *  so a fast source (URLScan) appears immediately and a slow one (crt.sh) never
 *  blocks it. Renders nothing when there is no live lane for this IOC type
 *  (e.g. a bare hash) and no error. */
function LiveResearch({
    research,
    kind,
}: Readonly<{ research: ResearchStreamState; kind: IOCType }>) {
    const { metas, results, loading, started, error } = research;
    // Which providers will run is a static property of the registry, so the
    // wait before the stream's start event is named rather than a grey box, and
    // an IOC type with no live lane shows nothing instead of flashing one.
    const expected = started ? metas : researchMetasFor(kind);
    const visible = expected.filter((m) => results[m.id]?.status !== "skipped");

    if (!loading && visible.length === 0 && !error) return null;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className={SUBLABEL}>Live intel</div>
                {loading && (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )}
            </div>

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
        </div>
    );
}

/**
 * What this result researches, and as what kind.
 *
 * A URL researches its host as a domain: no provider supports a url kind, and
 * this keeps the card's header and links agreeing with the stream the page
 * actually requested. URL is checked first because it is the most specific
 * shape and the other guards would not recognize it.
 */
function researchTarget(result: AnyCheckResult | UrlCheckResult): {
    indicator: string;
    kind: IOCType;
} {
    if (isUrlResult(result)) {
        return {
            indicator: parseUrl(result.url)?.host ?? result.url,
            kind: "domain",
        };
    }
    if (isHashResult(result)) return { indicator: result.hash, kind: "hash" };
    if (isDomainResult(result)) {
        return { indicator: result.domain, kind: "domain" };
    }
    return { indicator: result.ip, kind: "ip" };
}

/** Outbound research panel: live free-API context (URLScan/Wayback/crt.sh)
 *  fetched and rendered inline, followed by one-click links that open each
 *  platform's search for this indicator in a new tab. A Copy control puts the
 *  indicator on the clipboard for platforms whose search can't be deep-linked
 *  (e.g. ANY.RUN). */
export function ResearchCard({
    result,
    research,
    streaming = false,
}: Readonly<{
    result: AnyCheckResult | UrlCheckResult | null;
    research: ResearchStreamState;
    /** Set while the panel is still answering (IP path only, so far). Domain,
     *  hash and URL call sites don't pass this yet and keep their prior
     *  all-or-nothing render, hence the default. There is no indicator/kind to
     *  research until `result` lands, so streaming renders a plain skeleton
     *  rather than the live-research lane. */
    streaming?: boolean;
}>) {
    const [copied, copy] = useCopied();

    if (streaming || !result) {
        return (
            <Card className="sketch-shadow rounded-lg border border-foreground/12">
                <CardContent className="space-y-5">
                    <SectionHeading icon={Telescope}>Research</SectionHeading>
                    <div className="space-y-2">
                        <span className="sweep block h-3 w-24 rounded" />
                        <div className="flex flex-wrap gap-1.5">
                            {["w-20", "w-24", "w-16", "w-28"].map((w) => (
                                <span
                                    key={w}
                                    className={`sweep block h-7 rounded-md ${w}`}
                                />
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const { indicator, kind } = researchTarget(result);

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

                <LiveResearch research={research} kind={kind} />

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
