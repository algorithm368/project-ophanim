import { cloudProvider } from "../cloud";
import type { UrlLayer } from "./types";

/**
 * Name the provider when co-tenancy stops meaning anything.
 *
 * On shared infrastructure "40 domains share this IP" reads as a finding while
 * saying nothing: an address Cloudflare shares with millions of sites tells you
 * nothing about this one. The row already carries weight 0, so it never moved
 * the score; what misleads is the wording, so the wording is what changes.
 *
 * This relabels rather than suppresses, because it cannot suppress. The signal
 * is an ASN lookup, and the ASN arrives from the geo sources inside the same
 * parallel fan-out that runs reverse-ip, so there is no moment where the
 * provider is known and the query has not already gone out. Pre-empting it
 * would mean serializing the IP layer into two stages, paying latency on every
 * IP check to save one query on a minority of them. The quota concern that
 * suppression was meant to address is handled by layer cache reuse instead.
 */
export function annotateSharedHost(layer: UrlLayer): UrlLayer {
  if (!layer.sources.some((s) => s.source.id === "reverse-ip")) return layer;

  const geo = layer.sources.find((s) => s.geo?.asn ?? s.geo?.asnOrg)?.geo;
  const provider = cloudProvider(geo?.asn, geo?.asnOrg ?? geo?.org);
  if (!provider) return layer;

  return {
    ...layer,
    sources: layer.sources.map((s) =>
      s.source.id === "reverse-ip"
        ? {
            ...s,
            summary: `${provider.name} shared infrastructure, so co-tenancy is not evidence about this URL`,
          }
        : s,
    ),
  };
}
