"use client";

import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopied } from "@/components/CheckResults/primitives";

function CopyButton({
  text,
  label,
  caption = "Copy",
}: Readonly<{ text: string; label: string; caption?: string }>) {
  const [copied, copy] = useCopied();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-label={label}
      onClick={() => copy(text)}
      className="font-hand shrink-0 gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? "Copied" : caption}
    </Button>
  );
}

/**
 * Ready-to-paste location verdicts: the whole batch in one country or one
 * city, which address lands where when it is not one location, and the groups
 * that share a city. Each has its own Copy, because a ticket usually wants the
 * one finding, not the page.
 */
export function SameLocation({ notes }: Readonly<{ notes: string[] }>) {
  if (!notes.length) return null;
  return (
    <section className="rounded-md border-2 border-foreground/20">
      <header className="flex min-h-9 items-center justify-between gap-2 border-b border-foreground/10 px-3">
        <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Location
          {notes.length > 1 && (
            <span className="rounded-sm bg-foreground/10 px-1.5 font-normal tabular-nums">
              {notes.length}
            </span>
          )}
        </h3>
        {notes.length > 1 && (
          <div className="-mr-1.5">
            <CopyButton
              text={notes.join("\n")}
              label="Copy every location sentence"
              caption="Copy all"
            />
          </div>
        )}
      </header>
      <ul className="divide-y divide-foreground/10">
        {notes.map((note) => (
          <li key={note} className="flex items-start justify-between gap-3 py-1.5 pr-1.5 pl-3">
            <p className="py-0.5 text-sm leading-relaxed text-foreground/90 select-all">{note}</p>
            <CopyButton text={note} label={`Copy: ${note}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
