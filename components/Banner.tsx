import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

/** Full-width brand banner shown at the top of every page. */
export function Banner() {
  return (
    <header className="relative border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:py-4">
        <Link
          href="/"
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
        <div className="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
