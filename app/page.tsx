import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import Checker from "@/components/Checker";
import { SourceRail, SourceRailSkeleton } from "@/components/Home/source-rail";
import { HEALTH_GROUPS, readHealth } from "@/lib/ti/health-store";

export default function Home() {
  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <Checker
        idleAside={
          <Suspense fallback={<SourceRailSkeleton />}>
            <LiveSourceRail />
          </Suspense>
        }
      />
      <div className="mx-auto w-full max-w-7xl px-4 pb-6 text-sm">
        <Link
          href="/bulk"
          className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Bulk lookup
        </Link>
      </div>
    </main>
  );
}

/** Streams in after the search is already on screen. `connection()` keeps the
 *  page from being prerendered at build time with that moment's health. */
async function LiveSourceRail() {
  const { board, now } = await loadRail();
  return <SourceRail board={board} now={now} />;
}

/** The board and the moment it was read, taken together so the rail's "newest"
 *  age is measured against the read, not whenever React renders. */
async function loadRail() {
  await connection();
  const board = await readHealth(HEALTH_GROUPS);
  return { board, now: Date.now() };
}
