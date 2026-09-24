"use client";

import { count } from "@/lib/text";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import type { MergedIndicator } from "@/lib/ti/url/active/merge";
import type { ActiveScan, ActiveScanBatch } from "@/lib/ti/url/active/types";
import {
  by,
  Difference,
  differenceFor,
  folded,
  listed,
  ScanRow,
  ScanSection,
} from "../primitives";

/**
 * The first half of the teardown: what the scanner did, and what came back.
 *
 * The order is the order it happened. A request went out, something redirected
 * it, a page answered, that page pulled more in, and its markup was read. An
 * analyst reconstructing an incident walks that same path, and a page grouped
 * by which API reported what would make them jump between the two.
 */

/** What was sent, and where it ended up. */
export function RequestSection({
  merged,
  scans,
  batch,
}: Readonly<{
  merged: MergedIndicator;
  scans: ActiveScan[];
  batch: ActiveScanBatch;
}>) {
  const d = merged.detail;
  const hops = d.redirects ?? [];
  const visibilities = [
    ...new Set(batch.scans.map((s) => s.visibility).filter(Boolean)),
  ];

  return (
    <ScanSection id="request" title="Path" span={12}>
      <ScanRow
        label="URLs sent"
        value={
          merged.targets.length ? (
            <span className="space-y-0.5">
              {merged.targets.map((t) => (
                <span key={t} className="block font-mono text-[13px] break-all">
                  {t}
                </span>
              ))}
            </span>
          ) : undefined
        }
        missing="nothing was submitted"
      />
      <ScanRow
        label="Visibility"
        value={visibilities.join(", ")}
        hint="A public scan is searchable by anyone, including whoever sent the phish. This app never submits one."
      />
      <ScanRow
        label="Redirects"
        value={
          hops.length > 0 ? (
            <>
              {count(hops.length, "hop")}
              <ol className="mt-1 space-y-0.5 font-mono text-[11px] text-foreground/70">
                {/* Indexed: a redirect loop repeats the same hop, and a
                    repeat is the finding, so it must print rather than
                    collide. */}
                {hops.map((hop, i) => (
                  <li key={`${i}-${hop.from}-${hop.to}`} className="break-all">
                    {hop.from} → {hop.to}
                    {hop.status ? ` (${hop.status})` : ""}
                  </li>
                ))}
              </ol>
              <Difference of={differenceFor(merged, "Redirect hops")} />
            </>
          ) : undefined
        }
        missing="none, the first URL answered"
      />
      <ScanRow
        label="Ends up at"
        value={folded(merged, "Final URL", d.finalUrl)}
        mono
        engines={by(scans, "finalUrl")}
      />
    </ScanSection>
  );
}

/** The page that answered, and the machine that served it. */
export function PageSection({
  merged,
  scans,
}: Readonly<{ merged: MergedIndicator; scans: ActiveScan[] }>) {
  const d = merged.detail;
  const place = [d.city, d.country].filter(Boolean).join(", ");
  const asn = [d.asn, d.asnName].filter(Boolean).join(" ");

  return (
    <ScanSection id="page" title="Page">
      <ScanRow
        label="HTTP status"
        value={folded(merged, "HTTP status", d.httpStatus)}
        engines={by(scans, "httpStatus")}
      />
      <ScanRow
        label="Content type"
        value={d.mimeType}
        mono
        engines={by(scans, "mimeType")}
        hint="What the server said it was returning. A 200 answering with an octet-stream is a download, not a page."
      />
      <ScanRow
        label="Title"
        value={folded(merged, "Page title", d.title)}
        engines={by(scans, "title")}
      />
      <ScanRow
        label="Server"
        value={folded(merged, "Server", d.server)}
        mono
        engines={by(scans, "server")}
      />
      <ScanRow
        label="Serving IP"
        value={folded(merged, "Serving IP", d.ip)}
        mono
        engines={by(scans, "ip")}
      />
      <ScanRow
        label="Network"
        value={asn}
        hint="The autonomous system announcing the address, and who owns it."
        engines={by(scans, "asn")}
      />
      <ScanRow label="Location" value={place} engines={by(scans, "country")} />
    </ScanSection>
  );
}

/** How many requests went to hosts already known bad, phrased so that a
 *  reported zero reads as the observation it is. */
function flaggedRequests(n: number | undefined): string | undefined {
  if (n === undefined) return undefined;
  return n === 0 ? "none" : count(n, "request");
}

/** What the page pulled in while it loaded. */
export function NetworkSection({
  merged,
  scans,
}: Readonly<{ merged: MergedIndicator; scans: ActiveScan[] }>) {
  const d = merged.detail;
  const flagged = d.maliciousRequestCount;
  const partlyInsecure =
    d.securePercentage !== undefined && d.securePercentage < 100;

  return (
    <ScanSection id="network" title="Network">
      <ScanRow
        label="Requests"
        value={d.requestCount > 0 ? count(d.requestCount, "request") : undefined}
        engines={by(scans, "requestCount")}
        missing="no requests recorded"
      />
      <ScanRow
        label="Over TLS"
        value={
          d.securePercentage !== undefined ? `${d.securePercentage}%` : undefined
        }
        hint="How much of what the page loaded came over https. A login page pulling assets over http is a kit assembled in a hurry."
        tone={partlyInsecure ? "text-amber-600 dark:text-amber-400" : undefined}
        engines={by(scans, "securePercentage")}
      />
      <ScanRow
        label="Flagged requests"
        value={flaggedRequests(flagged)}
        hint="Requests the scanner matched against hosts already known bad. A page can be dangerous for what it loads rather than for what it is."
        tone={
          flagged ? "text-red-600 dark:text-red-400" : undefined
        }
        engines={by(scans, "maliciousRequestCount")}
      />
      <ScanRow
        label="Domains"
        value={listed(d.domains)}
        engines={by(scans, "domains")}
      />
      <ScanRow
        label="Addresses"
        value={listed(d.ips)}
        engines={by(scans, "ips")}
      />
      <ScanRow
        label="Networks"
        value={listed(d.asns)}
        engines={by(scans, "asns")}
      />
      <ScanRow
        label="Countries"
        value={listed(d.countries)}
        engines={by(scans, "countries")}
      />
      <ScanRow
        label="Server software"
        value={listed(d.servers)}
        engines={by(scans, "servers")}
      />
    </ScanSection>
  );
}

/**
 * What the markup that loaded can do.
 *
 * Every row here is a claim about the captured DOM and nothing more. A kit can
 * build its form after a click, or serve something harmless when it recognises
 * a scanner, so "no password field" means "not in the page that loaded" and the
 * wording says exactly that. `capability.error` is the separate case, where the
 * DOM could not be read at all, which is not an observation about the page.
 */
export function DomSection({
  merged,
  scans,
}: Readonly<{ merged: MergedIndicator; scans: ActiveScan[] }>) {
  const cap = merged.capability;

  // Only an engine whose DOM was actually read backs these rows. One that
  // finished the scan but was refused the DOM contributed nothing, and
  // crediting it would put a name behind a claim it never made.
  const domEngines = scans
    .filter((s) => s.capability && !s.capability.error)
    .map((s) => ENGINE_NAME[s.engine]);

  if (cap.error) {
    return (
      <ScanSection id="dom" title="Forms">
        <ScanRow label="DOM" missing={`not read: ${cap.error}`} />
      </ScanSection>
    );
  }

  const offSite = cap.forms.filter((f) => f.crossDomain);

  return (
    <ScanSection id="dom" title="Forms">
      <ScanRow
        label="Password field"
        value={
          cap.passwordField
            ? "present in the page that loaded"
            : "none in the page that loaded"
        }
        tone={cap.passwordField ? "text-red-600 dark:text-red-400" : undefined}
        engines={domEngines}
      />
      <ScanRow
        label="Forms post to"
        value={
          cap.forms.length ? (
            <span className="space-y-0.5">
              {cap.forms.map((form) => (
                <span
                  key={form.action}
                  className={`block font-mono text-[13px] break-all ${
                    form.crossDomain ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {form.action}
                  {form.crossDomain ? "  ← another domain" : ""}
                </span>
              ))}
            </span>
          ) : undefined
        }
        missing="no forms in the page that loaded"
        engines={domEngines}
      />
      <ScanRow
        label="Off-site forms"
        value={offSite.length ? count(offSite.length, "form") : "none"}
        tone={offSite.length ? "text-red-600 dark:text-red-400" : undefined}
        hint="A form whose registrable domain differs from the page's. A different host under the same site is ordinary architecture and is not counted."
        engines={domEngines}
      />
    </ScanSection>
  );
}
