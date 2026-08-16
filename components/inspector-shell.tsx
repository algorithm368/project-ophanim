"use client";

import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";

/** Shared control styling for anything in an inspector's header bar. */
export const INSPECTOR_CONTROL =
  "rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground";

/**
 * The frame every full-screen inspector sits in.
 *
 * Two things look at evidence up close, a captured screenshot and an archived
 * page, and they differ only in what fills the middle. Everything around it is
 * the same and has to behave the same: Escape closes, the backdrop closes, the
 * page behind does not scroll away underneath, and the header always says what
 * is being looked at and where it came from.
 */
export function InspectorShell({
  title,
  subtitle,
  label,
  href,
  hrefLabel = "Open source",
  actions,
  footer,
  onClose,
  children,
}: Readonly<{
  title: string;
  subtitle?: string;
  /** Accessible name for the dialog itself. */
  label: string;
  href?: string;
  hrefLabel?: string;
  /** Controls specific to this inspector, left of the source and close buttons. */
  actions?: React.ReactNode;
  /** One line under the content, usually the keyboard hints. */
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}>) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex flex-col items-center gap-3 bg-background/95 p-4 backdrop-blur-sm sm:p-6"
    >
      {/* The backdrop is its own button rather than a click handler on the
          dialog: a div is neither focusable nor in the tab order, and putting it
          behind the content means the content never has to stop propagation.
          Escape and the close button are the keyboard paths, so it stays out of
          the tab order. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      <div className="relative flex w-full max-w-6xl items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] text-foreground" title={title}>
            {title}
          </div>
          {subtitle && (
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={hrefLabel}
              aria-label={hrefLabel}
              className={INSPECTOR_CONTROL}
            >
              <ExternalLink className="size-4" />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={INSPECTOR_CONTROL}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {children}

      {footer && (
        <p className="relative text-center font-mono text-[10px] tracking-[0.1em] text-muted-foreground/70 uppercase">
          {footer}
        </p>
      )}
    </div>
  );
}
