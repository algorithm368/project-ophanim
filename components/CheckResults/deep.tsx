"use client";

import { memo, useState } from "react";
import type {
    CertificateRecord,
    CheckResult,
    DomainCheckResult,
} from "@/lib/ti/types";
import { Card, CardContent } from "@/components/ui/card";
import { Pivot, PivotList, SectionHeading } from "./primitives";

/** A source returns the epoch (1970) as a sentinel when it has no real
 *  first/last-seen date. Treat anything before 1990 (and missing values) as no
 *  date, so those rows show "—" rather than a misleading 1970-01-01. */
function isRealDate(iso?: string): boolean {
    return !!iso && Number(iso.slice(0, 4)) > 1990;
}

/** ISO timestamp → YYYY-MM-DD (deterministic, locale-independent). */
function fmtDay(iso?: string): string {
    return isRealDate(iso) ? iso!.slice(0, 10) : "—";
}

const COLS = "grid grid-cols-[1fr_5.25rem_5.25rem_2.75rem] items-baseline gap-3";
const EXPANDER =
    "text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline";

const CERT_PREVIEW = 6;

function CertificateTable({ certs }: Readonly<{ certs: CertificateRecord[] }>) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? certs : certs.slice(0, CERT_PREVIEW);
    return (
        <div className="space-y-1.5">
            <div
                className={`${COLS} border-b border-border pb-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase`}
            >
                <span>Issuer</span>
                <span>First seen</span>
                <span>Expires</span>
                <span className="text-right">SANs</span>
            </div>
            {shown.map((c, i) => (
                // No field on a certificate record is guaranteed unique, so the
                // key is the identifying fields plus the position, the same
                // shape the resolutions table below uses.
                <div
                    key={`${c.issuer}-${c.commonName ?? ""}-${c.firstSeen ?? ""}-${i}`}
                    className={`${COLS} text-[13px]`}
                >
                    <span className="truncate" title={c.commonName ?? c.issuer}>
                        {c.issuer}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtDay(c.firstSeen)}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtDay(c.notAfter)}
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">
                        {c.sans.length}
                    </span>
                </div>
            ))}
            {certs.length > CERT_PREVIEW && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className={EXPANDER}
                >
                    {expanded ? "show less" : `show all ${certs.length}`}
                </button>
            )}
        </div>
    );
}

/** Certificate transparency + derived subdomains (domain results, crt.sh). */
export function CertificatesCard({
    result,
    streaming = false,
}: Readonly<{
    result: DomainCheckResult | null;
    /** Set while the panel is still answering. Renders nothing at all, not a
     *  skeleton: this card hides itself when the domain has no certificates,
     *  and a placeholder that later vanishes drags the whole page up. See the
     *  note on PassiveDnsCard. */
    streaming?: boolean;
}>) {
    if (streaming) return null;
    if (!result) return null;
    const certs = result.certificates ?? [];
    const subs = result.subdomains ?? [];
    if (certs.length === 0 && subs.length === 0) return null;

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading
                    action={
                        <span className="font-mono text-xs text-muted-foreground">
                            Cert Spotter · {certs.length} cert
                            {certs.length === 1 ? "" : "s"}
                        </span>
                    }
                >
                    Certificate transparency
                </SectionHeading>

                {certs.length > 0 && <CertificateTable certs={certs} />}

                {subs.length > 0 && (
                    <div className="space-y-2 border-t border-border pt-3">
                        <div className="font-mono text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                            Subdomains{" "}
                            <span className="text-muted-foreground/60">
                                ({subs.length})
                            </span>
                        </div>
                        <PivotList values={subs} max={12} />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

const PDNS_PREVIEW = 8;

/** Passive-DNS resolution history (IP + domain results). When the source gives
 *  real first/last-seen dates the timeline is worth a table; when it doesn't
 *  (common — the dates come back as the epoch) the records are just pivotable
 *  indicators, so a compact chip grid reads far easier than a tall table of
 *  "—" columns. */
export const PassiveDnsCard = memo(function PassiveDnsCard({
    result,
    streaming = false,
}: Readonly<{
    result: CheckResult | DomainCheckResult | null;
    /** Set while the panel is still answering.
     *
     *  Renders nothing while streaming, deliberately. A card that hides itself
     *  when it has no content cannot hold a place with a skeleton: with no
     *  passive-DNS key configured, every IP lookup drew this skeleton for
     *  twenty seconds and then removed it, collapsing the card's height,
     *  dragging everything below it upward and pruning its icon from the rail,
     *  which is exactly the reflow the streaming work exists to remove. It
     *  appears when it has records and never disappears. Growth below the fold
     *  as a card arrives is the acceptable half of that trade. */
    streaming?: boolean;
}>) {
    const [expanded, setExpanded] = useState(false);
    if (streaming) return null;
    if (!result) return null;
    const records = result.passiveDns ?? [];
    if (records.length === 0) return null;

    // Records are IP addresses when a domain's resolution history is shown, and
    // hostnames when an IP's is. Pluralize the two-word noun by hand.
    const isIp = records[0].type === "ip";
    const nounPlural = isIp ? "IP addresses" : "hostnames";
    const noun = isIp ? "IP address" : "hostname";
    const subject = isIp
        ? "IP addresses this domain has resolved to over time"
        : "Hostnames seen resolving to this IP over time";
    const hasDates = records.some(
        (r) => isRealDate(r.firstSeen) || isRealDate(r.lastSeen),
    );

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading
                    action={
                        <span className="font-mono text-xs text-muted-foreground">
                            {records.length}{" "}
                            {records.length === 1 ? noun : nounPlural}
                        </span>
                    }
                >
                    Passive DNS
                </SectionHeading>

                <p className="text-sm text-muted-foreground">
                    {subject}
                    {hasDates ? ", most recent first." : "."}
                </p>

                {hasDates ? (
                    <PassiveDnsTable
                        records={records}
                        isIp={isIp}
                        expanded={expanded}
                        onToggle={() => setExpanded((v) => !v)}
                    />
                ) : (
                    <PivotList
                        values={records.map((r) => r.value)}
                        max={PDNS_PREVIEW}
                    />
                )}
            </CardContent>
        </Card>
    );
});

/** The dated form: a resolution timeline ordered most-recent-first, previewed
 *  to PDNS_PREVIEW rows with a show-all toggle. */
function PassiveDnsTable({
    records,
    isIp,
    expanded,
    onToggle,
}: Readonly<{
    records: NonNullable<CheckResult["passiveDns"]>;
    isIp: boolean;
    expanded: boolean;
    onToggle: () => void;
}>) {
    const shown = expanded ? records : records.slice(0, PDNS_PREVIEW);
    return (
        <div className="space-y-1.5">
            <div
                className={`${COLS} border-b border-border pb-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase`}
            >
                <span>{isIp ? "IP address" : "Hostname"}</span>
                <span>First seen</span>
                <span>Last seen</span>
                <span className="text-right">Type</span>
            </div>
            {shown.map((r, i) => (
                <div
                    key={`${r.type}-${r.value}-${i}`}
                    className={`${COLS} text-[13px]`}
                >
                    <span className="min-w-0 truncate">
                        <Pivot value={r.value} />
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtDay(r.firstSeen)}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtDay(r.lastSeen)}
                    </span>
                    <span className="text-right font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                        {r.recordType ?? "—"}
                    </span>
                </div>
            ))}
            {records.length > PDNS_PREVIEW && (
                <button type="button" onClick={onToggle} className={EXPANDER}>
                    {expanded ? "show less" : `show all ${records.length}`}
                </button>
            )}
        </div>
    );
}
