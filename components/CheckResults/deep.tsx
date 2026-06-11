"use client";

import { useState } from "react";
import { FileText, Network } from "lucide-react";
import type {
    CertificateRecord,
    CheckResult,
    DomainCheckResult,
} from "@/lib/ti/types";
import { Card, CardContent } from "@/components/ui/card";
import { Pivot, PivotList, SectionHeading } from "./primitives";

/** ISO timestamp → YYYY-MM-DD (deterministic, locale-independent). */
function fmtDay(iso?: string): string {
    return iso ? iso.slice(0, 10) : "—";
}

const COLS = "grid grid-cols-[1fr_5.25rem_5.25rem_2.75rem] items-baseline gap-3";
const EXPANDER =
    "text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline";

const CERT_PREVIEW = 6;

function CertificateTable({ certs }: { certs: CertificateRecord[] }) {
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
                <div key={i} className={`${COLS} text-[13px]`}>
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
export function CertificatesCard({ result }: { result: DomainCheckResult }) {
    const certs = result.certificates ?? [];
    const subs = result.subdomains ?? [];
    if (certs.length === 0 && subs.length === 0) return null;

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading
                    icon={FileText}
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

/** Passive-DNS resolution history (IP + domain results). */
export function PassiveDnsCard({
    result,
}: {
    result: CheckResult | DomainCheckResult;
}) {
    const records = result.passiveDns ?? [];
    const [expanded, setExpanded] = useState(false);
    if (records.length === 0) return null;

    const shown = expanded ? records : records.slice(0, PDNS_PREVIEW);
    const isIp = records[0].type === "ip";
    const noun = isIp ? "IP address" : "hostname";

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading
                    icon={Network}
                    action={
                        <span className="font-mono text-xs text-muted-foreground">
                            {records.length} record
                            {records.length === 1 ? "" : "s"}
                        </span>
                    }
                >
                    Passive DNS
                </SectionHeading>

                <p className="text-sm text-muted-foreground">
                    {records.length} distinct {noun}
                    {records.length === 1 ? "" : "s"} observed in passive-DNS
                    history, most recent first.
                </p>

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
                        <div key={`${r.type}-${r.value}-${i}`} className={`${COLS} text-[13px]`}>
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
                </div>

                {records.length > PDNS_PREVIEW && (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className={EXPANDER}
                    >
                        {expanded ? "show less" : `show all ${records.length}`}
                    </button>
                )}
            </CardContent>
        </Card>
    );
}
