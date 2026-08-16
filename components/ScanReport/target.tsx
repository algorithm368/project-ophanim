"use client";

import { useState } from "react";
import { ExternalLink, Maximize2 } from "lucide-react";
import { ImageInspector } from "@/components/ImageInspector";
import { buildScanNarrative, formatDate, midSentence } from "@/lib/ti/narrative";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import { attribution, type MergedScan } from "@/lib/ti/url/active/merge";
import type { ScanDetail } from "@/lib/ti/url/active/detail";
import type { ActiveScan } from "@/lib/ti/url/active/types";
import { CopyableSummary } from "@/components/CheckResults/primitives";

/**
 * A claim with the scanner that made it, so it can be defended in a ticket.
 *
 * Full width on a phone, so it takes its own line rather than squeezing a long
 * URL into a one-character-per-line column; inline from `sm` up, where the
 * design puts it on the right of the row.
 */
function Attributed({ engines }: Readonly<{ engines: string[] }>) {
  if (engines.length === 0) return null;
  return (
    <span className="w-full shrink-0 font-mono text-[10px] tracking-[0.1em] text-foreground/40 uppercase sm:w-auto">
      {engines.join(" + ")}
    </span>
  );
}

/**
 * One row of the decisive strip.
 *
 * A row with nothing behind it still renders, saying so. Vanishing would let an
 * unanswered question read as an answered one.
 */
function Row({
  label,
  value,
  engines = [],
  tone,
  missing = "not reported",
}: Readonly<{
  label: string;
  value?: string;
  engines?: string[];
  tone?: string;
  /** What the row says with nothing behind it, when "not reported" would be
   *  the wrong reason for the blank. */
  missing?: string;
}>) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-foreground/[0.06] py-2 last:border-b-0">
      <span className="w-28 shrink-0 text-[13px] text-muted-foreground">
        {label}
      </span>
      {/* break-words, because the value is often a URL with no space in it and
          would otherwise overflow the cell and run under the attribution. */}
      <span
        className={`min-w-0 flex-1 basis-48 text-sm break-words ${value ? (tone ?? "text-foreground") : "text-foreground/45"}`}
      >
        {value ?? missing}
      </span>
      <Attributed engines={engines} />
    </div>
  );
}

/** Engine names for a field, ready to print. */
function by(scans: ActiveScan[], key: keyof ScanDetail): string[] {
  return attribution(scans, key).map((e) => ENGINE_NAME[e]);
}

/** End a fact with one full stop. Registrar names routinely end in "Inc.", and
 *  appending blindly gives "MarkMonitor Inc..". */
function stop(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/** "2 IPs" / "1 IP", so a count never reads as a mislabelled plural. */
function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/** A collapsed evidence section. The count lives in the summary, so a closed
 *  section still tells the truth about what it holds. */
function Evidence({
  title,
  detail,
  children,
}: Readonly<{ title: string; detail: string; children: React.ReactNode }>) {
  return (
    <details className="group border-b border-foreground/10 py-2 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 text-sm">
        <span className="text-foreground/45 transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </summary>
      <div className="mt-2 pl-5 text-xs break-words text-foreground/75">
        {children}
      </div>
    </details>
  );
}

/**
 * Everything one scanned URL turned into, in the order the design puts it:
 * the paragraph first, then the five decisive rows, then who said what, then
 * the evidence, then what nobody collected.
 */
export function TargetReport({
  merged,
  scans,
  passive,
}: Readonly<{
  merged: MergedScan;
  scans: ActiveScan[];
  passive: React.ReactNode;
}>) {
  const d = merged.detail;
  const cap = merged.capability;
  const narrative = buildScanNarrative(merged).join(" ");
  const [inspecting, setInspecting] = useState<string | null>(null);

  // Only a urlscan screenshot is a public file. Cloudflare's is an
  // authenticated API endpoint and an <img> pointed at it renders broken.
  const shot = scans.find((s) =>
    s.verdict?.screenshot?.startsWith("https://urlscan.io/"),
  );

  const hops = d.redirects?.length ?? 0;
  const brands = d.verdicts.overall.brands ?? [];
  const crossDomain = cap.forms.filter((f) => f.crossDomain && f.host);

  // Only an engine whose DOM was actually read backs the "asks for" row. One
  // that finished the scan but was refused the DOM contributed nothing to it,
  // and crediting it would put a name behind a claim it never made.
  const domEngines = scans
    .filter((s) => s.capability && !s.capability.error)
    .map((s) => ENGINE_NAME[s.engine]);

  // What the page asks for, strictly as seen in the captured DOM. Finding
  // nothing is a result and says so; failing to look is not, and says that
  // instead. A kit can build its form after a click or hide it from a scanner,
  // so neither answer is ever phrased as a fact about the site.
  let asksFor: string | undefined;
  if (cap.error) {
    asksFor = undefined;
  } else if (cap.passwordField && crossDomain.length > 0) {
    asksFor = `a password, posted to ${crossDomain[0].host}, a different domain`;
  } else if (cap.passwordField) {
    asksFor = "a password, in the page that loaded";
  } else if (crossDomain.length > 0) {
    asksFor = `no password, but a form posts to ${crossDomain[0].host}`;
  } else {
    asksFor = "no password form in the page that loaded";
  }

  const registered = d.domainCreated
    ? new Date(d.domainCreated).toLocaleString()
    : d.domainAgeDays !== undefined
      ? `${count(d.domainAgeDays, "day")} old`
      : undefined;

  const certificate =
    d.tlsAgeDays !== undefined || d.tlsIssuer
      ? [
          d.tlsAgeDays !== undefined ? `${count(d.tlsAgeDays, "day")} old` : undefined,
          d.tlsIssuer,
          d.tlsValidDays !== undefined ? `valid ${d.tlsValidDays} d` : undefined,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  const notCollected: string[] = [
    ...d.absent.map((name) => `No ${name} reported.`),
    ...(cap.error ? [`Form analysis unavailable: ${cap.error}`] : []),
    ...merged.incomplete.map(
      (e) =>
        `${ENGINE_NAME[e.engine]} ${e.status === "running" ? "is still scanning" : `did not finish: ${e.error ?? e.status}`}.`,
    ),
    ...(merged.engines.includes("urlscan") ? [] : ["No urlscan verdict lanes."]),
  ];

  const network = [
    d.ips?.length ? count(d.ips.length, "IP") : undefined,
    d.asns?.length ? count(d.asns.length, "ASN") : undefined,
    d.countries?.length ? count(d.countries.length, "country", "countries") : undefined,
    d.servers?.length ? count(d.servers.length, "server") : undefined,
  ].filter(Boolean);

  const content = [
    d.cookies?.length ? count(d.cookies.length, "cookie") : undefined,
    d.linkDomainCount ? count(d.linkDomainCount, "link domain") : undefined,
    d.consoleMessages?.length
      ? count(d.consoleMessages.length, "console message")
      : undefined,
  ].filter(Boolean);

  return (
    <section className="space-y-6 border-b border-foreground/10 pb-8 last:border-b-0">
      <h3 className="font-mono text-xs break-all text-foreground/60">
        {merged.target}
      </h3>

      {/* The deliverable: a paragraph to paste into a case, beside the picture
          of what actually loaded. Many cases end here. */}
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div>
          {narrative ? (
            <CopyableSummary text={narrative} />
          ) : (
            <p className="text-sm text-foreground/60">
              Nothing has come back for this URL yet, so there is nothing to
              summarize. The sections below fill in as each engine finishes.
            </p>
          )}
        </div>
        {shot?.verdict?.screenshot ? (
          <figure className="space-y-1">
            {/* The capture is evidence, and at this size it can only be
                glanced at. Clicking opens it full screen with zoom, which is
                where a misspelt footer or a wrong favicon is actually read. */}
            <button
              type="button"
              onClick={() => setInspecting(shot.verdict?.screenshot ?? null)}
              aria-label={`Inspect the screenshot of ${merged.target}`}
              title="Inspect the screenshot"
              className="group relative block w-full cursor-zoom-in overflow-hidden rounded border border-foreground/12"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- provider-hosted screenshot; next/image would need urlscan allowlisted */}
              <img
                src={shot.verdict.screenshot}
                alt={`Screenshot of ${merged.target}`}
                className="w-full object-cover object-top"
                loading="lazy"
              />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-background opacity-0 transition group-hover:bg-foreground/30 group-hover:opacity-100 group-focus-visible:bg-foreground/30 group-focus-visible:opacity-100">
                <Maximize2 className="size-5" />
              </span>
            </button>
            <figcaption className="text-[11px] text-foreground/45">
              screenshot · {ENGINE_NAME[shot.engine]} · click to inspect
            </figcaption>
          </figure>
        ) : (
          <p className="self-start rounded border border-dashed border-foreground/15 p-3 text-xs text-foreground/45">
            No screenshot. Cloudflare serves its capture from an authenticated
            endpoint, so only a urlscan.io scan produces one here.
          </p>
        )}
      </div>

      {/* The five questions the owner named, each attributed. */}
      <div>
        <Row
          label="Ends up at"
          value={
            d.finalUrl
              ? `${d.finalUrl}${hops > 0 ? `  ·  ${count(hops, "redirect")}` : ""}`
              : undefined
          }
          engines={by(scans, "finalUrl")}
        />
        <Row
          label="Impersonates"
          value={brands.length ? brands.join(", ") : undefined}
          engines={brands.length ? ["urlscan.io"] : []}
          tone="text-amber-600 dark:text-amber-400"
        />
        <Row
          label="Asks for"
          value={asksFor}
          missing="form analysis unavailable"
          engines={domEngines}
          tone={cap.passwordField ? "text-red-600 dark:text-red-400" : undefined}
        />
        <Row
          label="Domain age"
          value={registered ? `registered ${registered}` : undefined}
          engines={by(scans, d.domainCreated ? "domainCreated" : "domainAgeDays")}
        />
        <Row
          label="Certificate"
          value={certificate}
          engines={by(scans, d.tlsIssuer ? "tlsIssuer" : "tlsAgeDays")}
        />
      </div>

      {/* Adjacent lines, so agreement or disagreement is visible without
          comparing by eye. */}
      <div className="space-y-1.5">
        <h4 className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
          Who says what
        </h4>
        {scans
          .filter((s) => s.status === "done" && s.detail)
          .map((s) => {
            const reading = s.detail as ScanDetail;
            const lane = reading.verdicts.overall;
            const risks = reading.riskCategories ?? [];
            const categories = reading.contentCategories ?? [];
            const words = lane.malicious
              ? `MALICIOUS  ${[lane.score !== undefined ? `score ${lane.score}` : undefined, ...(lane.categories ?? [])].filter(Boolean).join(" · ")}`
              : risks.length
                ? `RISK  ${risks.join(", ")}`
                : "no verdict";
            return (
              <div
                key={s.engine}
                className="flex flex-wrap items-baseline gap-x-3 text-sm"
              >
                <span className="w-28 shrink-0 text-[13px] text-muted-foreground">
                  {ENGINE_NAME[s.engine]}
                </span>
                <span
                  className={
                    lane.malicious
                      ? "text-red-600 dark:text-red-400"
                      : "text-foreground/75"
                  }
                >
                  {words}
                </span>
                {/* What the site is filed as, next to the verdict rather than
                    inside it: a category is not an accusation, and a login page
                    on a domain filed as Parked is the mismatch worth seeing. */}
                {categories.length > 0 && (
                  <span className="text-xs text-foreground/50">
                    filed as {categories.join(", ")}
                    {reading.categoryInheritedFrom
                      ? `, via ${reading.categoryInheritedFrom}`
                      : ""}
                  </span>
                )}
              </div>
            );
          })}
        {passive}
        {merged.disagreements.map((disagreement) => (
          <p
            key={disagreement.field}
            className="pt-1 text-xs text-amber-600 dark:text-amber-400"
          >
            ⚠ The engines disagree on {midSentence(disagreement.field)}:{" "}
            {disagreement.values
              .map((v) => `${ENGINE_NAME[v.engine]} saw ${v.value}`)
              .join(", ")}
            {disagreement.note ? `. ${disagreement.note}` : ""}
          </p>
        ))}
      </div>

      {merged.engines.length > 0 && (
        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
            Evidence
          </h4>
          {hops > 0 && (
            <Evidence title="Redirect chain" detail={count(hops, "hop")}>
              <ol className="space-y-0.5">
                {d.redirects?.map((hop) => (
                  <li key={`${hop.from}-${hop.to}`} className="font-mono">
                    {hop.from} → {hop.to}
                    {hop.status ? ` (${hop.status})` : ""}
                  </li>
                ))}
              </ol>
            </Evidence>
          )}
          {network.length > 0 && (
            <Evidence title="Network" detail={network.join(", ")}>
              <p className="font-mono">
                {[
                  d.ips?.join(", "),
                  d.asns?.join(", "),
                  d.countries?.join(", "),
                  d.servers?.join(", "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </Evidence>
          )}
          {content.length > 0 && (
            <Evidence title="Page content" detail={content.join(", ")}>
              <p>
                {d.cookies?.length
                  ? `Cookies: ${d.cookies.map((c) => `${c.name}${c.secure ? " (secure)" : ""}`).join(", ")}. `
                  : ""}
                {/* The list is shown short but the remainder is named, so a
                    truncated list never reads as the whole set. */}
                {d.linkDomains?.length
                  ? `Links to: ${d.linkDomains.slice(0, 12).join(", ")}${
                      (d.linkDomainCount ?? d.linkDomains.length) > 12
                        ? `, and ${(d.linkDomainCount ?? d.linkDomains.length) - 12} more`
                        : ""
                    }. `
                  : ""}
                {d.consoleMessages?.length
                  ? `Console: ${d.consoleMessages.slice(0, 4).join(" | ")}`
                  : ""}
              </p>
            </Evidence>
          )}
          {d.certificates?.length ? (
            <Evidence
              title="Certificates"
              detail={count(d.certificates.length, "certificate")}
            >
              <ul className="space-y-0.5">
                {d.certificates.map((cert) => (
                  <li key={`${cert.subject}-${cert.validFrom}`}>
                    {[cert.subject, cert.issuer, cert.validFrom, cert.validTo]
                      .filter(Boolean)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </Evidence>
          ) : null}
          {(d.registrar ?? d.nameservers?.length ?? d.dnssecValid !== undefined) ? (
            <Evidence
              title="DNS and WHOIS"
              detail={[
                d.registrar,
                d.nameservers?.length
                  ? count(d.nameservers.length, "nameserver")
                  : undefined,
                d.dnssecValid === undefined
                  ? undefined
                  : d.dnssecValid
                    ? "DNSSEC valid"
                    : "DNSSEC unsigned",
              ]
                .filter(Boolean)
                .join(", ")}
            >
              <p>
                {[
                  d.registrar ? stop(`Registrar: ${d.registrar}`) : "",
                  d.domainExpires
                    ? stop(`Expires ${formatDate(d.domainExpires)}`)
                    : "",
                  d.nameservers?.length
                    ? stop(`Nameservers: ${d.nameservers.join(", ")}`)
                    : "",
                  d.radarRankBucket
                    ? stop(`Radar rank bucket ${d.radarRankBucket}`)
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              </p>
            </Evidence>
          ) : null}
          {d.siblingDomains?.length ? (
            <Evidence
              title="Sibling domains from robots.txt"
              detail={count(d.siblingDomains.length, "domain")}
            >
              <p className="font-mono">{d.siblingDomains.join(", ")}</p>
            </Evidence>
          ) : null}
          {cap.downloadLinks.length > 0 && (
            <Evidence
              title="Executable links"
              detail={count(cap.downloadLinks.length, "link")}
            >
              <ul className="space-y-0.5 font-mono">
                {cap.downloadLinks.map((link) => (
                  <li key={link}>{link}</li>
                ))}
              </ul>
            </Evidence>
          )}
        </div>
      )}

      {notCollected.length > 0 && (
        <div className="space-y-1">
          <h4 className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
            Not collected
          </h4>
          <p className="text-xs text-foreground/55">
            {notCollected.join(" ")} Not observed, which is not the same as
            observed to be absent.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {scans
          .filter((s) => s.resultUrl)
          .map((s) => (
            <a
              key={s.engine}
              href={s.resultUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-foreground/60 underline underline-offset-2 hover:text-foreground"
            >
              {ENGINE_NAME[s.engine]} report
              <ExternalLink className="size-3" />
            </a>
          ))}
      </div>

      {inspecting && (
        <ImageInspector
          src={inspecting}
          alt={`Screenshot of ${merged.target}`}
          title={d.finalUrl ?? merged.target}
          subtitle={[
            shot ? `captured by ${ENGINE_NAME[shot.engine]}` : undefined,
            d.title,
          ]
            .filter(Boolean)
            .join(" · ")}
          href={shot?.resultUrl}
          hrefLabel="Open the scanner's report"
          onClose={() => setInspecting(null)}
        />
      )}
    </section>
  );
}
