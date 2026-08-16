"use client";

import Link from "next/link";
import { ModeSwitch } from "@/components/ModeSwitch";
import { ThemeToggle } from "@/components/theme-toggle";
import { iocFromPath } from "@/lib/ioc";

// Checker owns the URL on the passive result page: it reflects each lookup with
// history.pushState (so a result is shareable) and never remounts — Back/Forward
// are handled by a popstate listener that re-syncs the view, clearing to the
// empty home state when the path is "/". A plain <Link href="/"> can't trigger
// that: "/" and "/check/<ioc>" both render <Checker> at the same spot in the
// tree, so navigating "home" reconciles the same instance and leaves the old
// result on screen. So on those paths we reset in place through that same
// popstate path: push "/" and fire popstate, which clears the search box and
// result. Modifier/middle clicks fall through to the link's normal
// open-in-new-tab behavior.
//
// The interception is scoped to exactly the paths Checker is mounted on, which
// is what `iocFromPath` answers — the same function the popstate handler uses to
// decide what to restore. Anywhere else (the active pages under /scan, most of
// all) nothing is listening, so preventing the default here used to push "/"
// into the address bar and then leave the old page on screen, with no way home
// short of a reload. Those paths get an ordinary client-side navigation.
//
// Declared at module scope rather than inside Banner (typescript:S7721): it
// closes over nothing from the component, so re-creating it on every render
// bought nothing and handed <Link> a new prop identity each time.
function handleHomeClick(e: React.MouseEvent<HTMLAnchorElement>) {
  const plainClick =
    e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  if (!plainClick || iocFromPath(window.location.pathname) === null) return;
  e.preventDefault();
  window.history.pushState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  // The in-place reset doesn't re-run Next's route metadata, so a permalink's
  // "<ioc>, <verdict>" tab title would linger. Restore the home title (matches
  // app/layout.tsx metadata); browser Back to the permalink re-sets it.
  document.title = "Project Ophanim";
}

/** Full-width brand banner shown at the top of every page. */
export function Banner() {
  return (
    <header className="relative border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:py-4">
        <Link
          href="/"
          onClick={handleHomeClick}
          aria-label="Project Ophanim: start a new search"
          className="group inline-flex min-w-0 flex-col leading-none"
        >
          <span className="font-mono text-lg font-bold tracking-[0.06em] whitespace-nowrap transition-colors group-hover:text-primary sm:text-xl">
            PROJECT OPHANIM
          </span>
          <span className="font-mono mt-1.5 hidden text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase sm:inline">
            Threat Intelligence · IOC Lookup
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Which reading is on screen, next to how the page is shown. Absent
              on the home page, where there is no indicator to read either way. */}
          <ModeSwitch />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
