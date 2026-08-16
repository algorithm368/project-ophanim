"use client";

import Link from "next/link";
import { ModeSwitch } from "@/components/ModeSwitch";
import { ThemeToggle } from "@/components/theme-toggle";

// Checker owns the URL: it reflects each lookup with history.pushState (so a
// result is shareable) and never remounts — Back/Forward are handled by a
// popstate listener that re-syncs the view, clearing to the empty home state
// when the path is "/". A plain <Link href="/"> can't trigger that: the route
// segment never actually changed, so navigating "home" reconciles the same
// Checker instance and leaves the old result on screen. So when we're not
// already at "/", reset in place through that same popstate path: push "/" and
// fire popstate, which clears the search box and result. Modifier/middle
// clicks fall through to the link's normal open-in-new-tab behavior.
//
// Declared at module scope rather than inside Banner (typescript:S7721): it
// closes over nothing from the component, so re-creating it on every render
// bought nothing and handed <Link> a new prop identity each time.
function handleHomeClick(e: React.MouseEvent<HTMLAnchorElement>) {
  const plainClick =
    e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  if (!plainClick || window.location.pathname === "/") return;
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
