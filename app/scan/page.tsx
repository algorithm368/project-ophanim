import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { ScanSearch } from "@/components/ScanSearch";
import { EngineRail, EngineRailSkeleton } from "@/components/Home/engine-rail";
import { readScanCredentials } from "@/lib/ti/url/active/credentials";
import { readEngineBoard } from "@/lib/ti/url/active/engine-health";

export const metadata: Metadata = {
  title: "Active scan | Project Ophanim",
  description:
    "Visit an IP, domain, or URL through urlscan.io and Cloudflare, and read what it serves.",
};

/**
 * Active mode's landing page, the counterpart of the passive one at `/`.
 *
 * Having both means the mode is a place rather than a toggle inside a page: the
 * switch in the banner works before anything has been typed, and "the scanner"
 * is a link someone can be sent.
 */
export default function ScanHome() {
  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <ScanSearch
        aside={
          <Suspense fallback={<EngineRailSkeleton />}>
            <LiveEngineRail />
          </Suspense>
        }
      />
    </main>
  );
}

/** Streams in after the search is on screen; the quota read is a round trip
 *  to urlscan that the box should not wait on. */
async function LiveEngineRail() {
  const { board, now } = await loadRail();
  return <EngineRail board={board} now={now} />;
}

/** The board and the moment it was read, taken together (see app/page.tsx). */
async function loadRail() {
  await connection();
  const board = await readEngineBoard(readScanCredentials());
  return { board, now: Date.now() };
}
