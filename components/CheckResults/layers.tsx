"use client";

import { Globe, Link2, Network, RefreshCw } from "lucide-react";
import type { LayerKind, UrlCheckResult, UrlLayer } from "@/lib/ti/url/types";
import { SectionHeading } from "./primitives";
import { VERDICT_STYLE } from "./verdict";
import type { IconType } from "./types";

const LAYER_META: Record<LayerKind, { label: string; icon: IconType }> = {
  url: { label: "The URL", icon: Link2 },
  domain: { label: "Its host", icon: Globe },
  ip: { label: "The host's address", icon: Network },
};

/** Sentence naming where the headline came from, so "malicious" is never shown
 *  without saying whether the URL itself is listed or only its neighbourhood. */
const ATTRIBUTION: Record<LayerKind, string> = {
  url: "This verdict is about the URL itself.",
  domain: "This verdict comes from the host, not the URL itself.",
  ip: "This verdict comes from the host's address, not the URL itself.",
};

function relativeAge(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "cached today";
  return days === 1 ? "cached 1 day ago" : `cached ${days} days ago`;
}

function LayerRow({
  layer,
  isHeadline,
  onRefresh,
}: Readonly<{
  layer: UrlLayer;
  isHeadline: boolean;
  onRefresh?: (kind: LayerKind) => void;
}>) {
  const meta = LAYER_META[layer.kind];
  const Icon = meta.icon;
  const style = VERDICT_STYLE[layer.verdict];

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-foreground/10 py-3 last:border-b-0">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <Icon className="size-4 shrink-0 self-center text-foreground/55" />
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {meta.label}
            {isHeadline && (
              <span className="ml-2 font-mono text-[10px] tracking-[0.14em] text-foreground/50 uppercase">
                drives the verdict
              </span>
            )}
          </div>
          <div className="truncate font-mono text-xs text-foreground/60">
            {layer.indicator}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {layer.status === "ok" ? (
          <>
            <span
              className={`rounded-md border px-2 py-0.5 font-mono text-[11px] tracking-[0.1em] uppercase ${style.chip}`}
            >
              {style.label}
            </span>
            <span className="text-xs text-foreground/60">
              {layer.stats.queried} sources
            </span>
            {layer.cachedAt && onRefresh && (
              <button
                type="button"
                onClick={() => onRefresh(layer.kind)}
                className="flex items-center gap-1 text-xs text-foreground/60 underline underline-offset-2 hover:text-foreground"
              >
                <RefreshCw className="size-3" />
                {relativeAge(layer.cachedAt)}
              </button>
            )}
          </>
        ) : (
          // Deliberately not a verdict chip. An absent layer is not a cleared
          // layer, and a chip here would read as one.
          <span className="max-w-xs text-right text-xs text-foreground/60">
            {layer.reason}
          </span>
        )}
      </div>
    </div>
  );
}

/** The three layers of a URL check, each with its own verdict, source count and
 *  cache age. */
export function LayerStack({
  result,
  onRefresh,
}: Readonly<{
  result: UrlCheckResult;
  onRefresh?: (kind: LayerKind) => void;
}>) {
  return (
    <div className="space-y-4">
      <SectionHeading icon={Link2}>Layers</SectionHeading>
      <p className="text-sm text-foreground/75">
        {ATTRIBUTION[result.headlineLayer]}
      </p>
      <div>
        {result.layers.map((layer) => (
          <LayerRow
            key={layer.kind}
            layer={layer}
            isHeadline={
              layer.kind === result.headlineLayer && layer.status === "ok"
            }
            onRefresh={onRefresh}
          />
        ))}
      </div>
      {result.otherAddresses?.length ? (
        <p className="text-xs text-foreground/60">
          The host also resolved to {result.otherAddresses.length} other{" "}
          {result.otherAddresses.length === 1 ? "address" : "addresses"}, which
          were not checked: {result.otherAddresses.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
