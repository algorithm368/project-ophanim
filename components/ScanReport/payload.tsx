"use client";

import Link from "next/link";
import { count } from "@/lib/text";
import { formatBytes } from "@/lib/ti/narrative";
import type { ScanDownload } from "@/lib/ti/url/active/detail";
import type { MergedIndicator } from "@/lib/ti/url/active/merge";
import {
  fileKind,
  fileNameOf,
  servedDownload,
  type ScanClass,
} from "@/lib/ti/url/active/scan-class";
import { Tile } from "@/components/CheckResults/frame";
import { RecordTable } from "@/components/CheckResults/primitives";
import { ScanRow } from "./primitives";

const FLAGGED = "text-red-600 dark:text-red-400";

function isExecutable(file: ScanDownload): boolean {
  return (
    fileKind(file.description, file.mimeType, file.filename ?? fileNameOf(file.url)) ===
    "Executable file"
  );
}

/** A file the browser received: what its bytes are, how big, and the hash that
 *  lets it be looked up passively. */
function DownloadRow({
  file,
  how,
}: Readonly<{ file: ScanDownload; how: string }>) {
  const name = file.filename ?? fileNameOf(file.url) ?? "unnamed file";
  const facts = [
    file.description ?? file.mimeType,
    formatBytes(file.size),
    how,
    file.state && file.state !== "completed" ? `download ${file.state}` : undefined,
  ].filter(Boolean);

  return (
    <ScanRow
      label={name}
      tone={isExecutable(file) ? FLAGGED : undefined}
      value={
        <span className="space-y-1">
          <span className="block">{facts.join(", ")}</span>
          {file.sha256 ? (
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono text-[12px] break-all text-foreground/80">
                {file.sha256}
              </span>
              <Link
                href={`/check/${file.sha256}`}
                className="font-mono text-[11px] whitespace-nowrap text-foreground underline underline-offset-2 hover:text-foreground/70"
              >
                Check this hash
              </Link>
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">
              The engine sent no hash for this file, so it cannot be looked up.
            </span>
          )}
        </span>
      }
      engines={["urlscan.io"]}
    />
  );
}

/**
 * The files: what the URL is, what the page started downloading, and what it
 * only offered.
 *
 * Three different claims, kept apart because they are different amounts of
 * evidence. A file the browser received has bytes, a type read from those bytes
 * and a hash. A link the page offers has only a name: the scanner does not
 * click, so nothing behind it was fetched, and the row says so rather than
 * leaving the absence of a hash to be read as the absence of a file.
 */
export function PayloadTile({
  merged,
  klass,
}: Readonly<{ merged: MergedIndicator; klass: ScanClass | undefined }>) {
  const d = merged.detail;
  const served = servedDownload(merged);
  const started = (d.downloads ?? []).filter((f) => f !== served);
  const received = new Set((d.downloads ?? []).map((f) => f.url));
  const offered = merged.capability.downloadLinks.filter((link) => !received.has(link));
  const servedWithoutRecord = klass?.kind === "file" && !served;

  const total = (served ? 1 : 0) + started.length + offered.length + (servedWithoutRecord ? 1 : 0);
  if (total === 0) return null;

  return (
    <Tile span={12} id="payload" title="Payload" note={count(total, "file")}>
      <RecordTable>
        {served && <DownloadRow file={served} how="this URL is the file" />}
        {servedWithoutRecord && (
          <ScanRow
            label={fileNameOf(d.finalUrl ?? merged.targets[0]) ?? "This URL"}
            value={`Served as ${d.mimeType}. No engine kept a copy, so there is no hash to look up.`}
          />
        )}
        {started.map((file, i) => (
          <DownloadRow
            // Indexed: a page can start the same download twice.
            key={`${i}-${file.url ?? file.sha256 ?? file.filename}`}
            file={file}
            how="downloaded by the page as it loaded"
          />
        ))}
        {offered.map((link) => (
          <ScanRow
            key={link}
            label={fileNameOf(link) ?? "link"}
            tone={FLAGGED}
            value={
              <span className="space-y-0.5">
                <span className="block font-mono text-[12px] break-all">{link}</span>
                <span className="block text-xs text-muted-foreground">
                  Offered as a link. The scanner does not click, so nothing was downloaded.
                </span>
              </span>
            }
          />
        ))}
      </RecordTable>
    </Tile>
  );
}
