"use client";

import { useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import { ExternalLink, ImageOff, Loader2, Maximize2 } from "lucide-react";
import { ArchivePreview } from "@/components/ArchivePreview";
import { ImageInspector } from "@/components/ImageInspector";
import {
    type AnyCheckResult,
    isDomainResult,
    isHashResult,
} from "@/lib/ti/types";
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
import { cn } from "@/lib/utils";
import { Tile } from "./frame";

import type { ResearchStreamState } from "./use-research";

/**
 * Outbound research, in the bestiary panel's own idiom.
 *
 * Rules this file exists to hold, all of them borrowed from `panel.tsx` and
 * `identity.tsx` so the three cards read as one document:
 *
 *  - Full-bleed sections divided by a rule, never padded boxes inside a padded
 *    card. The card itself carries no padding; each section carries its own.
 *  - Labels are small caps mono, values are mono. Nothing is a chip or a pill:
 *    a rounded fill claims to be a control of its own weight, and twelve of
 *    them in a row claim twelve times as much attention as the section deserves.
 *  - Colour belongs to the sprite and the verdict. Not to a copy confirmation.
 */

/** The small caps label used for every heading below the section title. */
const CAPS = "font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase";

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
function backgroundClick(e: React.MouseEvent<HTMLAnchorElement>, url: string) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openInBackground(url);
}

/** Fan-out: open every link in a section at once, all in background tabs. */
function openAll(links: ResearchLink[]) {
    for (const link of links) openInBackground(link.url);
}

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

/** The strip's tile: 96px wide, 16:9, the size both capture lanes share. */
const TILE = "aspect-video w-24 shrink-0";

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
            <div className="flex aspect-video flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground">
                <ImageOff className="size-5" aria-hidden />
                <span className="max-w-full truncate px-2 font-mono text-[10px]">
                    {hostOf(item.pageUrl)}
                </span>
            </div>
        );
    }

    return (
        <div className="relative aspect-video overflow-hidden bg-muted">
            {status === "loading" && <div className="sweep absolute inset-0" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={item.screenshot}
                alt={`Screenshot of ${item.pageUrl}`}
                width={400}
                height={225}
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

/** The hover veil both strips share: a magnifier over a dimmed tile. */
function ZoomVeil() {
    return (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-background opacity-0 transition group-hover:bg-foreground/30 group-hover:opacity-100">
            <Maximize2 className="size-4" />
        </span>
    );
}

/** URLScan submissions as a thumbnail strip: small screenshots side by side,
 *  wrapping onto further rows only once the strip runs out of width, rather
 *  than each scan claiming its own line going down the card. A scan with no
 *  screenshot falls back to a small dated chip linking straight to the scan,
 *  so it still occupies its slot in the strip. Click a thumbnail for the full
 *  screenshot, host, capture date, and a link to the scan itself. */
function UrlScanList({ scans }: Readonly<{ scans: UrlScanItem[] }>) {
    const [zoom, setZoom] = useState<UrlScanItem | null>(null);

    return (
        <>
            <div className="flex flex-wrap gap-1.5">
                {scans.map((s) =>
                    s.screenshot ? (
                        <button
                            key={s.scanUrl}
                            type="button"
                            onClick={() => setZoom(s)}
                            aria-label={`View screenshot of ${s.pageUrl}`}
                            title={`${hostOf(s.pageUrl)}, ${fmtDay(s.time)}`}
                            className={cn(
                                TILE,
                                "group relative cursor-zoom-in overflow-hidden border border-foreground/12",
                            )}
                        >
                            <ScanThumb item={s} />
                            <ZoomVeil />
                        </button>
                    ) : (
                        <a
                            key={s.scanUrl}
                            href={s.scanUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => backgroundClick(e, s.scanUrl)}
                            title={`${s.pageUrl} — open scan`}
                            className={cn(
                                TILE,
                                "flex flex-col items-center justify-center gap-1 border border-foreground/12 bg-muted px-1 text-center text-muted-foreground transition-colors hover:border-foreground/40",
                            )}
                        >
                            <span className="max-w-full truncate font-mono text-[10px]">
                                {hostOf(s.pageUrl)}
                            </span>
                            <span className="font-mono text-[10px] tabular-nums">
                                {fmtDay(s.time)}
                            </span>
                        </a>
                    ),
                )}
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

/**
 * The viewport each capture is laid out at before it is scaled into its tile.
 *
 * 640px rather than a desktop width on purpose: a site that still has a
 * responsive stylesheet serves its narrow layout there, which is one column of
 * large type and survives being shrunk by a factor of six. The same page laid
 * out at 1280 shrinks into grey noise.
 */
const FRAME_W = 640;
const FRAME_H = 360;
/** 96px of tile over 640px of page. Keeps the strip the same size as URLScan's. */
const FRAME_SCALE = 0.15;

/** How long each tile waits behind the one before it. The archive is replaying a
 *  whole page per frame, and eight at once is how a strip of captures turns into
 *  eight timeouts. */
const STAGGER_MS = 450;

/** True once `ref` has been anywhere near the viewport. Latches, because a strip
 *  that has started fetching should not restart when it scrolls back off. */
function useSeen(ref: React.RefObject<HTMLElement | null>): boolean {
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || seen) return;
        const io = new IntersectionObserver(
            (entries) => entries.some((e) => e.isIntersecting) && setSeen(true),
            { rootMargin: "300px" },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [ref, seen]);
    return seen;
}

/**
 * One archived capture as a thumbnail.
 *
 * The archive keeps no screenshots, so the only picture of a capture is the
 * capture itself: a sandboxed frame with scripts off, laid out at a narrow
 * viewport and scaled down to tile size. Scripts off is not only a safety
 * measure here, it is why this is affordable at all, and it means a page built
 * entirely in JavaScript shows as whatever it serves without one. The date under
 * the tile is what identifies it either way.
 */
function ArchiveThumb({
    snapshot,
    index,
    start,
    onOpen,
}: Readonly<{
    snapshot: WaybackSnapshot;
    index: number;
    /** Held false until the strip is near the viewport, so a card the reader
     *  never scrolls to never asks the archive for anything. */
    start: boolean;
    onOpen: () => void;
}>) {
    const frameUrl = archiveFrameUrl(snapshot.url);
    const [armed, setArmed] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const day = fmtDay(snapshot.time);

    useEffect(() => {
        if (!start || armed) return;
        const id = setTimeout(() => setArmed(true), index * STAGGER_MS);
        return () => clearTimeout(id);
    }, [start, armed, index]);

    return (
        <button
            type="button"
            onClick={onOpen}
            title={`View this capture, ${day}`}
            aria-label={`View the ${day} capture`}
            className="group w-24 shrink-0 cursor-zoom-in"
        >
            <span
                className={cn(
                    TILE,
                    "relative block overflow-hidden border border-foreground/12 bg-muted",
                )}
            >
                {!loaded && <span className="sweep absolute inset-0 block" />}
                {armed && frameUrl && (
                    <iframe
                        // sandbox="" is the whole point: no scripts, no forms,
                        // no popups, no navigation, no same-origin access.
                        sandbox=""
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        src={frameUrl}
                        onLoad={() => setLoaded(true)}
                        title={`Capture of ${day}`}
                        tabIndex={-1}
                        aria-hidden
                        style={{
                            width: FRAME_W,
                            height: FRAME_H,
                            transform: `scale(${FRAME_SCALE})`,
                            transformOrigin: "top left",
                        }}
                        className={cn(
                            "pointer-events-none absolute top-0 left-0 border-0 bg-white grayscale-[0.15] transition duration-300 group-hover:grayscale-0",
                            loaded ? "opacity-100" : "opacity-0",
                        )}
                    />
                )}
                <ZoomVeil />
            </span>
            <span className="mt-1 block text-center font-mono text-[10px] tabular-nums text-muted-foreground">
                {day}
            </span>
        </button>
    );
}

/**
 * Wayback captures as the same thumbnail strip URLScan gets.
 *
 * Dated chips said when a capture exists; a strip says what was there, which is
 * the question the row is asked. Clicking one opens it full size, where the
 * archive's own toolbar and calendar are one link away.
 */
function WaybackRow({ snapshots }: Readonly<{ snapshots: WaybackSnapshot[] }>) {
    const [preview, setPreview] = useState<WaybackSnapshot | null>(null);
    const strip = useRef<HTMLDivElement>(null);
    const seen = useSeen(strip);
    const frameUrl = preview ? archiveFrameUrl(preview.url) : null;

    // The first frame was paying for DNS and a TLS handshake before the archive
    // had been asked for anything. Settle that while the row is being read.
    preconnect(ARCHIVE_ORIGIN);

    return (
        <>
            <div ref={strip} className="flex flex-wrap gap-1.5">
                {snapshots.map((s, i) => (
                    <ArchiveThumb
                        key={s.url}
                        snapshot={s}
                        index={i}
                        start={seen}
                        onOpen={() => setPreview(s)}
                    />
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
        <div>
            {shown.map((c, i) => (
                <div
                    key={`${c.issuer}-${c.notBefore}-${c.commonName ?? ""}-${i}`}
                    className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-b border-foreground/8 py-1 last:border-b-0"
                >
                    <span
                        className="min-w-0 truncate font-mono text-[11.5px]"
                        title={c.commonName ?? c.issuer}
                    >
                        {c.issuer}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                        {fmtDay(c.notBefore)} → {fmtDay(c.notAfter)}
                    </span>
                </div>
            ))}
            {certs.length > CERT_PREVIEW && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className={cn(CAPS, "mt-2 transition-colors hover:text-foreground")}
                >
                    {expanded ? "Show less" : `Show all ${certs.length}`}
                </button>
            )}
        </div>
    );
}

/**
 * The frame every provider sits in, whether it is loading, empty, or full.
 *
 * A ledger row rather than a stacked block: the provider's name and what it
 * says about itself sit in the same 8.5rem label column the subject record
 * uses, so the two cards line up down the page. One body height, because these
 * lanes arrive seconds apart and a slot that grows when the next one starts
 * moves the card under the reader's cursor.
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
        <div className="grid grid-cols-[8.5rem_1fr] items-start gap-x-4 border-b border-foreground/12 py-3 last:border-b-0">
            <div className="min-w-0">
                <div className="font-mono text-[11.5px] font-bold tracking-[0.06em] uppercase">
                    {name}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] text-muted-foreground">
                    {loading && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
                    <span className="min-w-0 truncate">{note}</span>
                    {link && (
                        <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => backgroundClick(e, link)}
                            title="Open provider"
                            className="shrink-0 transition-colors hover:text-foreground"
                        >
                            <ExternalLink className="size-3" />
                        </a>
                    )}
                </div>
            </div>
            <div className="min-w-0 min-h-14">{children}</div>
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
    // Only the certificates. The names this lane also returns have their own
    // tile in the frame, which prints all of them against the apex rather than
    // a capped dozen in a column this wide.
    if (data.certs.length === 0) return null;
    return <CertList certs={data.certs} />;
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
                <p className="flex h-14 items-center font-mono text-[11.5px] text-muted-foreground">
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
            name={name ?? <span className="sweep inline-block h-3 w-20 rounded align-middle" />}
            note="loading…"
            loading
        >
            <div className="flex h-14 flex-col justify-center gap-2">
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
export function LiveIntelTile({
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
        <Tile
            span={5}
            id="research"
            title="Live intel"
            note={
                loading ? (
                    <Loader2 className="size-3 animate-spin" />
                ) : (
                    `${visible.length} ${visible.length === 1 ? "lane" : "lanes"}`
                )
            }
        >
            {visible.map((m) => {
                const r = results[m.id];
                return r ? (
                    <ProviderBlock key={m.id} result={r} />
                ) : (
                    <ProviderSkeleton key={m.id} name={m.name} />
                );
            })}
            {error && visible.length === 0 && (
                <p className="font-mono text-[11.5px] text-muted-foreground">
                    Live lookup unavailable.
                </p>
            )}
        </Tile>
    );
}

/**
 * Where else to look, three groups side by side.
 *
 * Side by side rather than stacked, the way the evidence section halves its
 * detectors: twelve destinations are four rows tall instead of nine, so the
 * block reads as a directory under the live lanes rather than as the bulk of
 * the card.
 */
export function LinksTile({
    indicator,
    kind,
    span = 7,
}: Readonly<{ indicator: string; kind: IOCType; span?: 7 | 12 }>) {
    const sections = researchLinks(indicator, kind);
    const total = sections.reduce((n, s) => n + s.links.length, 0);
    return (
        <Tile span={span} title="Look elsewhere" note={`${total} destinations`}>
            <div className="grid gap-x-10 md:grid-cols-3">
                {sections.map((section) => (
                    <div key={section.id}>
                        <div className="mb-1 flex items-baseline justify-between gap-3">
                            <span className={CAPS}>{section.label}</span>
                            {/* Best-effort: opens every link in this group at once. */}
                            <button
                                type="button"
                                onClick={() => openAll(section.links)}
                                title={`Open all ${section.label.toLowerCase()} links`}
                                className={cn(
                                    CAPS,
                                    "inline-flex shrink-0 items-center gap-1 transition-colors hover:text-foreground",
                                )}
                            >
                                All
                                <ExternalLink className="size-2.5" />
                            </button>
                        </div>
                        {section.links.map((link) => (
                            <a
                                key={link.id}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Search ${link.name} for ${indicator}`}
                                onClick={(e) => backgroundClick(e, link.url)}
                                className="group grid grid-cols-[1fr_auto] items-center gap-3 border-b border-foreground/12 py-1.5 transition-colors last:border-b-0 hover:border-foreground/40"
                            >
                                <span className="truncate font-mono text-[11.5px]">
                                    {link.name}
                                </span>
                                <ExternalLink className="size-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                            </a>
                        ))}
                    </div>
                ))}
            </div>
        </Tile>
    );
}

/**
 * What this result researches, and as what kind.
 */
export function researchTarget(result: AnyCheckResult): {
    indicator: string;
    kind: IOCType;
} {
    if (isHashResult(result)) return { indicator: result.hash, kind: "hash" };
    if (isDomainResult(result)) {
        return { indicator: result.domain, kind: "domain" };
    }
    return { indicator: result.ip, kind: "ip" };
}
