import Link from "next/link";
import { Eye, Share2, Star } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

/** Full-width brand banner shown at the top of every page. */
export function Banner() {
  return (
    <header className="relative border-b-2 border-dashed border-foreground/25 bg-gradient-to-b from-primary/8 to-transparent">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:py-4">
        <Link
          href="/"
          aria-label="Project Ophanim: start a new search"
          className="group inline-flex items-center gap-3"
        >
          <span className="sketch-box sketch-shadow relative flex size-11 shrink-0 -rotate-3 items-center justify-center border-2 border-foreground/30 bg-card text-primary transition-transform group-hover:rotate-0">
            <Eye className="size-5 animate-pulse" />
            <Star
              aria-hidden
              className="absolute -top-2 -right-2 size-4 rotate-12 fill-amber-400 text-amber-400"
            />
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="font-hand -rotate-1 text-2xl font-bold tracking-tight sm:text-3xl">
              <span className="highlighter box-decoration-clone px-1">
                Project Ophanim
              </span>
            </span>
            <span className="font-hand mt-1.5 hidden text-sm text-muted-foreground sm:inline">
              know your IOCs at a glance
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/investigate"
            className="font-hand inline-flex items-center gap-1.5 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-dashed border-foreground/30 bg-card/50 px-3 py-1.5 text-sm font-semibold text-foreground/70 transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Share2 className="size-3.5 -rotate-6" />
            Investigate
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
