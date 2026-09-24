"use client";

import { count, tally } from "@/lib/text";
import { formatDate } from "@/lib/ti/narrative";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import type { ScanVerdictLane } from "@/lib/ti/url/active/detail";
import type { MergedIndicator } from "@/lib/ti/url/active/merge";
import type { ActiveScan } from "@/lib/ti/url/active/types";
import {
  NEW_CERTIFICATE_DAYS,
  NEW_DOMAIN_DAYS,
} from "@/lib/ti/url/active/red-flags";
import { by, listed, ScanRow, ScanSection } from "../primitives";

/** The tint a row carries when a red flag points at it, so clicking the flag
 *  lands on something visibly marked rather than on an ordinary-looking row. */
const FLAGGED = "text-red-600 dark:text-red-400";

/** Days under the threshold, when the value is known. Shared by the two age
 *  rows so the tint and the flag cannot disagree about what counts as new. */
function isNew(days: number | undefined, threshold: number): boolean {
  return days !== undefined && days < threshold;
}

/**
 * The second half of the teardown: who the name belongs to, what it presents,
 * and what the scanners made of it.
 *
 * This half is about identity rather than about the visit, which is why it
 * comes after: an analyst reads what happened, then asks who it happened to.
 */

/** Age of the name, preferring the WHOIS instant over the rounded day count.
 *  A domain created this morning reads as "0 days" either way, but only one of
 *  them can say when. */
function registered(created?: string, ageDays?: number): string | undefined {
  if (created) return formatDate(created);
  if (ageDays !== undefined) return `${count(ageDays, "day")} ago`;
  return undefined;
}

/** How the name is ranked for popularity, whichever list answered. A site with
 *  no rank at all is not evidence of anything on its own, and says so. */
function popularity(
  umbrella?: number,
  radar?: string,
): { value?: string; note: string } {
  if (umbrella !== undefined) {
    return { value: `Umbrella rank ${umbrella.toLocaleString()}`, note: "" };
  }
  if (radar) return { value: `Cloudflare Radar ${radar}`, note: "" };
  return {
    value: undefined,
    note: "unranked, which most of the web is",
  };
}

/** What DNSSEC validation found. Not checked and unsigned are different facts
 *  and only one of them is a finding, so an unchecked name returns nothing and
 *  lets the row say "not checked" rather than "unsigned". */
function dnssec(valid: boolean | undefined): string | undefined {
  if (valid === undefined) return undefined;
  return valid ? "valid" : "unsigned";
}

/** Who the name belongs to and how it is delegated. */
export function IdentitySection({
  merged,
  scans,
}: Readonly<{ merged: MergedIndicator; scans: ActiveScan[] }>) {
  const d = merged.detail;
  const rank = popularity(d.umbrellaRank, d.radarRankBucket);

  return (
    <ScanSection id="identity" title="Identity">
      <ScanRow
        label="Domain"
        value={d.domain}
        mono
        engines={by(scans, "domain")}
      />
      <ScanRow
        label="Registered"
        value={registered(d.domainCreated, d.domainAgeDays)}
        tone={isNew(d.domainAgeDays, NEW_DOMAIN_DAYS) ? FLAGGED : undefined}
        engines={by(scans, d.domainCreated ? "domainCreated" : "domainAgeDays")}
      />
      <ScanRow
        label="Registrar"
        value={d.registrar}
        engines={by(scans, "registrar")}
      />
      <ScanRow
        label="Expires"
        value={d.domainExpires ? formatDate(d.domainExpires) : undefined}
        engines={by(scans, "domainExpires")}
      />
      <ScanRow
        label="Nameservers"
        value={listed(d.nameservers, { max: 6 })}
        engines={by(scans, "nameservers")}
      />
      <ScanRow
        label="DNSSEC"
        value={dnssec(d.dnssecValid)}
        missing="not checked"
        engines={by(scans, "dnssecValid")}
      />
      <ScanRow
        label="Popularity"
        value={rank.value}
        missing={rank.note}
        hint="A site claiming to be a bank that no popularity list has ever ranked is the mismatch worth seeing."
      />
      <ScanRow
        label="Sibling domains"
        value={listed(d.siblingDomains, { max: 8 })}
        missing="none named by robots.txt"
        hint="Other hosts the site's own robots.txt points its sitemaps at."
        engines={by(scans, "siblingDomains")}
      />
    </ScanSection>
  );
}

/** What the connection presented. */
export function CertificateSection({
  merged,
  scans,
}: Readonly<{ merged: MergedIndicator; scans: ActiveScan[] }>) {
  const d = merged.detail;

  return (
    <ScanSection id="certs" title="Certificates">
      <ScanRow
        label="Issuer"
        value={d.tlsIssuer}
        engines={by(scans, "tlsIssuer")}
      />
      <ScanRow
        label="Issued"
        value={
          d.tlsAgeDays !== undefined
            ? `${count(d.tlsAgeDays, "day")} ago`
            : undefined
        }
        tone={isNew(d.tlsAgeDays, NEW_CERTIFICATE_DAYS) ? FLAGGED : undefined}
        engines={by(scans, "tlsAgeDays")}
      />
      <ScanRow
        label="Valid for"
        value={d.tlsValidDays !== undefined ? `${d.tlsValidDays} days` : undefined}
        engines={by(scans, "tlsValidDays")}
      />
      <ScanRow
        label="Chain"
        value={
          d.certificates?.length ? (
            <span className="space-y-0.5">
              {/* Indexed: one certificate can be listed for two hosts. */}
              {d.certificates.map((cert, i) => (
                <span
                  key={`${i}-${cert.subject}-${cert.validFrom}`}
                  className="block font-mono text-[11px] break-all text-foreground/75"
                >
                  {[cert.subject, cert.issuer, cert.validFrom, cert.validTo]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ))}
            </span>
          ) : undefined
        }
        missing="no certificates reported"
        engines={by(scans, "certificates")}
      />
    </ScanSection>
  );
}

/** One engine's reading as a phrase: the verdict, then whatever it named for
 *  it. A malicious call leads with its score and categories; short of that, the
 *  risk categories stand in; an engine that finished with neither said nothing,
 *  and says so. */
function verdictWords(lane: ScanVerdictLane, risks: string[]): string {
  if (lane.malicious) {
    const score = lane.score !== undefined ? `score ${lane.score}` : undefined;
    return ["MALICIOUS", [score, ...(lane.categories ?? [])].filter(Boolean).join(" · ")]
      .filter(Boolean)
      .join("  ");
  }
  if (risks.length) return `RISK  ${risks.join(", ")}`;
  return "no verdict";
}

/** How many of the lane's engines or voters said malicious, when it counted. */
function laneTally(lane: ScanVerdictLane | undefined): string | undefined {
  if (!lane) return undefined;
  if (lane.enginesTotal !== undefined) {
    return `${lane.maliciousTotal ?? 0} of ${lane.enginesTotal} engines`;
  }
  if (lane.votesTotal !== undefined) {
    return `${count(lane.votesTotal, "vote")}${lane.malicious ? ", called malicious" : ""}`;
  }
  return undefined;
}

/**
 * What each scanner concluded, on adjacent lines.
 *
 * Adjacent so agreement or disagreement is visible without comparing by eye.
 * Where the two engines disagree is not repeated here: the ballots tile prints
 * every engine's answer on every compared field, which shows the agreement as
 * well as the split, and a second list of the split alone said it twice.
 */
export function VerdictSection({
  merged,
  scans,
}: Readonly<{ merged: MergedIndicator; scans: ActiveScan[] }>) {
  const d = merged.detail;
  const finished = scans.filter((s) => s.status === "done" && s.detail);
  const overall = d.verdicts.overall;

  return (
    <ScanSection id="verdicts" title="Verdicts">
      {finished.map((scan) => {
        const reading = scan.detail!;
        const lane = reading.verdicts.overall;
        return (
          <ScanRow
            key={`${scan.engine}-${scan.target}`}
            label={ENGINE_NAME[scan.engine]}
            value={verdictWords(lane, reading.riskCategories ?? [])}
            tone={
              lane.malicious ? "text-red-600 dark:text-red-400" : undefined
            }
            engines={merged.targets.length > 1 ? [scan.target] : []}
          />
        );
      })}
      <ScanRow
        label="Engine lane"
        value={laneTally(d.verdicts.engines)}
        missing="no engine lane reported"
      />
      <ScanRow
        label="Community lane"
        value={laneTally(d.verdicts.community)}
        missing="no community lane reported"
      />
      <ScanRow
        label="Impersonates"
        value={listed(overall.brands, { max: 6 })}
        missing="no brand named"
        tone="text-amber-600 dark:text-amber-400"
      />
      <ScanRow
        label="Categories"
        value={listed(overall.categories, { max: 8 })}
      />
      <ScanRow
        label="Tags"
        value={listed(overall.tags, { max: 10 })}
        hint="The scanner's own labels for this scan, which are often more specific than its categories."
      />
      <ScanRow
        label="Risk categories"
        value={listed(d.riskCategories, { max: 6 })}
        tone={d.riskCategories?.length ? "text-amber-600 dark:text-amber-400" : undefined}
        engines={by(scans, "riskCategories")}
      />
      <ScanRow
        label="Filed as"
        value={
          d.contentCategories?.length
            ? d.contentCategories.join(", ") +
              (d.categoryInheritedFrom ? `, via ${d.categoryInheritedFrom}` : "")
            : undefined
        }
        hint="What the site is about, not a verdict. A login form on a domain filed as Parked is the mismatch worth seeing."
        engines={by(scans, "contentCategories")}
      />

    </ScanSection>
  );
}

/** What nobody collected, named rather than left as an empty section. */
function notCollected(merged: MergedIndicator): string[] {
  const unfinished = merged.incomplete.map((e) => {
    const reason =
      e.status === "running"
        ? "is still scanning"
        : `did not finish: ${e.error ?? e.status}`;
    return `${ENGINE_NAME[e.engine]} ${reason}.`;
  });
  return [
    ...merged.detail.absent.map((name) => `No ${name} reported.`),
    ...(merged.capability.error
      ? [`Form analysis unavailable: ${merged.capability.error}`]
      : []),
    ...unfinished,
  ];
}

/** Everything the page left behind, and everything nobody collected. */
export function TraceSection({
  merged,
  scans,
}: Readonly<{ merged: MergedIndicator; scans: ActiveScan[] }>) {
  const d = merged.detail;
  const missing = notCollected(merged);

  return (
    <ScanSection id="trace" title="Trace" span={12}>
      <ScanRow
        label="Cookies"
        value={
          listed(
            d.cookies?.map((c) => `${c.name}${c.secure ? " (secure)" : ""}`),
          )
        }
        missing="none set"
        engines={by(scans, "cookies")}
      />
      <ScanRow
        label="Links out to"
        value={listed(d.linkDomains, { total: d.linkDomainCount })}
        missing="no outbound links"
        engines={by(scans, "linkDomains")}
      />
      <ScanRow
        label="Console"
        value={
          d.consoleMessages?.length ? (
            // Folded rather than listed: a page logs the same warning once per
            // canvas or frame, and the text is the key, so a repeat printed
            // twice was also a duplicate React key.
            <span className="space-y-0.5">
              {tally(d.consoleMessages).slice(0, 6).map(({ value, times }) => (
                <span
                  key={value}
                  className="block font-mono text-[11px] break-all text-foreground/70"
                >
                  {value}
                  {times > 1 && <span className="text-foreground/45"> ×{times}</span>}
                </span>
              ))}
            </span>
          ) : undefined
        }
        missing="nothing logged"
        engines={by(scans, "consoleMessages")}
      />
      <ScanRow
        label="DOM structure"
        value={d.domStructHash}
        mono
        hint="A hash of the page's structure. Two pages built from one kit share it even when their text differs."
        engines={by(scans, "domStructHash")}
      />
      {missing.length > 0 && (
        <ScanRow
          label="Not collected"
          value={
            <span className="text-foreground/60">
              {missing.join(" ")} Not observed, which is not the same as observed
              to be absent.
            </span>
          }
        />
      )}
    </ScanSection>
  );
}
